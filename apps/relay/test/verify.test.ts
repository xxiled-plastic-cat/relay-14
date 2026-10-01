import { decodeJsonHeader, encodeJsonHeader, InvalidReason, NETWORK, RECEIPT_TIMEOUT_SECONDS } from "@relay-14/shared";
import { getAddress, keccak256 } from "viem";
import { describe, expect, test } from "vitest";
import { verifyExactNativePayment } from "../src/verify.js";
import {
  PAY_TO,
  VALUE,
  account,
  createMemoryPaymentStore,
  paymentPayload,
  paymentRequirements,
  requiredBalance,
  signTransfer,
} from "./fixtures.js";

const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

async function verifySigned(
  signedTx: `0x${string}`,
  options?: {
    nonce?: number;
    balance?: bigint;
    requirements?: ReturnType<typeof paymentRequirements>;
    store?: ReturnType<typeof createMemoryPaymentStore>;
  },
) {
  const store = options?.store ?? createMemoryPaymentStore();
  const result = await verifyExactNativePayment({
    paymentPayload: paymentPayload(signedTx),
    paymentRequirements: options?.requirements ?? paymentRequirements(),
    chainId: 4441,
    network: NETWORK,
    chain: {
      async getTransactionCount() {
        return options?.nonce ?? 0;
      },
      async getBalance() {
        return options?.balance ?? requiredBalance();
      },
    },
    store,
  });
  return { result, store };
}

describe("verify exact-native", () => {
  test("accepts a plain transfer whose payTo differs only by checksum", async () => {
    const signedTx = await signTransfer();
    const { result, store } = await verifySigned(signedTx);

    expect(result).toEqual({ isValid: true, payer: getAddress(account.address) });
    expect(store.rows.size).toBe(1);
    const row = [...store.rows.values()][0];
    expect(row?.status).toBe("verified");
    expect(row?.payTo).toBe(getAddress(PAY_TO));
    expect(row?.amountWei).toBe(VALUE.toString());
  });

  test("rejects the wrong chain", async () => {
    const signedTx = await signTransfer({ chainId: 1 });
    const { result, store } = await verifySigned(signedTx);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.InvalidNetwork);
    expect(store.rows.size).toBe(0);
  });

  test("rejects the wrong recipient", async () => {
    const signedTx = await signTransfer({ to: OTHER });
    const { result } = await verifySigned(signedTx);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.InvalidRecipient);
  });

  test("rejects a transfer short by 1 wei", async () => {
    const signedTx = await signTransfer({ value: VALUE - 1n });
    const { result } = await verifySigned(signedTx);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.InsufficientValue);
  });

  test("rejects a transfer over by 1 wei", async () => {
    const signedTx = await signTransfer({ value: VALUE + 1n });
    const { result, store } = await verifySigned(signedTx);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.Overpayment);
    expect(store.rows.size).toBe(0);
  });

  test("rejects a requirement that asks to wait longer than the facilitator", async () => {
    const signedTx = await signTransfer();
    const { result, store } = await verifySigned(signedTx, {
      requirements: paymentRequirements({ maxTimeoutSeconds: RECEIPT_TIMEOUT_SECONDS + 1 }),
    });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.InvalidTimeout);
    expect(store.rows.size).toBe(0);
  });

  test("rejects calldata", async () => {
    const signedTx = await signTransfer({ data: "0xabcd" });
    const { result } = await verifySigned(signedTx);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.InvalidPayload);
  });

  test("rejects a stale nonce", async () => {
    const signedTx = await signTransfer({ nonce: 0 });
    const { result } = await verifySigned(signedTx, { nonce: 4 });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.InvalidNonce);
    expect(result.payer).toBe(getAddress(account.address));
  });

  test("rejects a balance below value plus gas times maxFeePerGas", async () => {
    const signedTx = await signTransfer();
    const { result } = await verifySigned(signedTx, { balance: requiredBalance() - 1n });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.InsufficientFunds);
    expect(result.payer).toBe(getAddress(account.address));
  });

  test("rejects a transaction hash that is already settled", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    store.rows.set(hash, {
      txHash: hash,
      payer: getAddress(account.address),
      payTo: getAddress(PAY_TO),
      amountWei: VALUE.toString(),
      resource: "https://relay-14.example/fortune",
      status: "settled",
      error: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      settledAt: "2026-09-29T00:00:01.000Z",
      blockNumber: 10,
    });

    const { result } = await verifySigned(signedTx, { store });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.ReplayDetected);
    expect(store.rows.get(hash)?.status).toBe("settled");
  });

  test("leaves a settling row in place", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    store.rows.set(hash, {
      txHash: hash,
      payer: getAddress(account.address),
      payTo: getAddress(PAY_TO),
      amountWei: VALUE.toString(),
      resource: "https://relay-14.example/fortune",
      status: "settling",
      error: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      settledAt: null,
      blockNumber: null,
    });

    const { result } = await verifySigned(signedTx, { store });

    expect(result.isValid).toBe(true);
    expect(store.rows.get(hash)?.status).toBe("settling");
  });

  test("refreshes a verified row so settle can re-run verify", async () => {
    const signedTx = await signTransfer();
    const store = createMemoryPaymentStore();
    const first = await verifySigned(signedTx, { store });
    const second = await verifySigned(signedTx, { store });

    expect(first.result.isValid).toBe(true);
    expect(second.result.isValid).toBe(true);
    expect(store.rows.size).toBe(1);
    const row = [...store.rows.values()][0];
    expect(row?.status).toBe("verified");
    expect(row?.resource).toBe("https://relay-14.example/fortune");
    expect(row?.payTo).toBe(getAddress(PAY_TO));
    expect(row?.amountWei).toBe(VALUE.toString());
  });

  test("rejects a later verify that names a different resource", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    const first = await verifySigned(signedTx, { store });
    const second = await verifySigned(signedTx, {
      store,
      requirements: paymentRequirements({ resource: "https://relay-14.example/cheap" }),
    });

    expect(first.result.isValid).toBe(true);
    expect(second.result.isValid).toBe(false);
    expect(second.result.invalidReason).toBe(InvalidReason.RequirementsMismatch);
    expect(second.result.payer).toBe(getAddress(account.address));
    expect(store.rows.get(hash)).toMatchObject({
      status: "verified",
      resource: "https://relay-14.example/fortune",
      payTo: getAddress(PAY_TO),
      amountWei: VALUE.toString(),
    });
  });

  test("does not retarget payTo or amount on a later verify", async () => {
    const signedTx = await signTransfer();
    const hash = keccak256(signedTx);
    const store = createMemoryPaymentStore();
    store.rows.set(hash, {
      txHash: hash,
      payer: getAddress(account.address),
      payTo: getAddress(OTHER),
      amountWei: "1",
      resource: "https://relay-14.example/fortune",
      status: "verified",
      error: null,
      createdAt: "2026-09-29T00:00:00.000Z",
      settledAt: null,
      blockNumber: null,
    });

    const { result } = await verifySigned(signedTx, { store });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe(InvalidReason.RequirementsMismatch);
    expect(store.rows.get(hash)).toMatchObject({
      status: "verified",
      payTo: getAddress(OTHER),
      amountWei: "1",
      resource: "https://relay-14.example/fortune",
    });
  });

  test("roundtrips the X-PAYMENT header codec", () => {
    const payload = paymentPayload("0xabc");
    expect(decodeJsonHeader(encodeJsonHeader(payload))).toEqual(payload);
  });
});
