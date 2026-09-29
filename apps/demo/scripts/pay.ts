import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithPayment } from "@relay-14/client";
import { PAYMENT_RESPONSE_HEADER, decodeJsonHeader, explorerTxUrl, type SettleResponse } from "@relay-14/shared";
import { privateKeyToAccount } from "viem/accounts";

loadDevVars();

const privateKey = process.env.PRIVATE_KEY;
const demoUrl = (process.env.DEMO_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");

if (!privateKey || !privateKey.startsWith("0x")) {
  console.error("Set PRIVATE_KEY to a LiteForge testnet key funded at https://liteforge.hub.caldera.xyz");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);
const response = await fetchWithPayment(`${demoUrl}/fortune`, account);
const body = await response.json();

if (!response.ok) {
  console.error(`Payment failed (${response.status})`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

const encoded = response.headers.get(PAYMENT_RESPONSE_HEADER);
const settled = encoded ? decodeJsonHeader<SettleResponse>(encoded) : undefined;

console.log(JSON.stringify(body, null, 2));
if (settled?.transaction) {
  console.log(settled.transaction);
  console.log(explorerTxUrl(settled.transaction));
}

function loadDevVars(): void {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "../.dev.vars");
  if (!existsSync(path)) {
    return;
  }
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
