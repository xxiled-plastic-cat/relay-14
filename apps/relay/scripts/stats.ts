import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NfStatsUploadError,
  RELAY_PACKAGE_VERSION,
  buildNfStatsDocument,
  paymentCountsCommand,
  paymentCountsFromWranglerStdout,
  putNfStats,
  redactSecret,
  settledSince,
} from "../src/stats.js";

const relayDir = fileURLToPath(new URL("..", import.meta.url));
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const publish = process.argv.includes("--publish");
const dry = process.argv.includes("--dry");
const remote = process.argv.includes("--remote");

if (publish === dry) {
  fail("Pass --dry or --publish");
}

const version = RELAY_PACKAGE_VERSION.trim();
if (!version) {
  fail("package version is missing");
}

const vars = readWranglerVars();
const network = process.env.NETWORK?.trim() || vars.NETWORK?.trim() || "";
if (!network) {
  fail("NETWORK is missing");
}

const uploadUrl = process.env.NF_STATS_URL?.trim() || vars.NF_STATS_URL?.trim() || "";
const uploadToken = process.env.NF_STATS_TOKEN?.trim() ?? "";
if (publish && (!uploadUrl || !uploadToken)) {
  fail("NF_STATS_URL or NF_STATS_TOKEN is missing");
}

const now = new Date();
const counts = loadCounts();
const document = buildNfStatsDocument({ version, network, counts, now });

if (dry) {
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
} else {
  try {
    await putNfStats({
      url: uploadUrl,
      token: uploadToken,
      document,
      log: (message) => console.error(redactSecret(message, uploadToken)),
    });
  } catch (error) {
    if (!(error instanceof NfStatsUploadError)) {
      fail(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
  console.error("nf-stats upload ok");
}

function loadCounts() {
  try {
    return queryPaymentCounts(remote, paymentCountsCommand(settledSince(now)));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function queryPaymentCounts(useRemote: boolean, sql: string) {
  const args = ["d1", "execute", "relay-14", useRemote ? "--remote" : "--local", "--json", "--command", sql];
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, [wranglerBin, ...args], {
      cwd: relayDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const detail = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
    throw new Error(detail || err.message || "D1 execute failed");
  }
  return paymentCountsFromWranglerStdout(stdout);
}

function readWranglerVars(): { NETWORK?: string; NF_STATS_URL?: string } {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const json = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as {
    vars?: { NETWORK?: string; NF_STATS_URL?: string };
  };
  return json.vars ?? {};
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) {
    return;
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function fail(message: string): never {
  console.error(redactSecret(message, process.env.NF_STATS_TOKEN ?? ""));
  process.exit(1);
}
