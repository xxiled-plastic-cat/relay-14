import { PageFrame } from "../components/PageFrame";

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
          Scheme <code>exact-native</code>. Network <code>litvm-testnet</code>. Asset zkLTC, 18
          decimals. The facilitator waits 30 seconds for a receipt. A payment requirement must not
          ask for longer.
        </p>
        <p>
          Facilitator{" "}
          <a href="https://relay-14-facilitator.compx.io">https://relay-14-facilitator.compx.io</a>
        </p>
        <ul className="route-list">
          <li>
            <code>GET /supported</code> — schemes this facilitator accepts
          </li>
          <li>
            <code>POST /verify</code> — check a signed transfer
          </li>
          <li>
            <code>POST /settle</code> — broadcast it and wait for the receipt
          </li>
          <li>
            <code>GET /health</code> — RPC and database check
          </li>
        </ul>
      </div>
    </PageFrame>
  );
}
