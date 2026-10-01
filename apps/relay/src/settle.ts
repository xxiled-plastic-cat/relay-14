import { InvalidReason, RECEIPT_TIMEOUT_SECONDS, SettleErrorReason, type SettleResponse } from "@relay-14/shared";
import { isHex, keccak256, type Hash, type Hex, type PublicClient } from "viem";
import { type ChainReader, type PaymentStore } from "./store.js";
import { verifyExactNativePayment, type VerifyInput } from "./verify.js";

const RECEIPT_TIMEOUT_MS = RECEIPT_TIMEOUT_SECONDS * 1000;
const PEER_WAIT_MS = RECEIPT_TIMEOUT_MS + 5_000;
const PEER_POLL_MS = 200;

export interface SettlementClient {
  sendRawTransaction(serializedTransaction: Hex): Promise<Hash>;
  waitForTransactionReceipt(hash: Hash): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
  }>;
}

export function createViemSettlementClient(client: PublicClient): SettlementClient {
  return {
    async sendRawTransaction(serializedTransaction) {
      return client.sendRawTransaction({ serializedTransaction });
    },
    async waitForTransactionReceipt(hash) {
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
        pollingInterval: 1_000,
      });
      return {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
      };
    },
  };
}

export async function settleExactNativePayment(
  input: VerifyInput & {
    settlement: SettlementClient;
    peerWaitTimeoutMs?: number;
    peerPollIntervalMs?: number;
  },
): Promise<SettleResponse> {
  const signedTx = readSignedTx(input.paymentPayload);
  const transaction = signedTx ? transactionHash(signedTx) : "0x";

  const verified = await verifyExactNativePayment(input);
  if (!verified.isValid || !signedTx) {
    if (verified.invalidReason === InvalidReason.ReplayDetected && signedTx) {
      const settled = await storedSuccess(input, transaction);
      if (settled) {
        return settled;
      }
    }
    return {
      success: false,
      transaction,
      network: input.network,
      payer: verified.payer,
      errorReason: verified.invalidReason ?? InvalidReason.InvalidPayload,
    };
  }

  const claimed = await input.store.claimSettling(transaction);
  if (!claimed) {
    return waitForStoredResult(input, transaction, verified.payer);
  }

  let hash: Hash = transaction as Hash;
  try {
    hash = await input.settlement.sendRawTransaction(signedTx);
  } catch (error) {
    if (!isAlreadyBroadcast(error)) {
      await input.store.markFailed(transaction, SettleErrorReason.UnexpectedSettleError);
      return failure(input, transaction, verified.payer, SettleErrorReason.UnexpectedSettleError);
    }
    hash = transaction as Hash;
  }

  try {
    const receipt = await input.settlement.waitForTransactionReceipt(hash);
    if (receipt.status !== "success") {
      await input.store.markFailed(hash, SettleErrorReason.TransactionFailed);
      return failure(input, hash, verified.payer, SettleErrorReason.TransactionFailed);
    }
    const settledAt = (input.now ?? isoNow)();
    await input.store.markSettled(hash, Number(receipt.blockNumber), settledAt);
    return {
      success: true,
      transaction: hash,
      network: input.network,
      payer: verified.payer,
    };
  } catch (error) {
    // The transfer was already broadcast. Leave the row settling so a retry is not a fresh 402.
    const reason = isTimeoutError(error)
      ? SettleErrorReason.ConfirmationTimedOut
      : SettleErrorReason.SettlementInProgress;
    return failure(input, hash, verified.payer, reason);
  }
}

async function storedSuccess(
  input: VerifyInput,
  transaction: string,
): Promise<SettleResponse | null> {
  const row = await input.store.findByHash(transaction);
  if (row?.status !== "settled") {
    return null;
  }
  return {
    success: true,
    transaction: row.txHash,
    network: input.network,
    payer: row.payer,
  };
}

async function waitForStoredResult(
  input: VerifyInput & {
    settlement: SettlementClient;
    peerWaitTimeoutMs?: number;
    peerPollIntervalMs?: number;
  },
  transaction: string,
  payer: string | undefined,
): Promise<SettleResponse> {
  const timeoutMs = input.peerWaitTimeoutMs ?? PEER_WAIT_MS;
  const pollMs = input.peerPollIntervalMs ?? PEER_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const settled = await storedSuccess(input, transaction);
    if (settled) {
      return settled;
    }
    const row = await input.store.findByHash(transaction);
    if (row?.status === "failed") {
      return failure(input, transaction, row.payer ?? payer, storedFailureReason(row.error));
    }
    if (Date.now() >= deadline) {
      if (row?.status === "settling") {
        return observeInFlightReceipt(input, transaction, row.payer ?? payer);
      }
      return failure(input, transaction, payer, SettleErrorReason.SettlementInProgress);
    }
    await sleep(pollMs);
  }
}

/** Read a receipt for a transfer that was already broadcast. Does not send it again. */
async function observeInFlightReceipt(
  input: VerifyInput & { settlement: SettlementClient },
  transaction: string,
  payer: string | undefined,
): Promise<SettleResponse> {
  const hash = transaction as Hash;
  try {
    const receipt = await input.settlement.waitForTransactionReceipt(hash);
    if (receipt.status !== "success") {
      await input.store.markFailed(hash, SettleErrorReason.TransactionFailed);
      return failure(input, hash, payer, SettleErrorReason.TransactionFailed);
    }
    const settledAt = (input.now ?? isoNow)();
    await input.store.markSettled(hash, Number(receipt.blockNumber), settledAt);
    const settled = await storedSuccess(input, hash);
    if (settled) {
      return settled;
    }
    const row = await input.store.findByHash(hash);
    if (row?.status === "failed") {
      return failure(input, hash, row.payer ?? payer, storedFailureReason(row.error));
    }
    return failure(input, hash, payer, SettleErrorReason.SettlementInProgress);
  } catch (error) {
    const reason = isTimeoutError(error)
      ? SettleErrorReason.ConfirmationTimedOut
      : SettleErrorReason.SettlementInProgress;
    return failure(input, hash, payer, reason);
  }
}

function failure(
  input: VerifyInput,
  transaction: string,
  payer: string | undefined,
  errorReason: string,
): SettleResponse {
  return {
    success: false,
    transaction,
    network: input.network,
    payer,
    errorReason,
  };
}

function readSignedTx(paymentPayload: unknown): Hex | null {
  if (typeof paymentPayload !== "object" || paymentPayload === null || !("payload" in paymentPayload)) {
    return null;
  }
  const payload = paymentPayload.payload;
  if (typeof payload !== "object" || payload === null || !("signedTx" in payload)) {
    return null;
  }
  const signedTx = payload.signedTx;
  if (typeof signedTx !== "string" || !isHex(signedTx)) {
    return null;
  }
  return signedTx;
}

function transactionHash(signedTx: Hex): Hash {
  return keccak256(signedTx);
}

function storedFailureReason(error: string | null): string {
  const reasons: string[] = Object.values(SettleErrorReason);
  if (error && reasons.includes(error)) {
    return error;
  }
  return SettleErrorReason.UnexpectedSettleError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyBroadcast(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already known|already imported|nonce too low|known transaction/i.test(message);
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name.includes("Timeout") || /timed out/i.test(message);
}

function isoNow(): string {
  return new Date().toISOString();
}

export type { PaymentStore, ChainReader };
