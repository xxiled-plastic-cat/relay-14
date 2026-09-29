import type { MiddlewareHandler } from "hono";
import {
  InvalidReason,
  NATIVE_ASSET,
  NETWORK,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  SCHEME,
  X402_VERSION,
  decodeJsonHeader,
  encodeJsonHeader,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "@relay-14/shared";

export type PaymentMiddlewareOptions = {
  /** Price in zkLTC wei. */
  priceWei: string;
  payTo: string;
  facilitatorUrl: string;
  description: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  network?: string;
};

export function paymentMiddleware(options: PaymentMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const requirements = buildRequirements(options, c.req.url);
    const header = c.req.header(PAYMENT_HEADER);
    if (!header) {
      return c.json(paymentRequired(requirements), 402);
    }

    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = decodeJsonHeader<PaymentPayload>(header);
    } catch {
      return c.json(paymentRequired(requirements, InvalidReason.InvalidPayload), 402);
    }

    const facilitator = options.facilitatorUrl.replace(/\/$/, "");
    let settled: { ok: boolean; body: SettleResponse };
    try {
      const verified = await postJson<VerifyResponse>(`${facilitator}/verify`, {
        paymentPayload,
        paymentRequirements: requirements,
      });
      if (!verified.ok || !verified.body?.isValid) {
        const reason = verified.body?.invalidReason ?? InvalidReason.UnexpectedVerifyError;
        return c.json(paymentRequired(requirements, reason), 402);
      }

      settled = await postJson<SettleResponse>(`${facilitator}/settle`, {
        paymentPayload,
        paymentRequirements: requirements,
      });
    } catch {
      return c.json(paymentRequired(requirements, InvalidReason.UnexpectedVerifyError), 402);
    }

    if (!settled.ok || !settled.body?.success) {
      const reason = settled.body?.errorReason ?? "unexpected_settle_error";
      return c.json(paymentRequired(requirements, reason), 402);
    }

    await next();
    c.header(PAYMENT_RESPONSE_HEADER, encodeJsonHeader(settled.body));
  };
}

function buildRequirements(options: PaymentMiddlewareOptions, resource: string): PaymentRequirements {
  return {
    scheme: SCHEME,
    network: options.network ?? NETWORK,
    maxAmountRequired: options.priceWei,
    resource,
    description: options.description,
    mimeType: options.mimeType ?? "application/json",
    payTo: options.payTo,
    maxTimeoutSeconds: options.maxTimeoutSeconds ?? 60,
    asset: NATIVE_ASSET,
  };
}

function paymentRequired(requirements: PaymentRequirements, error?: string) {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    accepts: [requirements],
  };
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; body: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    const parsed = (await response.json()) as T;
    return { ok: response.ok, body: parsed };
  } catch {
    return { ok: false, body: {} as T };
  }
}
