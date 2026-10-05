# exact-native

Relay-14 is an x402 facilitator for native zkLTC on the LitVM LiteForge testnet. The payer signs an EIP-1559 transfer and pays their own gas. The facilitator checks that transaction, broadcasts it, and waits for the receipt. It never holds funds and has no private key.

This scheme is `exact-native`. It is not the ERC-3009 `exact` scheme. There is no `transferWithAuthorization`. The payment is a native transfer.

Do not depend on `@relay-14/*`. Those packages are private and exist for this repository. Implement the HTTP calls in your own stack.

The resource server calls the facilitator. A settlement reported by the client is not proof of payment.

## Constants

| Name | Value |
| --- | --- |
| Facilitator | `https://relay-14-facilitator.compx.io` |
| Scheme | `exact-native` |
| Network | `litvm-testnet` |
| Chain id | `4441` |
| Asset | `0x0000000000000000000000000000000000000000` (native zkLTC, 18 decimals) |
| x402 version | `1` |
| Payment header | `X-PAYMENT` |
| Response header | `X-PAYMENT-RESPONSE` |
| Receipt wait | 30 seconds |
| Faucet | `https://liteforge.hub.caldera.xyz` |
| RPC | `https://liteforge.rpc.caldera.xyz/http` |
| Explorer | `https://liteforge.explorer.caldera.xyz` |

`GET /supported` publishes the scheme, network, and receipt wait. A payment requirement must not set `maxTimeoutSeconds` above 30.

## Payment header

`X-PAYMENT` is standard base64 (with `+`, `/`, and `=` padding) of the UTF-8 JSON payment payload. It is not base64url. `X-PAYMENT-RESPONSE` is the same encoding of the settle response.

```json
{
  "x402Version": 1,
  "scheme": "exact-native",
  "network": "litvm-testnet",
  "payload": {
    "signedTx": "0x02…"
  }
}
```

`signedTx` is the full signed EIP-1559 transaction, hex-prefixed. It is not a transaction hash. The examples below abbreviate it. Do not broadcast this transaction yourself.

## What the facilitator checks

`POST /verify` and `POST /settle` take the same JSON body:

```json
{
  "paymentPayload": {},
  "paymentRequirements": {}
}
```

`paymentPayload` is the object encoded in `X-PAYMENT`. `paymentRequirements` is the `accepts` entry the resource server advertised for this request.

Both routes re-check the signed transaction. `/settle` runs verify again, so a resource server may call `/settle` alone.

The facilitator checks:

- `x402Version` is `1` (`invalid_x402_version`).
- `scheme` is `exact-native` on the payload and the requirements (`invalid_scheme`).
- `network` is `litvm-testnet` on the payload and the requirements (`invalid_network`).
- `payload.signedTx` is hex, parses, and is an EIP-1559 transaction with `gas` and `maxFeePerGas` (`invalid_payload`).
- The signed chain id is `4441` (`invalid_network`).
- `payTo` is an address and `tx.to` is that address (`invalid_payload` if `payTo` is not an address, `invalid_recipient` if `tx.to` differs).
- `maxAmountRequired` is a decimal wei string. `tx.value` must equal it. A smaller value is `insufficient_value`. A larger value is `overpayment` and is not broadcast.
- Calldata is empty (`undefined` or `0x`). Anything else is `invalid_payload`.
- The signature recovers (`invalid_payload` when it does not).
- `tx.nonce` equals the payer's pending transaction count (`invalid_nonce`).
- The payer's balance at the latest block covers `value + gas * maxFeePerGas` (`insufficient_funds`). A pending spend can pass verify and still fail when the transaction is broadcast.
- `resource` is a non-empty string.
- `maxTimeoutSeconds` is an integer of at least 1 (`invalid_payload`). A value above 30 is `invalid_timeout`.

The facilitator does not check `asset`, `description`, `mimeType`, `outputSchema`, or `extra`. The resource server should still set `asset` to the native placeholder above. Those other fields tell the payer what they are buying.

The signed transaction commits to chain id, recipient, value, empty calldata, nonce, and gas. It does not commit to `resource`. The first successful verify stores `resource`, `payTo`, and `amountWei` for that transaction hash. A later verify or settle that names a different resource, recipient, or amount is `requirements_mismatch`. Post the same requirements you advertised in the 402.

One settle broadcasts. Another settle for the same requirements waits and returns the stored result. If that wait expires, the facilitator returns `settlement_in_progress` and does not broadcast a second time. A receipt that does not arrive within 30 seconds returns `confirmation_timed_out` and leaves the payment in flight. Retry with the same signed transaction. Do not ask the payer to sign a new one while the first can still land.

An already settled payment fails verify with `replay_detected`. `/settle` of that same payload and the same bound requirements returns the stored success.

`/verify` and `/settle` answer HTTP 200 for both valid and invalid payments. Read `isValid` or `success` in the body. A body that is not JSON, or that omits `paymentPayload` or `paymentRequirements`, is HTTP 400.

Call `/verify` and `/settle` from the resource server. They are not a browser API.

## Facilitator routes

Base URL: `https://relay-14-facilitator.compx.io`

| Route | Role |
| --- | --- |
| `GET /supported` | The scheme this facilitator accepts, including `maxTimeoutSeconds` |
| `POST /verify` | Check a signed transfer. Does not broadcast it |
| `POST /settle` | Verify again, broadcast, and wait up to 30 seconds for the receipt |
| `GET /health` | LiteForge RPC and database check |
| `GET /transactions` | Up to 50 settled payments, newest first |

### Error reasons

Verify reasons also appear as `errorReason` on a failed settle.

| Reason | Meaning |
| --- | --- |
| `invalid_payload` | The body, the signed transaction, `payTo`, the amount, `resource`, the timeout, the transaction type, the calldata, or the signature is unusable |
| `invalid_x402_version` | `x402Version` is not 1 |
| `invalid_scheme` | `scheme` is not `exact-native` |
| `invalid_network` | `network` is not `litvm-testnet`, or the signed chain id is not 4441 |
| `invalid_timeout` | `maxTimeoutSeconds` is greater than 30 |
| `invalid_recipient` | `tx.to` is not `payTo` |
| `insufficient_value` | `tx.value` is below `maxAmountRequired` |
| `overpayment` | `tx.value` is above `maxAmountRequired` |
| `invalid_nonce` | `tx.nonce` is not the payer's pending nonce |
| `insufficient_funds` | Latest-block balance does not cover the value plus the gas ceiling |
| `requirements_mismatch` | This hash is already bound to a different resource, recipient, or amount |
| `replay_detected` | Verify of a payment that is already settled for these requirements |
| `unexpected_verify_error` | A chain read failed during verify |
| `confirmation_timed_out` | The transfer was broadcast and the receipt did not arrive within 30 seconds |
| `settlement_in_progress` | A settle for this hash is already in flight |
| `transaction_failed` | The receipt reverted |
| `unexpected_settle_error` | Broadcast failed, or settle threw |

`confirmation_timed_out` and `settlement_in_progress` mean the same signed transaction may still land. The resource server answers the payer with HTTP 503 and does not issue a fresh 402. Other failures are HTTP 402 with the facilitator reason, so the payer can sign again when the previous transaction cannot land.

## Build an endpoint

The resource server has no key. It must not broadcast the signed transaction.

1. Choose `payTo` (an address you control), a price in zkLTC wei, and the resource URL of this request. Fund a payer from `https://liteforge.hub.caldera.xyz` when you test. `payTo` does not need a key on the server.
2. On a request with no `X-PAYMENT`, or with a header that is not the base64 JSON payload, return HTTP 402:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact-native",
      "network": "litvm-testnet",
      "maxAmountRequired": "100000000000000",
      "resource": "https://example.com/fortune",
      "description": "A fortune",
      "mimeType": "application/json",
      "payTo": "0x1111111111111111111111111111111111111111",
      "maxTimeoutSeconds": 30,
      "asset": "0x0000000000000000000000000000000000000000"
    }
  ]
}
```

`100000000000000` wei is 0.0001 zkLTC. `maxTimeoutSeconds` must be from 1 to 30. `resource` must be the same URL you later send to the facilitator. `payTo` in this example is a placeholder. Use an address you control.

3. Decode `X-PAYMENT` to `paymentPayload`.
4. `POST` this body to `https://relay-14-facilitator.compx.io/settle` (or `/verify`, then `/settle`):

```json
{
  "paymentPayload": {
    "x402Version": 1,
    "scheme": "exact-native",
    "network": "litvm-testnet",
    "payload": {
      "signedTx": "0x02…"
    }
  },
  "paymentRequirements": {
    "scheme": "exact-native",
    "network": "litvm-testnet",
    "maxAmountRequired": "100000000000000",
    "resource": "https://example.com/fortune",
    "description": "A fortune",
    "mimeType": "application/json",
    "payTo": "0x1111111111111111111111111111111111111111",
    "maxTimeoutSeconds": 30,
    "asset": "0x0000000000000000000000000000000000000000"
  }
}
```

5. If `success` is true, serve the resource and set `X-PAYMENT-RESPONSE` to the base64 JSON of the settle response.
6. If `errorReason` is `confirmation_timed_out` or `settlement_in_progress`, return HTTP 503 and the facilitator body. Do not return a new 402 for that same signed transaction.
7. Any other failure returns HTTP 402 again. Include the facilitator reason as `error` next to the same `accepts` entry.

Facilitator URL: `https://relay-14-facilitator.compx.io`.

## Pay an endpoint

1. Request the resource. A 402 body lists `accepts`.
2. Select the entry with `scheme` `exact-native` and `network` `litvm-testnet`.
3. Sign an EIP-1559 transaction. Do not broadcast it.
   - `chainId`: `4441`
   - `to`: `payTo`
   - `value`: `maxAmountRequired` exactly, as wei
   - `data`: `0x`
   - `nonce`: the payer's pending transaction count
   - `gas` and `maxFeePerGas`: set both. The payer pays this gas on top of the price
   - The payer's latest-block balance must cover `value + gas * maxFeePerGas`
4. Base64-encode the payment payload JSON and retry the same request once with header `X-PAYMENT`.
5. Read the resource from a 200 response. `X-PAYMENT-RESPONSE` is the facilitator's settle result, as observed by the resource server.

Fund the payer from `https://liteforge.hub.caldera.xyz`.

## Examples

`signedTx` is abbreviated. A real value is the full signed transaction.

### 402

```json
{
  "x402Version": 1,
  "error": "overpayment",
  "accepts": [
    {
      "scheme": "exact-native",
      "network": "litvm-testnet",
      "maxAmountRequired": "100000000000000",
      "resource": "https://example.com/fortune",
      "description": "A fortune",
      "mimeType": "application/json",
      "payTo": "0x1111111111111111111111111111111111111111",
      "maxTimeoutSeconds": 30,
      "asset": "0x0000000000000000000000000000000000000000"
    }
  ]
}
```

Omit `error` on the first 402, before any payment has been attempted.

### GET /supported

`https://relay-14-facilitator.compx.io/supported`

```json
[
  {
    "x402Version": 1,
    "scheme": "exact-native",
    "network": "litvm-testnet",
    "maxTimeoutSeconds": 30
  }
]
```

### POST /verify

`https://relay-14-facilitator.compx.io/verify`

Valid:

```json
{
  "isValid": true,
  "payer": "0x2222222222222222222222222222222222222222"
}
```

Invalid. `overpayment` is returned before the payer is recovered, so this body has no `payer`:

```json
{
  "isValid": false,
  "invalidReason": "overpayment"
}
```

HTTP 200 in both cases.

### POST /settle

`https://relay-14-facilitator.compx.io/settle`

Success:

```json
{
  "success": true,
  "transaction": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "network": "litvm-testnet",
  "payer": "0x2222222222222222222222222222222222222222"
}
```

Replay of that same payload and the same bound requirements returns the stored success. The body has the same shape. `transaction` is the hash already settled.

Timeout. The transfer was broadcast. The resource server returns HTTP 503 to the payer and does not issue a new 402:

```json
{
  "success": false,
  "transaction": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "network": "litvm-testnet",
  "payer": "0x2222222222222222222222222222222222222222",
  "errorReason": "confirmation_timed_out"
}
```

The facilitator itself returns HTTP 200 for this body. `settlement_in_progress` uses the same shape.
