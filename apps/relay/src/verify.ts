import {
  InvalidReason,
  RECEIPT_TIMEOUT_SECONDS,
  SCHEME,
  X402_VERSION,
  type VerifyResponse,
} from "@relay-14/shared";
import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { type ChainReader, type PaymentRow, type PaymentStore, type VerifiedPayment } from "./store.js";

export type VerifyInput = {
  paymentPayload: unknown;
  paymentRequirements: unknown;
  chainId: number;
  network: string;
  chain: ChainReader;
  store: PaymentStore;
  now?: () => string;
};

type Envelope = {
  signedTx: Hex;
  payTo: Address;
  maxAmountRequired: bigint;
  resource: string;
};

export async function verifyExactNativePayment(input: VerifyInput): Promise<VerifyResponse> {
  const envelope = readEnvelope(input.paymentPayload, input.paymentRequirements, input.network);
  if ("isValid" in envelope) {
    return envelope;
  }

  let tx;
  try {
    tx = parseTransaction(envelope.signedTx);
  } catch {
    return invalid(InvalidReason.InvalidPayload);
  }
  if (tx.type !== "eip1559" || tx.gas === undefined || tx.maxFeePerGas === undefined) {
    return invalid(InvalidReason.InvalidPayload);
  }

  if (tx.chainId !== input.chainId) {
    return invalid(InvalidReason.InvalidNetwork);
  }

  if (!tx.to || getAddress(tx.to) !== envelope.payTo) {
    return invalid(InvalidReason.InvalidRecipient);
  }

  const value = tx.value ?? 0n;
  if (value !== envelope.maxAmountRequired) {
    return invalid(value < envelope.maxAmountRequired ? InvalidReason.InsufficientValue : InvalidReason.Overpayment);
  }

  if (!isEmptyCalldata(tx.data)) {
    return invalid(InvalidReason.InvalidPayload);
  }

  let payer: Address;
  try {
    payer = getAddress(
      await recoverTransactionAddress({
        serializedTransaction: envelope.signedTx as TransactionSerialized,
      }),
    );
  } catch {
    return invalid(InvalidReason.InvalidPayload);
  }

  let pendingNonce: number;
  try {
    pendingNonce = await input.chain.getTransactionCount(payer);
  } catch {
    return invalid(InvalidReason.UnexpectedVerifyError, payer);
  }
  if (tx.nonce !== pendingNonce) {
    return invalid(InvalidReason.InvalidNonce, payer);
  }

  let balance: bigint;
  try {
    balance = await input.chain.getBalance(payer);
  } catch {
    return invalid(InvalidReason.UnexpectedVerifyError, payer);
  }
  if (balance < value + tx.gas * tx.maxFeePerGas) {
    return invalid(InvalidReason.InsufficientFunds, payer);
  }

  const txHash = keccak256(envelope.signedTx);
  const existing = await input.store.findByHash(txHash);
  const row: VerifiedPayment = {
    txHash,
    payer,
    payTo: envelope.payTo,
    amountWei: value.toString(),
    resource: envelope.resource,
    createdAt: (input.now ?? isoNow)(),
  };
  const stored = await rememberVerified(input.store, existing, row);
  if (stored) {
    return stored;
  }

  return { isValid: true, payer };
}

function readEnvelope(
  paymentPayload: unknown,
  paymentRequirements: unknown,
  configuredNetwork: string,
): Envelope | VerifyResponse {
  if (!isRecord(paymentPayload) || !isRecord(paymentRequirements)) {
    return invalid(InvalidReason.InvalidPayload);
  }
  if (paymentPayload.x402Version !== X402_VERSION) {
    return invalid(InvalidReason.InvalidVersion);
  }
  if (paymentPayload.scheme !== SCHEME || paymentRequirements.scheme !== SCHEME) {
    return invalid(InvalidReason.InvalidScheme);
  }
  if (typeof paymentPayload.network !== "string" || typeof paymentRequirements.network !== "string") {
    return invalid(InvalidReason.InvalidNetwork);
  }
  if (paymentPayload.network !== configuredNetwork || paymentRequirements.network !== configuredNetwork) {
    return invalid(InvalidReason.InvalidNetwork);
  }

  const payload = paymentPayload.payload;
  if (!isRecord(payload) || typeof payload.signedTx !== "string" || !isHex(payload.signedTx, { strict: false })) {
    return invalid(InvalidReason.InvalidPayload);
  }
  if (typeof paymentRequirements.payTo !== "string" || !isAddress(paymentRequirements.payTo, { strict: false })) {
    return invalid(InvalidReason.InvalidPayload);
  }
  if (
    typeof paymentRequirements.maxAmountRequired !== "string" ||
    !/^\d+$/.test(paymentRequirements.maxAmountRequired)
  ) {
    return invalid(InvalidReason.InvalidPayload);
  }
  if (typeof paymentRequirements.resource !== "string" || paymentRequirements.resource.length === 0) {
    return invalid(InvalidReason.InvalidPayload);
  }
  if (
    typeof paymentRequirements.maxTimeoutSeconds !== "number" ||
    !Number.isInteger(paymentRequirements.maxTimeoutSeconds) ||
    paymentRequirements.maxTimeoutSeconds < 1
  ) {
    return invalid(InvalidReason.InvalidPayload);
  }
  if (paymentRequirements.maxTimeoutSeconds > RECEIPT_TIMEOUT_SECONDS) {
    return invalid(InvalidReason.InvalidTimeout);
  }

  return {
    signedTx: payload.signedTx as Hex,
    payTo: getAddress(paymentRequirements.payTo),
    maxAmountRequired: BigInt(paymentRequirements.maxAmountRequired),
    resource: paymentRequirements.resource,
  };
}

async function rememberVerified(
  store: PaymentStore,
  existing: PaymentRow | null,
  row: VerifiedPayment,
): Promise<VerifyResponse | null> {
  let current = existing;
  if (!current) {
    try {
      await store.insertVerified(row);
      return null;
    } catch (error) {
      if (!isUniqueConstraint(error)) {
        throw error;
      }
      current = await store.findByHash(row.txHash);
      if (!current) {
        throw error;
      }
    }
  }

  // The first successful verify locks resource, payTo, and amount. A later call cannot retarget them.
  if (!sameBoundRequirements(current, row)) {
    return invalid(InvalidReason.RequirementsMismatch, row.payer);
  }
  // Same requirements on an already settled payment. Settle turns this into the stored success.
  if (current.status === "settled") {
    return invalid(InvalidReason.ReplayDetected, row.payer);
  }
  // Leave a settling row alone so the broadcaster keeps the lease. Only a failed row returns to verified.
  if (current.status === "failed") {
    await store.refreshVerified(row);
  }
  return null;
}

function sameBoundRequirements(existing: PaymentRow, row: VerifiedPayment): boolean {
  return (
    existing.resource === row.resource &&
    existing.payTo === row.payTo &&
    existing.amountWei === row.amountWei
  );
}

function isUniqueConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed/i.test(message);
}

function isEmptyCalldata(data: Hex | undefined): boolean {
  return data === undefined || data === "0x";
}

function invalid(invalidReason: string, payer?: string): VerifyResponse {
  return payer ? { isValid: false, invalidReason, payer } : { isValid: false, invalidReason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isoNow(): string {
  return new Date().toISOString();
}
