# Relay-14

Relay-14 is an x402 facilitator for native zkLTC on the LitVM LiteForge testnet. It runs as a Cloudflare Worker. The payer signs an EIP-1559 transfer and pays their own gas. Relay-14 checks that transaction, broadcasts it, and waits for the receipt. It never holds funds and has no private key.

The payment scheme is `exact-native` on network `litvm-testnet` (chain id 4441). The asset is zkLTC, the chain's native gas token, with 18 decimals.

## Layout

| Path | Name | Role |
| --- | --- | --- |
| `apps/relay` | Worker `relay-14`, package `@relay-14/relay` | Facilitator: `/supported`, `/verify`, `/settle`, `/health`, `/transactions` |
| `apps/demo` | Worker `relay-14-demo`, package `@relay-14/demo` | Paid `GET /fortune` for 0.0001 zkLTC |
| `apps/web` | `@relay-14/web` | Landing page, `/docs`, and `/txns` |
| `packages/shared` | `@relay-14/shared` | Chain config, payment types, header codec |
| `packages/client` | `@relay-14/client` | Signs a transfer and retries once after a 402 |
| `packages/middleware` | `@relay-14/middleware` | Hono middleware that returns 402 and calls Relay-14 |

D1 database name: `relay-14`. Binding in code: `env.RELAY14`.

## Local development

Install dependencies from the repo root:

```bash
pnpm install
```

Apply the D1 migration to the local database and start the facilitator:

```bash
pnpm --filter @relay-14/relay db:migrate:local
pnpm --filter @relay-14/relay dev
```

`wrangler dev` serves Relay-14 at `http://127.0.0.1:8787`. In another terminal, start the demo:

```bash
pnpm --filter @relay-14/demo dev
```

The demo listens on `http://127.0.0.1:8788`. `GET /fortune` returns 402 until the request carries an `X-PAYMENT` header. `GET /health` on each Worker does not require payment. The facilitator health check calls the LiteForge RPC and `SELECT 1` on D1.

The landing page is a separate Vite app:

```bash
pnpm --filter @relay-14/web dev
```

It serves at `http://127.0.0.1:5173`. `/docs` is a short description of the facilitator. `/txns` lists settled payments from the facilitator database, so the facilitator has to be running. Each row opens the LiteForge testnet explorer.

Run the verify tests:

```bash
pnpm test
```

## Demo payment

1. Create a testnet wallet and fund it from the faucet at <https://liteforge.hub.caldera.xyz>.
2. Set `PAY_TO` in [`apps/demo/.env.local`](apps/demo/.env.local) to an address you control, then restart the demo Worker. That address receives the zkLTC. It does not need a key on the server.
3. Set `PRIVATE_KEY` in `apps/demo/.env.local` to the funded wallet. `.env.local` is gitignored. Wrangler also reads [`apps/relay/.env.local`](apps/relay/.env.local) for `CHAIN_ID`, `RPC_URL`, and `NETWORK`.
4. With both Workers running:

```bash
pnpm --filter @relay-14/demo pay
```

The script requests `/fortune`, receives 402, signs a native transfer without broadcasting it, and retries once with the `X-PAYMENT` header. On success it prints the fortune, the transaction hash, and a LiteForge explorer link. The `payments` row in D1 moves from `verified` to `settled`.

`/settle` waits up to 30 seconds for the receipt inside the request. Workers can do that. A later version can return as soon as the transaction is broadcast and confirm it with a cron or a queue.

## Deploy

Log in with `wrangler login`, then create the database from `apps/relay`:

```bash
pnpm --filter @relay-14/relay exec wrangler d1 create relay-14
```

Paste the printed `database_id` into [`apps/relay/wrangler.jsonc`](apps/relay/wrangler.jsonc), replacing the local placeholder. Apply migrations and deploy:

```bash
pnpm --filter @relay-14/relay db:migrate:remote
pnpm --filter @relay-14/relay deploy
```

Deploy publishes the Worker, then uploads public stats. A cron at `15 * * * *` uploads again each hour. From `apps/relay`, set the Worker secret the cron reads:

```bash
pnpm exec wrangler secret put NF_STATS_TOKEN
```

The post-deploy upload runs on your machine. Copy [`apps/relay/.env.example`](apps/relay/.env.example) to `apps/relay/.env` and set `NF_STATS_URL` and `NF_STATS_TOKEN`. Do not commit `.env`. `pnpm stats:dry` prints the JSON and does not upload.

Point the demo at the deployed facilitator by setting `FACILITATOR_URL` in [`apps/demo/wrangler.jsonc`](apps/demo/wrangler.jsonc) to the `relay-14` Worker URL, set `PAY_TO`, and deploy:

```bash
pnpm --filter @relay-14/demo deploy
```

Chain settings live in the facilitator `vars` block of `wrangler.jsonc`: `CHAIN_ID`, `RPC_URL`, and `NETWORK`. Pointing those at another network later is a config change. The Worker still has no key. Deploy publishes the facilitator to `relay-14-facilitator.compx.io` and to `workers.dev`.

## Out of scope for v1

Permit2, wrapped zkLTC, USD pricing, a discovery listing, fee charging, and mainnet.
