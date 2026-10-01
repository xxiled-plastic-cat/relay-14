import {
  InvalidReason,
  NETWORK,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  SCHEME,
  SettleErrorReason,
  RECEIPT_TIMEOUT_SECONDS,
  X402_VERSION,
  encodeJsonHeader,
} from "@relay-14/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";
import { paymentMiddleware } from "../src/index.js";

const PAY_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function app() {
  const app = new Hono();
  app.use(
    "*",
    paymentMiddleware({
      priceWei: "1",
      payTo: PAY_TO,
      facilitatorUrl: "https://facilitator.test",
      description: "A fortune",
    }),
  );
  app.get("/fortune", (c) => c.json({ ok: true }));
  return app;
}

function paymentHeader(): string {
  return encodeJsonHeader({
    x402Version: X402_VERSION,
    scheme: SCHEME,
    network: NETWORK,
    payload: { signedTx: "0xabc" },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFacilitator(verify: unknown, settle: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/verify")) {
        return jsonResponse(verify);
      }
      if (String(url).endsWith("/settle")) {
        return jsonResponse(settle);
      }
      return jsonResponse({ error: "unexpected" }, 404);
    }),
  );
}

describe("payment middleware", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("does not ask for a new payment when confirmation times out", async () => {
    stubFacilitator(
      { isValid: true, payer: PAY_TO },
      {
        success: false,
        errorReason: SettleErrorReason.ConfirmationTimedOut,
        transaction: "0xhash",
        network: NETWORK,
      },
    );

    const response = await app().request("/fortune", {
      headers: { [PAYMENT_HEADER]: paymentHeader() },
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: SettleErrorReason.ConfirmationTimedOut, transaction: "0xhash" });
    expect(body).not.toHaveProperty("accepts");
  });

  test("does not ask for a new payment while settlement is in progress", async () => {
    stubFacilitator(
      { isValid: true, payer: PAY_TO },
      {
        success: false,
        errorReason: SettleErrorReason.SettlementInProgress,
        transaction: "0xhash",
        network: NETWORK,
      },
    );

    const response = await app().request("/fortune", {
      headers: { [PAYMENT_HEADER]: paymentHeader() },
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: SettleErrorReason.SettlementInProgress, transaction: "0xhash" });
    expect(body).not.toHaveProperty("accepts");
  });

  test("delivers the route when the same settled payment is submitted again", async () => {
    stubFacilitator(
      { isValid: false, invalidReason: InvalidReason.ReplayDetected, payer: PAY_TO },
      {
        success: true,
        transaction: "0xhash",
        network: NETWORK,
        payer: PAY_TO,
      },
    );

    const response = await app().request("/fortune", {
      headers: { [PAYMENT_HEADER]: paymentHeader() },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).toBeTruthy();
  });

  test("advertises the facilitator receipt timeout, not a longer one", async () => {
    const longer = new Hono();
    longer.use(
      "*",
      paymentMiddleware({
        priceWei: "1",
        payTo: PAY_TO,
        facilitatorUrl: "https://facilitator.test",
        description: "A fortune",
        maxTimeoutSeconds: RECEIPT_TIMEOUT_SECONDS + 30,
      }),
    );
    longer.get("/fortune", (c) => c.json({ ok: true }));

    const response = await longer.request("/fortune");
    const body = (await response.json()) as { accepts?: Array<{ maxTimeoutSeconds?: number }> };

    expect(response.status).toBe(402);
    expect(body.accepts?.[0]?.maxTimeoutSeconds).toBe(RECEIPT_TIMEOUT_SECONDS);
  });

  test("still asks for a new payment when the transfer reverted", async () => {
    stubFacilitator(
      { isValid: true, payer: PAY_TO },
      {
        success: false,
        errorReason: SettleErrorReason.TransactionFailed,
        transaction: "0xhash",
        network: NETWORK,
      },
    );

    const response = await app().request("/fortune", {
      headers: { [PAYMENT_HEADER]: paymentHeader() },
    });
    const body = (await response.json()) as { accepts?: unknown; error?: string };

    expect(response.status).toBe(402);
    expect(body.error).toBe(SettleErrorReason.TransactionFailed);
    expect(body.accepts).toHaveLength(1);
  });
});
