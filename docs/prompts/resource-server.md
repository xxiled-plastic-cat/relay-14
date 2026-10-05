# Add a paid endpoint that settles through Relay-14

Implement this in the project's own stack. Do not depend on `@relay-14/*`. Those packages are private. Do not broadcast the signed transaction. This server has no key.

The long spec is `docs/exact-native.md` in the Relay-14 repo, and `https://relay-14.compx.io/exact-native.md` on the site.

## Constants

- Facilitator: `https://relay-14-facilitator.compx.io`
- Scheme: `exact-native`
- Network: `litvm-testnet`
- Chain id: `4441`
- Asset: `0x0000000000000000000000000000000000000000` (native zkLTC, 18 decimals)
- x402 version: `1`
- Headers: `X-PAYMENT` and `X-PAYMENT-RESPONSE` (standard base64 of UTF-8 JSON, not base64url)
- Receipt wait: 30 seconds. `maxTimeoutSeconds` must be from 1 to 30
- Faucet for test payers: `https://liteforge.hub.caldera.xyz`

Set `PAY_TO` to an address this project controls. Set the price in zkLTC wei (`maxAmountRequired`). `PAY_TO` receives the zkLTC. It does not need a private key on the server.

## Behavior

1. On a request with no `X-PAYMENT`, or with a header that is not base64 JSON, return HTTP 402:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact-native",
      "network": "litvm-testnet",
      "maxAmountRequired": "<price in wei>",
      "resource": "<the exact URL of this request>",
      "description": "<what the payer is buying>",
      "mimeType": "application/json",
      "payTo": "<PAY_TO>",
      "maxTimeoutSeconds": 30,
      "asset": "0x0000000000000000000000000000000000000000"
    }
  ]
}
```

2. Decode `X-PAYMENT` into `paymentPayload`. It looks like:

```json
{
  "x402Version": 1,
  "scheme": "exact-native",
  "network": "litvm-testnet",
  "payload": { "signedTx": "0x02…" }
}
```

`signedTx` is the full signed EIP-1559 transaction. Leave it unbroadcast.

3. `POST` `{ "paymentPayload", "paymentRequirements" }` to `https://relay-14-facilitator.compx.io/settle`. `paymentRequirements` is the same `accepts` entry you advertised. `/settle` verifies again, so you may skip `/verify`. The facilitator responds HTTP 200 for both success and failure. Read `success` in the body. HTTP 400 means the JSON body was unusable.

4. When `success` is true, serve the resource and set `X-PAYMENT-RESPONSE` to the base64 JSON of the settle response.

5. When `errorReason` is `confirmation_timed_out` or `settlement_in_progress`, return HTTP 503 and that body. Do not return a new 402. The same signed transaction may still land.

6. Any other failure returns HTTP 402 again, with the facilitator reason in `error`, and the same `accepts` entry.

A client-reported settlement is not proof of payment. Trust the facilitator's settle response.

Call the facilitator from this server, not from the browser.
