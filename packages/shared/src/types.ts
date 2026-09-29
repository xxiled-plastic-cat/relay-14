import { SCHEME, X402_VERSION } from "./constants.js";

export type ExactNativePayload = {
  signedTx: `0x${string}`;
};

/** v1 payment payload envelope. The inner payload is a signed, unbroadcast native transfer. */
export type PaymentPayload = {
  x402Version: typeof X402_VERSION;
  scheme: typeof SCHEME;
  network: string;
  payload: ExactNativePayload;
};

/** v1 payment requirements. `maxAmountRequired` is zkLTC wei as a decimal string. */
export type PaymentRequirements = {
  scheme: typeof SCHEME;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type PaymentRequired = {
  x402Version: typeof X402_VERSION;
  accepts: PaymentRequirements[];
  error?: string;
};

export type VerifyRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
};

export type SettleRequest = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

export type SettleResponse = {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
};

export type SupportedPaymentKind = {
  x402Version: typeof X402_VERSION;
  scheme: typeof SCHEME;
  network: string;
};
