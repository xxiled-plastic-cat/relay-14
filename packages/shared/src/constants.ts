export const SCHEME = "exact-native" as const;
export const NETWORK = "litvm-testnet" as const;
export const X402_VERSION = 1 as const;

/** Native zkLTC. Not an ERC-20. */
export const NATIVE_ASSET = "0x0000000000000000000000000000000000000000" as const;

export const DEFAULT_CHAIN_ID = 4441;
export const DEFAULT_RPC_URL = "https://liteforge.rpc.caldera.xyz/http";
export const EXPLORER_URL = "https://liteforge.explorer.caldera.xyz";

export const PAYMENT_HEADER = "X-PAYMENT";
export const PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";

/** How long `/settle` waits for a receipt. A requirement may not ask for longer. */
export const RECEIPT_TIMEOUT_SECONDS = 30;

export const InvalidReason = {
  InvalidPayload: "invalid_payload",
  InvalidScheme: "invalid_scheme",
  InvalidNetwork: "invalid_network",
  InvalidVersion: "invalid_x402_version",
  InvalidRecipient: "invalid_recipient",
  InsufficientValue: "insufficient_value",
  Overpayment: "overpayment",
  InvalidNonce: "invalid_nonce",
  InsufficientFunds: "insufficient_funds",
  ReplayDetected: "replay_detected",
  RequirementsMismatch: "requirements_mismatch",
  InvalidTimeout: "invalid_timeout",
  UnexpectedVerifyError: "unexpected_verify_error",
} as const;

export type InvalidReason = (typeof InvalidReason)[keyof typeof InvalidReason];

export const SettleErrorReason = {
  ConfirmationTimedOut: "confirmation_timed_out",
  SettlementInProgress: "settlement_in_progress",
  TransactionFailed: "transaction_failed",
  UnexpectedSettleError: "unexpected_settle_error",
} as const;

export type SettleErrorReason = (typeof SettleErrorReason)[keyof typeof SettleErrorReason];

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}
