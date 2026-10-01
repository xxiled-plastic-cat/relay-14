import {
  NATIVE_ASSET,
  NETWORK,
  RECEIPT_TIMEOUT_SECONDS,
  SCHEME,
  type PaymentPayload,
  type PaymentRequirements,
} from "@relay-14/shared";
import { privateKeyToAccount } from "viem/accounts";
import { type Address, type Hex } from "viem";
import { type PaymentRow, type PaymentStore } from "../src/store.js";

export const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const account = privateKeyToAccount(TEST_KEY);
export const PAY_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const VALUE = 100_000_000_000_000n;
export const GAS = 21_000n;
export const MAX_FEE = 1_000_000_000n;

export function requiredBalance(value = VALUE, gas = GAS, maxFee = MAX_FEE): bigint {
  return value + gas * maxFee;
}

type TransferFields = {
  chainId?: number;
  to?: Address;
  value?: bigint;
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  data?: Hex;
};

export async function signTransfer(overrides: TransferFields = {}): Promise<Hex> {
  return account.signTransaction({
    type: "eip1559",
    chainId: overrides.chainId ?? 4441,
    to: overrides.to ?? PAY_TO,
    value: overrides.value ?? VALUE,
    nonce: overrides.nonce ?? 0,
    gas: overrides.gas ?? GAS,
    maxFeePerGas: overrides.maxFeePerGas ?? MAX_FEE,
    maxPriorityFeePerGas: 1_000_000n,
    data: overrides.data ?? "0x",
  });
}

export function paymentPayload(signedTx: Hex, network = NETWORK): PaymentPayload {
  return {
    x402Version: 1,
    scheme: SCHEME,
    network,
    payload: { signedTx },
  };
}

export function paymentRequirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: SCHEME,
    network: NETWORK,
    maxAmountRequired: VALUE.toString(),
    resource: "https://relay-14.example/fortune",
    description: "A fortune from Relay-14",
    mimeType: "application/json",
    payTo: PAY_TO.toLowerCase(),
    maxTimeoutSeconds: RECEIPT_TIMEOUT_SECONDS,
    asset: NATIVE_ASSET,
    ...overrides,
  };
}

export function createMemoryPaymentStore(): PaymentStore & { rows: Map<string, PaymentRow> } {
  const rows = new Map<string, PaymentRow>();
  return {
    rows,
    async findByHash(txHash) {
      return rows.get(txHash) ?? null;
    },
    async insertVerified(row) {
      if (rows.has(row.txHash)) {
        throw new Error("UNIQUE constraint failed: payments.tx_hash");
      }
      rows.set(row.txHash, {
        ...row,
        status: "verified",
        error: null,
        settledAt: null,
        blockNumber: null,
      });
    },
    async refreshVerified(row) {
      const existing = rows.get(row.txHash);
      if (!existing || existing.status !== "failed") {
        return;
      }
      rows.set(row.txHash, {
        ...existing,
        status: "verified",
        error: null,
      });
    },
    async claimSettling(txHash) {
      const existing = rows.get(txHash);
      if (!existing || existing.status !== "verified") {
        return false;
      }
      rows.set(txHash, { ...existing, status: "settling", error: null });
      return true;
    },
    async markSettled(txHash, blockNumber, settledAt) {
      const existing = rows.get(txHash);
      if (!existing || existing.status !== "settling") {
        return;
      }
      rows.set(txHash, {
        ...existing,
        status: "settled",
        settledAt,
        blockNumber,
        error: null,
      });
    },
    async markFailed(txHash, error) {
      const existing = rows.get(txHash);
      if (!existing || existing.status !== "settling") {
        return;
      }
      rows.set(txHash, {
        ...existing,
        status: "failed",
        error,
      });
    },
  };
}
