# Relay-14 development checklist

Internal backlog. This file is not a public page. P1 is the public guide to building and paying an endpoint against this facilitator. The packages are not published. Mainnet, fees, and discovery stay in [Later](#later) and are not mixed into the ranking.

Work top to bottom. P0 and P1 are done. Start at P2.

## Review

Relay-14 is a keyless x402 facilitator for native zkLTC on LitVM LiteForge testnet (chain id 4441). The payer signs an EIP-1559 transfer and pays their own gas. The Worker in `[apps/relay](apps/relay)` checks that transaction, broadcasts it, and waits for the receipt. It never holds funds and has no private key. The scheme is `exact-native`, not the ERC-3009 `exact` scheme used by other x402 facilitators.

Integrators call the Worker over HTTP. A resource server returns 402, then `POST /verify` and `POST /settle` on `https://relay-14-facilitator.compx.io`. A payer signs an unbroadcast EIP-1559 native transfer and retries with `X-PAYMENT`. Nobody outside this repo installs the packages.


| Path                                         | Role                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `[apps/relay](apps/relay)`                   | Facilitator: `/supported`, `/verify`, `/settle`, `/health`, `/transactions`                                                  |
| `[apps/demo](apps/demo)`                     | Our paid route, `GET /fortune` for 0.0001 zkLTC. Illustration of the call sequence, not a library to install                 |
| `[apps/web](apps/web)`                       | Landing page, `/docs`, `/txns`, and `[llms.txt](apps/web/public/llms.txt)`                                                   |
| `[packages/shared](packages/shared)`         | In-repo source of the chain config, payment types, and header codec the public spec will describe. Not published            |
| `[packages/client](packages/client)`         | Internal. Signs a transfer and retries once after a 402 for the demo                                                         |
| `[packages/middleware](packages/middleware)` | Internal. Hono middleware the demo uses to return 402 and call the facilitator                                               |


The payment path is real. `[apps/relay/test](apps/relay/test)` covers the happy verify and settle cases, plus wrong chain, wrong recipient, short value, overpay, calldata, stale nonce, low balance, an already settled retry, a mismatched resource, one broadcaster when two settles overlap, a receipt timeout that leaves the row settling, reverted receipts, and a few settle failures. Those tests stub the chain and the database.

### Protocol

The binding, exact-value, single-broadcaster, and timeout rules are in place. The HTTP contract for a resource server and a payer is `[docs/exact-native.md](docs/exact-native.md)`, with the same facts on `/docs` and in `[llms.txt](apps/web/public/llms.txt)`.

**A signed transfer is bound to the first verified requirements.** The transaction commits to chain id, recipient, value, empty calldata, nonce, and gas. It does not commit to `resource`. The first successful verify persists `resource`, `payTo`, and `amountWei`. A later verify or settle that names a different resource, recipient, or amount is rejected with `requirements_mismatch`, and `[refreshVerified](apps/relay/src/store.ts)` does not rewrite those fields.

**Exact value.** `tx.value` must equal `maxAmountRequired`. A short payment is `insufficient_value`. A larger payment is `overpayment` and is not broadcast, so it cannot clear a cheaper price.

**One broadcaster per hash.** The settle that moves `verified` to `settling` is the only one that broadcasts. Another settle for the same requirements waits and returns that stored result. If the wait expires it returns `settlement_in_progress` and leaves the row in `settling`.

**One receipt wait.** The facilitator waits 30 seconds (`RECEIPT_TIMEOUT_SECONDS`). `GET /supported` publishes that number. Verify rejects a requirement with a larger `maxTimeoutSeconds` as `invalid_timeout`. The internal demo middleware advertises at most 30 seconds. `/docs` and `llms.txt` state the same number. The scheme spec is `[docs/exact-native.md](docs/exact-native.md)`.

Other protocol notes, ranked below rather than as blockers:

- `/verify` and `/settle` are an open relay. Anyone can submit a signed native transfer whose requirements they invent. The facilitator cannot steal funds. It can be used to spend RPC and hold an isolate for the receipt wait, and it will broadcast any payer-signed transfer that matches the caller's requirements.
- Nonce is read at `pending`. Balance is read at the latest block, so a pending spend can pass verify and fail on chain.
- `asset` is not checked against the native placeholder `0x0000…0000`. `resource` length is unbounded. A zero `maxAmountRequired` is accepted.
- The `/settle` catch path in `[apps/relay/src/index.ts](apps/relay/src/index.ts)` returns the raw string `unexpected_settle_error` instead of `SettleErrorReason`.
- The internal demo middleware calls `/verify` and then `/settle`. `/settle` verifies again, so a resource server may call settle alone. That fact is in the scheme spec. Dropping the extra round trip in the demo is a P3 internal change.
- Settlement waits inside the HTTP request. A later version should broadcast and confirm off the request. That is P3, now that the P0 idempotency work is in place.
- The internal client in `[packages/client/src/index.ts](packages/client/src/index.ts)` hardcodes `litvm-testnet` when it picks a requirement. Published docs and `GET /supported` advertise one network. A second network is a Later item: facilitator config plus those published constants, and an internal client follow-up. It is not a published client limitation.
- First-receipt settlement has no reorg depth. Acceptable on this testnet. It is a mainnet item, not a testnet blocker.



### Site and docs

The public site is a CRT landing page ("The Facilitator for x402 on LitVM") with Docs and Txns. Meta tags and `[llms.txt](apps/web/public/llms.txt)` exist. `/docs` covers the scheme, the facilitator API, building an endpoint, and paying, including request and response bodies. `llms.txt` carries the constants and links to those sections, to `[docs/exact-native.md](docs/exact-native.md)`, and to the raw prompts. Each of those says not to depend on `@relay-14/*`.

`[/txns](apps/web/src/pages/TxnsPage.tsx)` lists up to 50 settled payments from `GET /transactions` and links each hash to the LiteForge explorer. The canonical URL in `index.html` is always the homepage. Reduced motion is handled.

`[@relay-14/shared](packages/shared/package.json)`, `[@relay-14/client](packages/client/package.json)`, and `[@relay-14/middleware](packages/middleware/package.json)` stay `private` on purpose. They are not the integration surface. The fortune demo is our illustration of the call sequence, not a library to install. `[apps/demo/wrangler.jsonc](apps/demo/wrangler.jsonc)` commits `PAY_TO` as `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, a public Hardhat account. Do not deploy the demo with that address; those payments would be sweepable. There is no CI workflow.

### Deferred on purpose

Mainnet, a third-party audit before mainnet, facilitator fees, a discovery listing, Permit2, wrapped zkLTC, and USD pricing. The README already marks these out of scope for v1. They live in [Later](#later).

## P0 — Safe to build on

- [x] **Bind each transaction hash to the first verified requirements.** Persist `resource`, `payTo`, and `amountWei` on the first successful verify. Reject a later verify or settle whose requirements do not match that row. `refreshVerified` must not retarget a hash at a different resource or recipient. Return settle success only for the bound requirements.
- [x] **Require an exact value.** `exact-native` means `tx.value === maxAmountRequired`. A short payment is `insufficient_value`. Overpay is `overpayment`. Document the rule in the spec from P1.
- [x] **One broadcaster per hash.** Add a `settling` status (migration plus store methods). The caller that flips `verified` → `settling` is the one that broadcasts. Everyone else waits on that outcome or receives the stored result. A wait that expires returns `settlement_in_progress` and does not broadcast or mark the row failed.
- [x] **Do not invite a second payment after broadcast.** A receipt timeout, or an "already known" response, must not mark the row `failed` in a way that causes the middleware to return a fresh 402 for the same transfer. Settle of the same payload and the same bound requirements is idempotent: if the row is already `settled`, return that success; if it is in flight, do not broadcast a second time. In-flight and timeout responses are HTTP 503 with no new payment requirement.
- [x] **One timeout story.** The facilitator owns the wait. The published receipt timeout is 30 seconds. A requirement that asks for longer is rejected with `invalid_timeout`. The middleware clamps its advertised timeout to that number. The number is on `/docs` and in `llms.txt`. The long scheme spec remains P1.
- [x] **Tests for the new rules.** Mismatched resource, overpay, two concurrent settles, already-broadcast then settle again, and timeout then retry with the same signed transaction are covered. The retry is not told to sign a new transfer while the first one can still land.



## P1 — Build and pay against the HTTP API

Docs live in the repo, on `/docs`, and in `llms.txt`. All three say the same facts. Each artifact says not to depend on `@relay-14/*`.

- [x] **Scheme spec,** `[docs/exact-native.md](docs/exact-native.md)`**.** Envelope (`x402Version`, `scheme`, `network`, `payload.signedTx`), base64 JSON `X-PAYMENT` / `X-PAYMENT-RESPONSE`, which requirement fields `/verify` and `/settle` check, the exact-value rule, the resource binding, error reasons, and the published receipt timeout. State that this is not the ERC-3009 `exact` scheme. Trust model: the resource server calls the facilitator; a client-reported settlement is not proof of payment. `/settle` re-verifies, so a resource server may call settle alone.
- [x] **Resource server guide.** A section of the spec, plus a pasteable prompt at `[docs/prompts/resource-server.md](docs/prompts/resource-server.md)`. Return 402 with `accepts` (`payTo`, price in zkLTC wei, `resource`, native asset, `maxTimeoutSeconds` ≤ 30). Decode `X-PAYMENT`, post `{ paymentPayload, paymentRequirements }` to the facilitator, serve the resource only after settle success, and set `X-PAYMENT-RESPONSE`. In-flight and timeout are HTTP 503 with no fresh 402. The server has no key and must not broadcast. Include `FACILITATOR_URL` (`https://relay-14-facilitator.compx.io`) and the LiteForge faucet (`https://liteforge.hub.caldera.xyz`). The prompt tells an agent to implement those HTTP calls in the project's own stack.
- [x] **Payer guide.** A section of the spec, plus a pasteable prompt at `[docs/prompts/payer.md](docs/prompts/payer.md)`. On 402, select `exact-native` on `litvm-testnet`, sign an EIP-1559 transfer to `payTo` for exactly `maxAmountRequired` (chain id 4441, empty calldata, payer pays gas), do not broadcast, encode the payload, and retry the same request once with `X-PAYMENT`.
- [x] **JSON examples.** Concrete bodies for the 402 `accepts` payload, `GET /supported`, `POST /verify` (valid and invalid), and `POST /settle` (success, replay, timeout). Put them in the spec and on `/docs`.
- [x] **Site docs.** Expand `[DocsPage](apps/web/src/pages/DocsPage.tsx)` into sections for the scheme, the facilitator API, building an endpoint, and paying. Keep the existing page frame. Expand `[llms.txt](apps/web/public/llms.txt)` so an agent that only fetches `https://relay-14.compx.io/llms.txt` gets the constants (scheme, network, chain id, asset, headers, facilitator base URL, timeout) and links to those sections and to the raw prompts.



## P2 — Public testnet hardening

- [ ] **Threat model,** `[docs/threat-model.md](docs/threat-model.md)`**.** Short. The Worker has no key and cannot hold funds. `/verify` and `/settle` are unauthenticated. An attacker can spend RPC, hold isolates for the receipt wait, and cause broadcast of a native transfer the payer already signed. They cannot redirect value to themselves unless the payer signed that recipient. Spell out the resource-binding guarantee from P0.
- [ ] **Input limits.** Cap the signed-transaction body and `resource` length. Reject a zero amount and a value above a published ceiling. Require `asset` to be the native placeholder. Reject a gas limit above a published ceiling. Compare the hash returned by `sendRawTransaction` to `keccak256` of the signed transaction before marking the row settled.
- [ ] **Rate limit** `/verify` **and** `/settle`**.** Cloudflare rate limiting or an equivalent per-caller limit. `/health` and `/transactions` can stay open.
- [ ] **Balance check.** Use a pending-aware balance, or document in the spec that verify reads the latest balance and a pending spend can still fail at broadcast.
- [ ] **CI.** A workflow that runs `pnpm test` and `pnpm typecheck` on pull requests.
- [ ] **More tests.** HTTP handlers for `/verify`, `/settle`, `/supported`, and `/health`. Internal middleware tests for a missing header, a bad header, verify failure, and settle failure. Header codec tests for the base64 JSON round trip.
- [ ] **Logs and the settled index.** Structured logs for verify and settle outcomes (reason, tx hash, network). Do not log signed transactions. Add an index on `(status, settled_at)` for the public list.
- [ ] **Error constants.** The `/settle` catch in `[apps/relay/src/index.ts](apps/relay/src/index.ts)` should use `SettleErrorReason.UnexpectedSettleError`. The internal demo middleware should use the same constant instead of a copied string.



## P3 — After the HTTP guide is published

- [ ] **Confirm off the request.** Return after broadcast and confirm with a cron or a queue, as the README describes. The payer and the resource server need a way to see `settled` versus still in flight without signing a second transfer.
- [ ] **Site polish.** Per-route canonical URLs (today every page canonicals to the homepage). A landing-page path to "build a paid endpoint" that lands on the new docs. Refresh on `/txns`. Leave `/verify` and `/settle` server-to-server; CORS stays on `/transactions` only.
- [ ] **One facilitator call from the demo middleware.** Internal demo change, not a package release. The P1 spec already says `/settle` re-verifies, so a resource server may call settle alone. In the demo, drop the extra `/verify` round trip. A settle failure still returns 402 with the facilitator reason. A success still sets `X-PAYMENT-RESPONSE`.



## Later

Not ranked against the testnet work. Do not pull these forward to unblock people integrating against the HTTP API.

- [ ] **Mainnet.** A third-party audit of verify, settle, and the binding rules before any mainnet deployment. Reorg depth and a confirmation policy belong here, not on LiteForge.
- [ ] **Another network.** `/supported` and the docs advertise one network. A new network is a facilitator config change (`CHAIN_ID`, `RPC_URL`, and `NETWORK`) plus those published constants, including the explorer URL. The hardcoded `litvm-testnet` in `[packages/client/src/index.ts](packages/client/src/index.ts)` is an internal follow-up, not a published client limitation.
- [ ] **Fees, discovery, Permit2, wrapped zkLTC, USD pricing.** Out of scope for v1. Leave them until people are integrating against the exact-native testnet path.
