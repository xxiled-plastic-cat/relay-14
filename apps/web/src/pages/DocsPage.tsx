import { PageFrame } from "../components/PageFrame";

const accepts = `{
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
}`;

const paymentHeader = `{
  "x402Version": 1,
  "scheme": "exact-native",
  "network": "litvm-testnet",
  "payload": {
    "signedTx": "0x02…"
  }
}`;

const supported = `[
  {
    "x402Version": 1,
    "scheme": "exact-native",
    "network": "litvm-testnet",
    "maxTimeoutSeconds": 30
  }
]`;

const verifyRequest = `{
  "paymentPayload": {
    "x402Version": 1,
    "scheme": "exact-native",
    "network": "litvm-testnet",
    "payload": { "signedTx": "0x02…" }
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
}`;

const verifyValid = `{
  "isValid": true,
  "payer": "0x2222222222222222222222222222222222222222"
}`;

const verifyInvalid = `{
  "isValid": false,
  "invalidReason": "overpayment"
}`;

const settleSuccess = `{
  "success": true,
  "transaction": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "network": "litvm-testnet",
  "payer": "0x2222222222222222222222222222222222222222"
}`;

const settleTimeout = `{
  "success": false,
  "transaction": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "network": "litvm-testnet",
  "payer": "0x2222222222222222222222222222222222222222",
  "errorReason": "confirmation_timed_out"
}`;

export function DocsPage() {
  return (
    <PageFrame title="Docs">
      <div className="prose">
        <p>
          Relay-14 is an x402 facilitator for native zkLTC on the LitVM LiteForge testnet. The payer
          signs an EIP-1559 transfer and pays their own gas. Relay-14 checks that transaction,
          broadcasts it, and waits for the receipt. It never holds funds and has no private key.
        </p>
        <p>
          Build the resource server and the payer against this HTTP API. Do not depend on{" "}
          <code>@relay-14/*</code>. Those packages are private. The long spec is{" "}
          <a href="/exact-native.md">exact-native.md</a>. Pasteable prompts:{" "}
          <a href="/prompts/resource-server.md">resource server</a> and{" "}
          <a href="/prompts/payer.md">payer</a>.
        </p>

        <h2 id="scheme">Scheme</h2>
        <p>
          Scheme <code>exact-native</code>. Network <code>litvm-testnet</code>. Chain id{" "}
          <code>4441</code>. Asset <code>0x0000000000000000000000000000000000000000</code>, native
          zkLTC, 18 decimals. x402 version <code>1</code>. This is not the ERC-3009{" "}
          <code>exact</code> scheme. There is no <code>transferWithAuthorization</code>.
        </p>
        <p>
          Headers <code>X-PAYMENT</code> and <code>X-PAYMENT-RESPONSE</code> are standard base64 of
          UTF-8 JSON, with padding. Not base64url. <code>X-PAYMENT</code> is the payment payload.{" "}
          <code>signedTx</code> is the full signed transaction, not a hash. The examples abbreviate
          it.
        </p>
        <pre>
          <code>{paymentHeader}</code>
        </pre>
        <p>
          <code>tx.value</code> must equal <code>maxAmountRequired</code>. A short payment is{" "}
          <code>insufficient_value</code>. A larger payment is <code>overpayment</code> and is not
          broadcast. The facilitator waits 30 seconds for a receipt. A requirement must not ask for
          longer.
        </p>
        <p>
          The signed transaction commits to chain id, recipient, value, empty calldata, nonce, and
          gas. It does not commit to <code>resource</code>. The first successful verify stores{" "}
          <code>resource</code>, <code>payTo</code>, and the amount. A later call that changes any of
          those is <code>requirements_mismatch</code>.
        </p>
        <p>
          The resource server calls the facilitator. A settlement reported by the client is not proof
          of payment. <code>/settle</code> verifies again, so the server may call settle alone.
        </p>

        <h2 id="facilitator">Facilitator API</h2>
        <p>
          Base URL{" "}
          <a href="https://relay-14-facilitator.compx.io">https://relay-14-facilitator.compx.io</a>.
          Call <code>/verify</code> and <code>/settle</code> from the resource server. They are not a
          browser API.
        </p>
        <ul className="route-list">
          <li>
            <code>GET /supported</code> — scheme, network, and the 30 second receipt wait
          </li>
          <li>
            <code>POST /verify</code> — check a signed transfer without broadcasting it
          </li>
          <li>
            <code>POST /settle</code> — verify again, broadcast, and wait for the receipt
          </li>
          <li>
            <code>GET /health</code> — LiteForge RPC and database check
          </li>
          <li>
            <code>GET /transactions</code> — up to 50 settled payments, newest first
          </li>
        </ul>
        <p>
          Both payment routes take <code>paymentPayload</code> and <code>paymentRequirements</code>.
          They check version, scheme, network, the hex EIP-1559 transaction (chain id 4441,{" "}
          <code>gas</code>, <code>maxFeePerGas</code>, empty calldata, recoverable signature),{" "}
          <code>payTo</code>, exact value, pending nonce, and that the latest-block balance covers{" "}
          <code>value + gas * maxFeePerGas</code>. A pending spend can pass verify and still fail at
          broadcast. <code>resource</code> must be a non-empty string. <code>maxTimeoutSeconds</code>{" "}
          must be an integer from 1 to 30.
        </p>
        <p>
          <code>asset</code>, <code>description</code>, <code>mimeType</code>,{" "}
          <code>outputSchema</code>, and <code>extra</code> are not checked. Still set{" "}
          <code>asset</code> to the native placeholder. Nonce is read at{" "}
          <code>pending</code>. Balance is read at the latest block.
        </p>
        <p>
          One settle broadcasts. Another settle for the same requirements waits for that result, or
          returns <code>settlement_in_progress</code> and does not broadcast again. A receipt that
          misses the 30 second wait is <code>confirmation_timed_out</code>. Retry with the same
          signed transaction. An already settled payment fails verify with{" "}
          <code>replay_detected</code>. Settle of that same payload returns the stored success.
        </p>
        <p>
          <code>/verify</code> and <code>/settle</code> answer HTTP 200 for both valid and invalid
          payments. Read <code>isValid</code> or <code>success</code>. A body that is not JSON, or
          that omits either field, is HTTP 400.
        </p>
        <h3>Error reasons</h3>
        <ul>
          <li>
            <code>invalid_payload</code> — unusable body, transaction, <code>payTo</code>, amount,{" "}
            <code>resource</code>, timeout, type, calldata, or signature
          </li>
          <li>
            <code>invalid_x402_version</code> — <code>x402Version</code> is not 1
          </li>
          <li>
            <code>invalid_scheme</code> — scheme is not <code>exact-native</code>
          </li>
          <li>
            <code>invalid_network</code> — network is not <code>litvm-testnet</code>, or the signed
            chain id is not 4441
          </li>
          <li>
            <code>invalid_timeout</code> — <code>maxTimeoutSeconds</code> is above 30
          </li>
          <li>
            <code>invalid_recipient</code> — <code>tx.to</code> is not <code>payTo</code>
          </li>
          <li>
            <code>insufficient_value</code> — <code>tx.value</code> is too small
          </li>
          <li>
            <code>overpayment</code> — <code>tx.value</code> is too large
          </li>
          <li>
            <code>invalid_nonce</code> — nonce is not the payer&apos;s pending nonce
          </li>
          <li>
            <code>insufficient_funds</code> — latest-block balance does not cover value plus the gas
            ceiling
          </li>
          <li>
            <code>requirements_mismatch</code> — this hash is bound to a different resource,
            recipient, or amount
          </li>
          <li>
            <code>replay_detected</code> — verify of a payment already settled for these
            requirements
          </li>
          <li>
            <code>unexpected_verify_error</code> — a chain read failed during verify
          </li>
          <li>
            <code>confirmation_timed_out</code> — broadcast, and no receipt within 30 seconds
          </li>
          <li>
            <code>settlement_in_progress</code> — a settle for this hash is already in flight
          </li>
          <li>
            <code>transaction_failed</code> — the receipt reverted
          </li>
          <li>
            <code>unexpected_settle_error</code> — broadcast failed, or settle threw
          </li>
        </ul>
        <p>
          Verify reasons also appear as <code>errorReason</code> on a failed settle. The resource
          server returns HTTP 503 for <code>confirmation_timed_out</code> and{" "}
          <code>settlement_in_progress</code>, with no new 402. Other failures are HTTP 402 with the
          facilitator reason.
        </p>

        <h3>GET /supported</h3>
        <pre>
          <code>{supported}</code>
        </pre>
        <h3>POST /verify</h3>
        <pre>
          <code>{verifyRequest}</code>
        </pre>
        <p>Valid, HTTP 200:</p>
        <pre>
          <code>{verifyValid}</code>
        </pre>
        <p>
          Invalid, HTTP 200. <code>overpayment</code> is decided before the payer address is
          recovered:
        </p>
        <pre>
          <code>{verifyInvalid}</code>
        </pre>
        <h3>POST /settle</h3>
        <p>Success, HTTP 200:</p>
        <pre>
          <code>{settleSuccess}</code>
        </pre>
        <p>
          Replay of that same payload and the same bound requirements returns this stored success.
          The body has the same shape. <code>transaction</code> is the hash already settled.
        </p>
        <p>
          Timeout. The facilitator returns HTTP 200. The resource server returns HTTP 503 to the
          payer and does not issue a new 402. <code>settlement_in_progress</code> uses the same
          shape.
        </p>
        <pre>
          <code>{settleTimeout}</code>
        </pre>

        <h2 id="endpoint">Build an endpoint</h2>
        <p>
          The resource server has no key and must not broadcast the signed transaction.{" "}
          <code>payTo</code> is an address you control. The price is zkLTC wei. Fund a test payer
          from <a href="https://liteforge.hub.caldera.xyz">the LiteForge faucet</a>.
        </p>
        <ol>
          <li>
            With no <code>X-PAYMENT</code>, or a header that is not the base64 JSON payload, return
            HTTP 402 and <code>accepts</code>. <code>100000000000000</code> wei is 0.0001 zkLTC.{" "}
            <code>payTo</code> below is a placeholder.
          </li>
          <li>
            Decode <code>X-PAYMENT</code>. Post <code>paymentPayload</code> and the same{" "}
            <code>paymentRequirements</code> to <code>/settle</code>. You may call{" "}
            <code>/verify</code> first. <code>/settle</code> checks again.
          </li>
          <li>
            When <code>success</code> is true, serve the resource and set{" "}
            <code>X-PAYMENT-RESPONSE</code> to the base64 JSON of the settle response.
          </li>
          <li>
            <code>confirmation_timed_out</code> and <code>settlement_in_progress</code> are HTTP 503.
            Do not return a fresh 402 for that signed transaction.
          </li>
          <li>
            Any other failure is HTTP 402 again, with the facilitator reason in <code>error</code>{" "}
            and the same <code>accepts</code> entry.
          </li>
        </ol>
        <pre>
          <code>{accepts}</code>
        </pre>
        <p>
          On a later 402, add <code>error</code> (for example <code>overpayment</code>) beside{" "}
          <code>accepts</code>. Omit <code>error</code> on the first challenge.{" "}
          <code>resource</code> is the URL of this request, and it must match what you send to the
          facilitator. <code>maxTimeoutSeconds</code> is from 1 to 30. Facilitator:{" "}
          <code>https://relay-14-facilitator.compx.io</code>.
        </p>
        <p>
          Prompt: <a href="/prompts/resource-server.md">resource-server.md</a>.
        </p>

        <h2 id="paying">Pay</h2>
        <ol>
          <li>
            Request the resource. From a 402, select the <code>accepts</code> entry with scheme{" "}
            <code>exact-native</code> and network <code>litvm-testnet</code>.
          </li>
          <li>
            Sign an EIP-1559 transfer and do not broadcast it. <code>chainId</code> 4441,{" "}
            <code>to</code> is <code>payTo</code>, <code>value</code> is <code>maxAmountRequired</code>{" "}
            exactly, <code>data</code> is <code>0x</code>, <code>nonce</code> is the pending
            transaction count, and both <code>gas</code> and <code>maxFeePerGas</code> are set. The
            payer pays that gas on top of the price.
          </li>
          <li>
            Base64-encode the payment payload and retry the same request once with{" "}
            <code>X-PAYMENT</code>.
          </li>
          <li>
            HTTP 200 is the resource. <code>X-PAYMENT-RESPONSE</code> is the resource server&apos;s
            copy of the settle result. HTTP 503 means the same signed transaction may still land.
            Sign again only after a 402 whose <code>error</code> says this attempt cannot land.
          </li>
        </ol>
        <p>
          Fund the payer from <a href="https://liteforge.hub.caldera.xyz">the LiteForge faucet</a>.
          Prompt: <a href="/prompts/payer.md">payer.md</a>.
        </p>
      </div>
    </PageFrame>
  );
}
