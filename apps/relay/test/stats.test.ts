import { describe, expect, test } from "vitest";
import { type RelayDatabase } from "../src/store.js";
import {
  NfStatsUploadError,
  buildNfStatsDocument,
  paymentCountsCommand,
  paymentCountsFromRow,
  paymentCountsFromWranglerStdout,
  publishRelayStats,
  putNfStats,
  queryPaymentCounts,
  type NfStatsDocument,
  type PaymentCounts,
  type StatsEnv,
} from "../src/stats.js";

const TOKEN = "nf-stats-token-do-not-leak";
const NOW = new Date("2026-10-04T10:15:00.000Z");
const COUNTS: PaymentCounts = {
  settledAllTime: 4,
  settled30d: 2,
  uniquePayers: 3,
  failedAllTime: 1,
};

function document(overrides: Partial<Parameters<typeof buildNfStatsDocument>[0]> = {}): NfStatsDocument {
  return buildNfStatsDocument({
    version: "0.0.0",
    network: "litvm-testnet",
    counts: COUNTS,
    now: NOW,
    ...overrides,
  });
}

function fakeDb(row: Record<string, unknown> | null, options?: { throwMessage?: string }): RelayDatabase {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              if (options?.throwMessage) {
                throw new Error(options.throwMessage);
              }
              return row;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return {};
            },
          };
        },
      };
    },
  };
}

function env(overrides: Partial<StatsEnv> = {}): StatsEnv {
  return {
    RELAY14: fakeDb({
      settled_all_time: 4,
      settled_30d: 2,
      unique_payers: 3,
      failed_all_time: 1,
    }),
    NETWORK: "litvm-testnet",
    NF_STATS_URL: "https://nf-stats-upload.example/upload/relay-14",
    NF_STATS_TOKEN: TOKEN,
    ...overrides,
  };
}

describe("nf-stats document", () => {
  test("uses the v1 schema and numeric counts from the same network list", () => {
    const stats = document();
    expect(stats.schema).toBe("nf-stats/v1");
    expect(Object.hasOwn(stats, "released_at")).toBe(false);
    expect(stats.stats.map((stat) => stat.id)).toEqual([
      "settled_payments",
      "settled_30d",
      "unique_payers",
      "failed_payments",
      "networks_supported",
    ]);
    const networksSupported = stats.stats.find((stat) => stat.id === "networks_supported");
    expect(networksSupported?.value).toBe(stats.networks.length);
    for (const stat of stats.stats) {
      expect(typeof stat.value).toBe("number");
    }
    expect(JSON.stringify(stats)).not.toContain(TOKEN);
  });

  test("omits a release date and any count that was not measured", () => {
    expect(() => document({ version: "  " })).toThrow(/package version is missing/);
    expect(() => document({ network: "" })).toThrow(/NETWORK is missing/);
    expect(() =>
      document({
        counts: { ...COUNTS, settledAllTime: Number.NaN },
      }),
    ).toThrow(/missing count: settled_all_time/);
  });

  test("reads counts from a query row and refuses a missing count", () => {
    expect(
      paymentCountsFromRow({
        settled_all_time: 2,
        settled_30d: "1",
        unique_payers: 1,
        failed_all_time: 0,
      }),
    ).toEqual({
      settledAllTime: 2,
      settled30d: 1,
      uniquePayers: 1,
      failedAllTime: 0,
    });
    expect(() => paymentCountsFromRow(null)).toThrow(/no row/);
    expect(() =>
      paymentCountsFromRow({
        settled_all_time: 1,
        settled_30d: null,
        unique_payers: 1,
        failed_all_time: 0,
      }),
    ).toThrow(/missing count: settled_30d/);
  });

  test("parses wrangler JSON and does not invent a row", () => {
    const stdout = `wrangler notice\n${JSON.stringify([
      {
        success: true,
        results: [
          {
            settled_all_time: 8,
            settled_30d: 3,
            unique_payers: 5,
            failed_all_time: 2,
          },
        ],
      },
    ])}`;
    expect(paymentCountsFromWranglerStdout(stdout).settledAllTime).toBe(8);
    expect(() => paymentCountsFromWranglerStdout('[{"success":true,"results":[]}]')).toThrow(/no row/);
    expect(paymentCountsCommand("2026-09-04T10:15:00.000Z")).toContain("settled_at >= '2026-09-04T10:15:00.000Z'");
    expect(() => paymentCountsCommand("yesterday")).toThrow(/invalid settled-since timestamp/);
  });

  test("binds the 30 day cutoff and returns the D1 row", async () => {
    let bound: unknown[] = [];
    const db: RelayDatabase = {
      prepare(sql) {
        expect(sql).toContain("status = 'settled'");
        return {
          bind(...values) {
            bound = values;
            return {
              async first() {
                return {
                  settled_all_time: 2,
                  settled_30d: 1,
                  unique_payers: 1,
                  failed_all_time: 0,
                };
              },
              async all() {
                return { results: [] };
              },
              async run() {
                return {};
              },
            };
          },
        };
      },
    };
    const counts = await queryPaymentCounts(db, NOW);
    expect(bound).toEqual(["2026-09-04T10:15:00.000Z"]);
    expect(counts).toEqual({
      settledAllTime: 2,
      settled30d: 1,
      uniquePayers: 1,
      failedAllTime: 0,
    });
  });
});

describe("putNfStats", () => {
  test("uploads once when the store returns 200 ok", async () => {
    const calls: RequestInit[] = [];
    await putNfStats({
      url: "https://nf-stats-upload.example/upload/relay-14",
      token: TOKEN,
      document: document(),
      sleep: async () => {
        throw new Error("should not retry");
      },
      fetchImpl: async (_url, init) => {
        calls.push(init ?? {});
        return new Response("ok\n", { status: 200 });
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(String(calls[0]?.body)).not.toContain(TOKEN);
    const headers = new Headers(calls[0]?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("retries a 500 and then accepts 200", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    await putNfStats({
      url: "https://nf-stats-upload.example/upload/relay-14",
      token: TOKEN,
      document: document(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("unavailable", { status: 500 });
        }
        return new Response("ok", { status: 200 });
      },
    });
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  test("does not retry a 400", async () => {
    const logs: string[] = [];
    let attempts = 0;
    await expect(
      putNfStats({
        url: "https://nf-stats-upload.example/upload/relay-14",
        token: TOKEN,
        document: document(),
        log: (message) => logs.push(message),
        sleep: async () => {
          throw new Error("should not retry");
        },
        fetchImpl: async () => {
          attempts += 1;
          return new Response(`bad ${TOKEN}`, { status: 400 });
        },
      }),
    ).rejects.toBeInstanceOf(NfStatsUploadError);
    expect(attempts).toBe(1);
    expect(logs).toEqual(["nf-stats upload failed: 400 bad [redacted]"]);
    expect(logs.join("")).not.toContain(TOKEN);
  });

  test("retries a network error and then stops", async () => {
    const sleeps: number[] = [];
    const logs: string[] = [];
    let attempts = 0;
    await expect(
      putNfStats({
        url: "https://nf-stats-upload.example/upload/relay-14",
        token: TOKEN,
        document: document(),
        log: (message) => logs.push(message),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        fetchImpl: async () => {
          attempts += 1;
          throw new Error(`network down ${TOKEN}`);
        },
      }),
    ).rejects.toBeInstanceOf(NfStatsUploadError);
    expect(attempts).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(logs).toEqual(["nf-stats upload failed: network down [redacted]"]);
  });
});

describe("publishRelayStats", () => {
  test("does not upload when a count query fails", async () => {
    let calls = 0;
    const logs: string[] = [];
    await publishRelayStats(
      env({
        RELAY14: fakeDb(null, { throwMessage: `d1 down ${TOKEN}` }),
      }),
      {
        now: NOW,
        version: "0.0.0",
        log: (message) => logs.push(message),
        fetchImpl: async () => {
          calls += 1;
          return new Response("ok", { status: 200 });
        },
      },
    );
    expect(calls).toBe(0);
    expect(logs).toEqual(["d1 down [redacted]"]);
  });

  test("skips the upload when the token is missing", async () => {
    let calls = 0;
    const logs: string[] = [];
    await publishRelayStats(env({ NF_STATS_TOKEN: undefined }), {
      log: (message) => logs.push(message),
      fetchImpl: async () => {
        calls += 1;
        return new Response("ok", { status: 200 });
      },
    });
    expect(calls).toBe(0);
    expect(logs[0]).toMatch(/missing/);
  });
});
