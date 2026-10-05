# Pay a Relay-14 exact-native endpoint

Implement this in the project's own stack. Do not depend on `@relay-14/*`. Those packages are private. Sign the transfer and do not broadcast it. The resource server's facilitator broadcasts it.

The long spec is `docs/exact-native.md` in the Relay-14 repo, and `https://relay-14.compx.io/exact-native.md` on the site.

## Constants

- Scheme: `exact-native`
- Network: `litvm-testnet`
- Chain id: `4441`
- Asset: native zkLTC, 18 decimals (`0x0000000000000000000000000000000000000000`)
- Header: `X-PAYMENT` (standard base64 of UTF-8 JSON, not base64url)
- RPC: `https://liteforge.rpc.caldera.xyz/http`
- Faucet: `https://liteforge.hub.caldera.xyz`

Fund the payer from the faucet before paying.

## Behavior

1. Request the resource. If the status is not 402, you are done.
2. From the JSON body, select the `accepts` entry whose `scheme` is `exact-native` and whose `network` is `litvm-testnet`.
3. Sign an EIP-1559 transaction. Do not send it to the network.
   - `chainId`: `4441`
   - `to`: the entry's `payTo`
   - `value`: the entry's `maxAmountRequired` exactly, as wei. A short payment is rejected. A larger payment is rejected and is not broadcast
   - `data`: `0x`
   - `nonce`: the payer's pending transaction count
   - `gas` and `maxFeePerGas`: both set. The payer pays this gas on top of `value`
4. Build this JSON and send it as standard base64 in the `X-PAYMENT` header. Retry the same request once:

```json
{
  "x402Version": 1,
  "scheme": "exact-native",
  "network": "litvm-testnet",
  "payload": { "signedTx": "<the signed transaction>" }
}
```

5. HTTP 200 is the paid resource. `X-PAYMENT-RESPONSE` is the resource server's copy of the settle result. It is not something you submit as proof.
6. HTTP 503 with `confirmation_timed_out` or `settlement_in_progress` means the transfer was already broadcast or is in flight. Retry later with the same signed transaction. Do not sign a second transfer for the same payment while the first can still land.
7. HTTP 402 with an `error` means this attempt was rejected. Read `error` before signing again.
