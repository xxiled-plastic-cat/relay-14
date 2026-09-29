import {
  InvalidReason,
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
import { type ChainReader, type PaymentStore, type VerifiedPayment } from "./store.js";

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
  if (value < envelope.maxAmountRequired) {
    return invalid(InvalidReason.InsufficientValue);
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
  // A settled row is a replay. A verified or failed row can be checked again so settle can re-run verify.
  if (existing?.status === "settled") {
    return invalid(InvalidReason.ReplayDetected, payer);
  }

  const row: VerifiedPayment = {
    txHash,
    payer,
    payTo: envelope.payTo,
    amountWei: value.toString(),
    resource: envelope.resource,
    createdAt: (input.now ?? isoNow)(),
  };
  if (existing) {
    await input.store.refreshVerified(row);
  } else {
    await input.store.insertVerified(row);
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

  return {
    signedTx: payload.signedTx as Hex,
    payTo: getAddress(paymentRequirements.payTo),
    maxAmountRequired: BigInt(paymentRequirements.maxAmountRequired),
    resource: paymentRequirements.resource,
  };
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
