import packageJson from "../package.json" with { type: "json" };
import { type RelayDatabase } from "./store.js";

export const RELAY_PACKAGE_VERSION = packageJson.version;

export const NF_STATS_SCHEMA = "nf-stats/v1" as const;
export const NF_STATS_PROJECT = "relay-14";
export const NF_STATS_NAME = "Relay-14";
export const NF_STATS_PUBLIC_URL = "https://relay-14.compx.io";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_UPLOAD_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const PAYMENT_COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM payments WHERE status = 'settled') AS settled_all_time,
  (SELECT COUNT(*) FROM payments WHERE status = 'settled' AND settled_at >= ?) AS settled_30d,
  (SELECT COUNT(DISTINCT payer) FROM payments WHERE status = 'settled') AS unique_payers,
  (SELECT COUNT(*) FROM payments WHERE status = 'failed') AS failed_all_time`;

export type StatPeriod = "all_time" | "30d" | "current";

export type NfStat = {
  id: string;
  label: string;
  value: number;
  unit: "count";
  period: StatPeriod;
  as_of: string;
  source?: string;
};

export type NfStatsDocument = {
  schema: typeof NF_STATS_SCHEMA;
  project: string;
  name: string;
  status: "live";
  version: string;
  url: string;
  networks: string[];
  updated_at: string;
  stats: NfStat[];
};

export type PaymentCounts = {
  settledAllTime: number;
  settled30d: number;
  uniquePayers: number;
  failedAllTime: number;
};

export type StatsEnv = {
  RELAY14: RelayDatabase;
  NETWORK: string;
  NF_STATS_URL?: string;
  NF_STATS_TOKEN?: string;
};

export class NfStatsUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NfStatsUploadError";
  }
}

export function redactSecret(message: string, secret: string): string {
  if (!secret) {
    return message;
  }
  return message.split(secret).join("[redacted]");
}

export function settledSince(now: Date): string {
  return new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
}

export function paymentCountsCommand(settledSinceIso: string): string {
  if (!ISO_UTC.test(settledSinceIso)) {
    throw new Error("invalid settled-since timestamp");
  }
  const placeholder = "settled_at >= ?";
  if (!PAYMENT_COUNTS_SQL.includes(placeholder)) {
    throw new Error("payment counts SQL is missing its timestamp placeholder");
  }
  return PAYMENT_COUNTS_SQL.replace(placeholder, `settled_at >= '${settledSinceIso}'`);
}

export function readCount(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  throw new Error(`missing count: ${name}`);
}

export function paymentCountsFromRow(row: Record<string, unknown> | null): PaymentCounts {
  if (row === null) {
    throw new Error("payment counts query returned no row");
  }
  return {
    settledAllTime: readCount(row.settled_all_time, "settled_all_time"),
    settled30d: readCount(row.settled_30d, "settled_30d"),
    uniquePayers: readCount(row.unique_payers, "unique_payers"),
    failedAllTime: readCount(row.failed_all_time, "failed_all_time"),
  };
}

export function paymentCountsFromWranglerStdout(stdout: string): PaymentCounts {
  const start = stdout.search(/[\[{]/);
  if (start < 0) {
    throw new Error("D1 execute returned no JSON");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(stdout.slice(start));
  } catch {
    throw new Error("D1 execute returned no JSON");
  }
  const entry = Array.isArray(payload) ? payload[0] : payload;
  if (entry === undefined || typeof entry !== "object" || entry === null) {
    throw new Error("payment counts query returned no row");
  }
  const record = entry as { success?: unknown; results?: unknown; error?: unknown };
  if (record.success === false) {
    const detail = typeof record.error === "string" ? record.error : "D1 execute failed";
    throw new Error(detail);
  }
  if (!Array.isArray(record.results) || record.results.length === 0) {
    throw new Error("payment counts query returned no row");
  }
  const row = record.results[0];
  if (typeof row !== "object" || row === null) {
    throw new Error("payment counts query returned no row");
  }
  return paymentCountsFromRow(row as Record<string, unknown>);
}

export async function queryPaymentCounts(db: RelayDatabase, now: Date): Promise<PaymentCounts> {
  const row = await db.prepare(PAYMENT_COUNTS_SQL).bind(settledSince(now)).first<Record<string, unknown>>();
  return paymentCountsFromRow(row);
}

export function buildNfStatsDocument(input: {
  version: string;
  network: string;
  counts: PaymentCounts;
  now: Date;
}): NfStatsDocument {
  const version = input.version.trim();
  const network = input.network.trim();
  if (!version) {
    throw new Error("package version is missing");
  }
  if (!network) {
    throw new Error("NETWORK is missing");
  }
  assertCount(input.counts.settledAllTime, "settled_all_time");
  assertCount(input.counts.settled30d, "settled_30d");
  assertCount(input.counts.uniquePayers, "unique_payers");
  assertCount(input.counts.failedAllTime, "failed_all_time");

  const updatedAt = input.now.toISOString();
  const networks = [network];
  return {
    schema: NF_STATS_SCHEMA,
    project: NF_STATS_PROJECT,
    name: NF_STATS_NAME,
    status: "live",
    version,
    url: NF_STATS_PUBLIC_URL,
    networks,
    updated_at: updatedAt,
    stats: [
      countStat("settled_payments", "Settled payments", input.counts.settledAllTime, "all_time", updatedAt, "D1 payments"),
      countStat("settled_30d", "Settled, 30 days", input.counts.settled30d, "30d", updatedAt, "D1 payments"),
      countStat("unique_payers", "Unique payers", input.counts.uniquePayers, "all_time", updatedAt, "D1 payments"),
      countStat("failed_payments", "Failed settlements", input.counts.failedAllTime, "all_time", updatedAt, "D1 payments"),
      countStat("networks_supported", "Networks", networks.length, "current", updatedAt, "NETWORK"),
    ],
  };
}

type PutNfStatsOptions = {
  url: string;
  token: string;
  document: NfStatsDocument;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export async function putNfStats(options: PutNfStatsOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? ((message: string) => console.log(message));
  const body = JSON.stringify(options.document);
  let lastError = "unknown error";

  for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) {
        break;
      }
      await sleep(delay);
    }

    try {
      const response = await fetchImpl(options.url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.token}`,
        },
        body,
        redirect: "manual",
      });
      const text = (await response.text()).trim();
      if (response.status === 200 && text === "ok") {
        return;
      }
      lastError = `${response.status} ${text.slice(0, 500)}`;
      if (response.status < 500) {
        failUpload(`nf-stats upload failed: ${lastError}`, options.token, log);
      }
    } catch (error) {
      if (error instanceof NfStatsUploadError) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  failUpload(`nf-stats upload failed: ${lastError}`, options.token, log);
}

export type PublishDeps = {
  now?: Date;
  version?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export async function publishRelayStats(env: StatsEnv, deps: PublishDeps = {}): Promise<void> {
  const token = env.NF_STATS_TOKEN ?? "";
  const log = (message: string) => {
    const write = deps.log ?? ((line: string) => console.log(line));
    write(redactSecret(message, token));
  };

  try {
    if (!env.NF_STATS_URL || !env.NF_STATS_TOKEN) {
      log("nf-stats upload skipped: NF_STATS_URL or NF_STATS_TOKEN is missing");
      return;
    }
    const version = (deps.version ?? RELAY_PACKAGE_VERSION).trim();
    if (!version) {
      log("nf-stats upload skipped: package version is missing");
      return;
    }
    const now = deps.now ?? new Date();
    const counts = await queryPaymentCounts(env.RELAY14, now);
    const document = buildNfStatsDocument({
      version,
      network: env.NETWORK,
      counts,
      now,
    });
    await putNfStats({
      url: env.NF_STATS_URL,
      token: env.NF_STATS_TOKEN,
      document,
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
      log,
    });
  } catch (error) {
    if (error instanceof NfStatsUploadError) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    log(redactSecret(message, token));
  }
}

function countStat(
  id: string,
  label: string,
  value: number,
  period: StatPeriod,
  asOf: string,
  source: string,
): NfStat {
  return {
    id,
    label,
    value,
    unit: "count",
    period,
    as_of: asOf,
    source,
  };
}

function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`missing count: ${name}`);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function failUpload(message: string, token: string, log: (message: string) => void): never {
  const redacted = redactSecret(message, token);
  log(redacted);
  throw new NfStatsUploadError(redacted);
}
