import { InvalidReason, SettleErrorReason, type SettleResponse } from "@relay-14/shared";
import { isHex, keccak256, type Hash, type Hex, type PublicClient } from "viem";
import { type ChainReader, type PaymentStore } from "./store.js";
import { verifyExactNativePayment, type VerifyInput } from "./verify.js";

const RECEIPT_TIMEOUT_MS = 30_000;

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
  input: VerifyInput & { settlement: SettlementClient },
): Promise<SettleResponse> {
  const signedTx = readSignedTx(input.paymentPayload);
  const transaction = signedTx ? transactionHash(signedTx) : "0x";

  const verified = await verifyExactNativePayment(input);
  if (!verified.isValid || !signedTx) {
    return {
      success: false,
      transaction,
      network: input.network,
      payer: verified.payer,
      errorReason: verified.invalidReason ?? InvalidReason.InvalidPayload,
    };
  }

  let hash: Hash = transaction as Hash;
  try {
    hash = await input.settlement.sendRawTransaction(signedTx);
  } catch (error) {
    if (!isAlreadyBroadcast(error)) {
      await input.store.markFailed(transaction, errorText(error));
      return failure(input, transaction, verified.payer, SettleErrorReason.UnexpectedSettleError);
    }
    hash = transaction as Hash;
  }

  try {
    const receipt = await input.settlement.waitForTransactionReceipt(hash);
    if (receipt.status !== "success") {
      await input.store.markFailed(hash, "transaction reverted");
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
    const reason = isTimeoutError(error)
      ? SettleErrorReason.ConfirmationTimedOut
      : SettleErrorReason.UnexpectedSettleError;
    await input.store.markFailed(hash, errorText(error));
    return failure(input, hash, verified.payer, reason);
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

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function isoNow(): string {
  return new Date().toISOString();
}

export type { PaymentStore, ChainReader };
