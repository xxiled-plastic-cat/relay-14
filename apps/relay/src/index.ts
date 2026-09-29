import { InvalidReason, SCHEME, X402_VERSION } from "@relay-14/shared";
import { Hono } from "hono";
import { createRelay14PublicClient, createViemChainReader } from "./chain.js";
import { createViemSettlementClient, settleExactNativePayment } from "./settle.js";
import { createD1PaymentStore, listSettledPayments, type RelayDatabase } from "./store.js";
import { verifyExactNativePayment } from "./verify.js";

export type Relay14Env = {
  RELAY14: RelayDatabase;
  CHAIN_ID: string;
  RPC_URL: string;
  NETWORK: string;
};

const app = new Hono<{ Bindings: Relay14Env }>();

app.get("/transactions", async (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  const transactions = await listSettledPayments(c.env.RELAY14, 50);
  return c.json({ transactions });
});

app.get("/supported", (c) => {
  return c.json([
    {
      x402Version: X402_VERSION,
      scheme: SCHEME,
      network: c.env.NETWORK,
    },
  ]);
});

app.get("/health", async (c) => {
  const chainId = Number(c.env.CHAIN_ID);
  const chainIdOk = Number.isInteger(chainId);
  let rpc: "ok" | "down" = "down";
  let d1: "ok" | "down" = "down";

  if (chainIdOk) {
    try {
      const client = createRelay14PublicClient(c.env);
      const id = await client.getChainId();
      if (id === chainId) {
        rpc = "ok";
      }
    } catch {
      rpc = "down";
    }
  }

  try {
    const row = await c.env.RELAY14.prepare("SELECT 1 AS ok").bind().first<{ ok: number }>();
    if (row?.ok === 1) {
      d1 = "ok";
    }
  } catch {
    d1 = "down";
  }

  const ok = rpc === "ok" && d1 === "ok";
  return c.json(
    {
      ok,
      rpc,
      d1,
      ...(chainIdOk ? { chainId } : {}),
    },
    ok ? 200 : 503,
  );
});

app.post("/verify", async (c) => {
  const body = await readPaymentBody(c);
  if (body instanceof Response) {
    return body;
  }
  const chainId = Number(c.env.CHAIN_ID);
  if (!Number.isInteger(chainId)) {
    return c.json({ isValid: false, invalidReason: InvalidReason.InvalidNetwork });
  }

  try {
    const client = createRelay14PublicClient(c.env);
    const result = await verifyExactNativePayment({
      paymentPayload: body.paymentPayload,
      paymentRequirements: body.paymentRequirements,
      chainId,
      network: c.env.NETWORK,
      chain: createViemChainReader(client),
      store: createD1PaymentStore(c.env.RELAY14),
    });
    return c.json(result);
  } catch {
    return c.json({ isValid: false, invalidReason: InvalidReason.UnexpectedVerifyError });
  }
});

app.post("/settle", async (c) => {
  const body = await readPaymentBody(c);
  if (body instanceof Response) {
    return body;
  }
  const chainId = Number(c.env.CHAIN_ID);
  if (!Number.isInteger(chainId)) {
    return c.json({
      success: false,
      transaction: "0x",
      network: c.env.NETWORK,
      errorReason: InvalidReason.InvalidNetwork,
    });
  }

  try {
    const client = createRelay14PublicClient(c.env);
    const result = await settleExactNativePayment({
      paymentPayload: body.paymentPayload,
      paymentRequirements: body.paymentRequirements,
      chainId,
      network: c.env.NETWORK,
      chain: createViemChainReader(client),
      store: createD1PaymentStore(c.env.RELAY14),
      settlement: createViemSettlementClient(client),
    });
    return c.json(result);
  } catch {
    return c.json({
      success: false,
      transaction: "0x",
      network: c.env.NETWORK,
      errorReason: "unexpected_settle_error",
    });
  }
});

async function readPaymentBody(
  c: { req: { json(): Promise<unknown> }; json: (body: unknown, status?: number) => Response },
): Promise<{ paymentPayload: unknown; paymentRequirements: unknown } | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Missing paymentPayload or paymentRequirements" }, 400);
  }
  const record = body as Record<string, unknown>;
  if (!("paymentPayload" in record) || !("paymentRequirements" in record)) {
    return c.json({ error: "Missing paymentPayload or paymentRequirements" }, 400);
  }
  return {
    paymentPayload: record.paymentPayload,
    paymentRequirements: record.paymentRequirements,
  };
}

export default app;
