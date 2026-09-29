import { useEffect, useState } from "react";
import { PageFrame } from "../components/PageFrame";
import {
  TRANSACTIONS_URL,
  explorerTxUrl,
  formatSettledAt,
  formatZkltc,
  shortHex,
  type SettledTransaction,
} from "../lib/tx";

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; transactions: SettledTransaction[] };

function isTransaction(value: unknown): value is SettledTransaction {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.txHash === "string" &&
    typeof row.payer === "string" &&
    typeof row.payTo === "string" &&
    typeof row.amountWei === "string" &&
    (row.settledAt === null || typeof row.settledAt === "string") &&
    (row.blockNumber === null || typeof row.blockNumber === "number")
  );
}

export function TxnsPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(TRANSACTIONS_URL, { signal: controller.signal });
        if (!response.ok) {
          setLoad({ status: "error" });
          return;
        }
        const body: unknown = await response.json();
        const rows =
          typeof body === "object" && body !== null && "transactions" in body
            ? (body as { transactions: unknown }).transactions
            : null;
        if (!Array.isArray(rows) || !rows.every(isTransaction)) {
          setLoad({ status: "error" });
          return;
        }
        setLoad({ status: "ready", transactions: rows });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoad({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <PageFrame title="Transactions">
      {load.status === "loading" ? <p className="page-status">Loading…</p> : null}
      {load.status === "error" ? <p className="page-status">Facilitator unreachable.</p> : null}
      {load.status === "ready" && load.transactions.length === 0 ? (
        <p className="page-status">No transactions yet.</p>
      ) : null}
      {load.status === "ready" && load.transactions.length > 0 ? (
        <ul className="tx-list">
          {load.transactions.map((tx) => (
            <li key={tx.txHash}>
              <a
                className="tx-row"
                href={explorerTxUrl(tx.txHash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{formatSettledAt(tx.settledAt)}</span>
                <span>{formatZkltc(tx.amountWei)} zkLTC</span>
                <span>
                  {shortHex(tx.payer)} → {shortHex(tx.payTo)}
                </span>
                <span className="tx-hash">{shortHex(tx.txHash)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </PageFrame>
  );
}
