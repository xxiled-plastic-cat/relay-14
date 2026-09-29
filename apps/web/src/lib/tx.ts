export const EXPLORER_TX_URL = "https://liteforge.explorer.caldera.xyz/tx";

export const TRANSACTIONS_URL = import.meta.env.DEV
  ? "/api/transactions"
  : "https://relay-14-facilitator.compx.io/transactions";

export type SettledTransaction = {
  txHash: string;
  payer: string;
  payTo: string;
  amountWei: string;
  settledAt: string | null;
  blockNumber: number | null;
};

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_TX_URL}/${hash}`;
}

/** zkLTC has 18 decimals. Trim trailing zeros so 0.0001 does not render as a long fraction. */
export function formatZkltc(wei: string): string {
  if (!/^\d+$/.test(wei)) return wei;
  const padded = wei.padStart(19, "0");
  const whole = padded.slice(0, -18).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-18).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function formatSettledAt(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

export function shortHex(value: string): string {
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
