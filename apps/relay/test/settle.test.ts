import { InvalidReason, NETWORK, RECEIPT_TIMEOUT_SECONDS, SettleErrorReason } from "@relay-14/shared";
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

async function settle(
  signedTx: Hex,
  client: SettlementClient,
  store = createMemoryPaymentStore(),
  requirements = paymentRequirements(),
  timing?: { peerWaitTimeoutMs?: number; peerPollIntervalMs?: number },
) {
  return {
    store,
    result: await settleExactNativePayment({
      paymentPayload: paymentPayload(signedTx),
      paymentRequirements: requirements,
      peerWaitTimeoutMs: timing?.peerWaitTimeoutMs,
      peerPollIntervalMs: timing?.peerPollIntervalMs,
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
    expect(result.success).toBe(true);
    expect(result.transaction).toBe(hash);
    expect(result.payer).toBe(getAddress(account.address));
    expect(store.rows.get(hash)?.status).toBe("settled");
  });

  test("does not return success for a settled hash and a different resource", async () => {
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
    const { result } = await settle(
      signedTx,
      settlement({ sent }),
      store,
      paymentRequirements({ resource: "https://relay-14.example/cheap" }),
    );

    expect(sent).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(InvalidReason.RequirementsMismatch);
    expect(store.rows.get(hash)?.status).toBe("settled");
  });

  test("does not settle a hash for a different resource than the one first verified", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    store.rows.set(hash, {
      txHash: hash,
      payer: getAddress(account.address),
      payTo: getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
      amountWei: VALUE.toString(),
      resource: "https://relay-14.example/fortune",
      status: "verified",
      error: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      settledAt: null,
      blockNumber: null,
    });
    const sent: Hex[] = [];
    const { result } = await settle(
      signedTx,
      settlement({ sent }),
      store,
      paymentRequirements({ resource: "https://relay-14.example/cheap" }),
    );

    expect(sent).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(InvalidReason.RequirementsMismatch);
    expect(store.rows.get(hash)).toMatchObject({
      status: "verified",
      resource: "https://relay-14.example/fortune",
    });
  });

  test("does not settle an overpayment against a cheaper price", async () => {
    const signedTx = await signTransfer();
    const sent: Hex[] = [];
    const { result, store } = await settle(
      signedTx,
      settlement({ sent }),
      createMemoryPaymentStore(),
      paymentRequirements({ maxAmountRequired: (VALUE - 1n).toString() }),
    );

    expect(sent).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(InvalidReason.Overpayment);
    expect(store.rows.size).toBe(0);
  });

  test("does not settle a requirement that asks for a longer receipt wait", async () => {
    const signedTx = await signTransfer();
    const sent: Hex[] = [];
    const { result, store } = await settle(
      signedTx,
      settlement({ sent }),
      createMemoryPaymentStore(),
      paymentRequirements({ maxTimeoutSeconds: RECEIPT_TIMEOUT_SECONDS + 30 }),
    );

    expect(sent).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(InvalidReason.InvalidTimeout);
    expect(store.rows.size).toBe(0);
  });

  test("only the claimer broadcasts when two settles overlap", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    let settlingReads = 0;
    const findByHash = store.findByHash.bind(store);
    store.findByHash = async (txHash) => {
      const row = await findByHash(txHash);
      if (row?.status === "settling") {
        settlingReads += 1;
      }
      return row;
    };
    const sent: Hex[] = [];
    let release: (receipt: { status: "success"; blockNumber: bigint }) => void = () => {};
    const gate = new Promise<{ status: "success"; blockNumber: bigint }>((resolve) => {
      release = resolve;
    });
    const client = settlement({
      sent,
      async waitForTransactionReceipt() {
        return gate;
      },
    });
    const timing = { peerPollIntervalMs: 5, peerWaitTimeoutMs: 2_000 };

    const first = settle(signedTx, client, store, paymentRequirements(), timing);
    await waitUntil(() => store.rows.get(hash)?.status === "settling" && sent.length === 1);
    const second = settle(signedTx, client, store, paymentRequirements(), timing);
    await waitUntil(() => settlingReads >= 2);

    expect(sent).toHaveLength(1);
    release({ status: "success", blockNumber: 12n });
    const [leader, follower] = await Promise.all([first, second]);

    expect(leader.result.success).toBe(true);
    expect(follower.result.success).toBe(true);
    expect(follower.result.transaction).toBe(hash);
    expect(sent).toHaveLength(1);
    expect(store.rows.get(hash)?.status).toBe("settled");
  });

  test("a waiting settle returns the broadcaster failure without sending", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    store.rows.set(hash, {
      txHash: hash,
      payer: getAddress(account.address),
      payTo: getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
      amountWei: VALUE.toString(),
      resource: "https://relay-14.example/fortune",
      status: "settling",
      error: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      settledAt: null,
      blockNumber: null,
    });
    let settlingReads = 0;
    const findByHash = store.findByHash.bind(store);
    store.findByHash = async (txHash) => {
      const row = await findByHash(txHash);
      if (row?.status === "settling") {
        settlingReads += 1;
      }
      return row;
    };
    const sent: Hex[] = [];
    const pending = settle(signedTx, settlement({ sent }), store, paymentRequirements(), {
      peerPollIntervalMs: 5,
      peerWaitTimeoutMs: 2_000,
    });
    await waitUntil(() => settlingReads >= 1);
    await store.markFailed(hash, SettleErrorReason.TransactionFailed);
    const { result } = await pending;

    expect(sent).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(SettleErrorReason.TransactionFailed);
    expect(store.rows.get(hash)?.status).toBe("failed");
  });

  test("a settle that loses the claim does not broadcast or fail the row", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    store.rows.set(hash, {
      txHash: hash,
      payer: getAddress(account.address),
      payTo: getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
      amountWei: VALUE.toString(),
      resource: "https://relay-14.example/fortune",
      status: "settling",
      error: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      settledAt: null,
      blockNumber: null,
    });
    const sent: Hex[] = [];
    const { result } = await settle(
      signedTx,
      settlement({
        sent,
        async waitForTransactionReceipt() {
          throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
        },
      }),
      store,
      paymentRequirements(),
      {
        peerPollIntervalMs: 5,
        peerWaitTimeoutMs: 30,
      },
    );

    expect(sent).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(SettleErrorReason.ConfirmationTimedOut);
    expect(store.rows.get(hash)?.status).toBe("settling");
  });

  test("a receipt timeout leaves the payment settling and a retry does not broadcast again", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    const sent: Hex[] = [];
    let receipts = 0;
    const client = settlement({
      sent,
      async waitForTransactionReceipt() {
        receipts += 1;
        if (receipts === 1) {
          throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
        }
        return { status: "success", blockNumber: 14n };
      },
    });

    const first = await settle(signedTx, client, store);
    expect(first.result.success).toBe(false);
    expect(first.result.errorReason).toBe(SettleErrorReason.ConfirmationTimedOut);
    expect(store.rows.get(hash)?.status).toBe("settling");
    expect(sent).toHaveLength(1);

    const second = await settle(signedTx, client, store, paymentRequirements(), {
      peerPollIntervalMs: 5,
      peerWaitTimeoutMs: 20,
    });
    expect(sent).toHaveLength(1);
    expect(second.result.success).toBe(true);
    expect(second.result.transaction).toBe(hash);
    expect(store.rows.get(hash)?.status).toBe("settled");
  });

  test("an already-known broadcast is not marked failed when the receipt times out", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    const sent: Hex[] = [];
    const { result } = await settle(
      signedTx,
      settlement({
        sent,
        async sendRawTransaction() {
          throw new Error("already known");
        },
        async waitForTransactionReceipt() {
          throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
        },
      }),
      store,
    );

    expect(sent).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe(SettleErrorReason.ConfirmationTimedOut);
    expect(store.rows.get(hash)?.status).toBe("settling");
  });
});

async function waitUntil(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for settle state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
