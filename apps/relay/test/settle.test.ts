import { InvalidReason, NETWORK, SettleErrorReason } from "@relay-14/shared";
import { getAddress, keccak256, type Hex } from "viem";
import { describe, expect, test } from "vitest";
import { settleExactNativePayment, type SettlementClient } from "../src/settle.js";
import {
  VALUE,
  account,
  createMemoryPaymentStore,
  paymentPayload,
  paymentRequirements,
  requiredBalance,
  signTransfer,
} from "./fixtures.js";

function settlement(overrides?: Partial<SettlementClient> & { sent?: Hex[] }): SettlementClient {
  const sent = overrides?.sent ?? [];
  return {
    async sendRawTransaction(serializedTransaction) {
      sent.push(serializedTransaction);
      if (overrides?.sendRawTransaction) {
        return overrides.sendRawTransaction(serializedTransaction);
      }
      return keccak256(serializedTransaction);
    },
    async waitForTransactionReceipt(hash) {
      if (overrides?.waitForTransactionReceipt) {
        return overrides.waitForTransactionReceipt(hash);
      }
      return { status: "success", blockNumber: 12n };
    },
  };
}

async function settle(signedTx: Hex, client: SettlementClient, store = createMemoryPaymentStore()) {
  return {
    store,
    result: await settleExactNativePayment({
      paymentPayload: paymentPayload(signedTx),
      paymentRequirements: paymentRequirements(),
      chainId: 4441,
      network: NETWORK,
      chain: {
        async getTransactionCount() {
          return 0;
        },
        async getBalance() {
          return requiredBalance();
        },
      },
      store,
      settlement: client,
      now: () => "2026-09-29T12:00:00.000Z",
    }),
  };
}

describe("settle exact-native", () => {
  test("broadcasts a verified transfer and marks the row settled", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const { result, store } = await settle(signedTx, settlement());

    expect(result).toEqual({
      success: true,
      transaction: hash,
      network: NETWORK,
      payer: getAddress(account.address),
    });
    expect(store.rows.get(hash)).toMatchObject({
      status: "settled",
      blockNumber: 12,
      settledAt: "2026-09-29T12:00:00.000Z",
      amountWei: VALUE.toString(),
    });
  });

  test("marks a reverted receipt failed and does not report success", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const { result, store } = await settle(
      signedTx,
      settlement({
        async waitForTransactionReceipt() {
          return { status: "reverted", blockNumber: 13n };
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(SettleErrorReason.TransactionFailed);
    expect(result.transaction).toBe(hash);
    expect(store.rows.get(hash)?.status).toBe("failed");
  });

  test("does not broadcast a hash that is already settled", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    store.rows.set(hash, {
      txHash: hash,
      payer: getAddress(account.address),
      payTo: getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
      amountWei: VALUE.toString(),
      resource: "https://relay-14.example/fortune",
      status: "settled",
      error: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      settledAt: "2026-09-29T00:00:01.000Z",
      blockNumber: 9,
    });
    const sent: Hex[] = [];
    const { result } = await settle(signedTx, settlement({ sent }), store);

    expect(sent).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(InvalidReason.ReplayDetected);
    expect(store.rows.get(hash)?.status).toBe("settled");
  });
});
