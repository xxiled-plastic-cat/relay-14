export type PaymentStatus = "verified" | "settling" | "settled" | "failed";

export type PaymentRow = {
  txHash: string;
  payer: string;
  payTo: string;
  amountWei: string;
  resource: string;
  status: PaymentStatus;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
  blockNumber: number | null;
};

export type VerifiedPayment = {
  txHash: string;
  payer: string;
  payTo: string;
  amountWei: string;
  resource: string;
  createdAt: string;
};

export interface PaymentStore {
  findByHash(txHash: string): Promise<PaymentRow | null>;
  insertVerified(row: VerifiedPayment): Promise<void>;
  refreshVerified(row: VerifiedPayment): Promise<void>;
  /** Moves `verified` → `settling`. Only the caller that gets `true` may broadcast. */
  claimSettling(txHash: string): Promise<boolean>;
  markSettled(txHash: string, blockNumber: number, settledAt: string): Promise<void>;
  markFailed(txHash: string, error: string): Promise<void>;
}

export interface ChainReader {
  getTransactionCount(address: `0x${string}`): Promise<number>;
  getBalance(address: `0x${string}`): Promise<bigint>;
}

type SqlValue = string | number | null;

type BoundStatement = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};

/** Structural slice of D1 used by the relay-14 Worker. */
export interface RelayDatabase {
  prepare(sql: string): {
    bind(...values: SqlValue[]): BoundStatement;
  };
}

type DbPayment = {
  tx_hash: string;
  payer: string;
  pay_to: string;
  amount_wei: string;
  resource: string;
  status: PaymentStatus;
  error: string | null;
  created_at: string;
  settled_at: string | null;
  block_number: number | null;
};

export function createD1PaymentStore(db: RelayDatabase): PaymentStore {
  return {
    async findByHash(txHash) {
      const row = await db
        .prepare(
          `SELECT tx_hash, payer, pay_to, amount_wei, resource, status, error, created_at, settled_at, block_number
           FROM payments WHERE tx_hash = ?`,
        )
        .bind(txHash)
        .first<DbPayment>();
      return row ? fromDb(row) : null;
    },

    async insertVerified(row) {
      await db
        .prepare(
          `INSERT INTO payments (tx_hash, payer, pay_to, amount_wei, resource, status, error, created_at, settled_at, block_number)
           VALUES (?, ?, ?, ?, ?, 'verified', NULL, ?, NULL, NULL)`,
        )
        .bind(row.txHash, row.payer, row.payTo, row.amountWei, row.resource, row.createdAt)
        .run();
    },

    async refreshVerified(row) {
      // Resource, recipient, and amount stay as first verified. Only a failed row can return to verified.
      await db
        .prepare(
          `UPDATE payments
           SET status = 'verified', error = NULL
           WHERE tx_hash = ? AND status = 'failed'`,
        )
        .bind(row.txHash)
        .run();
    },

    async claimSettling(txHash) {
      const result = await db
        .prepare(
          `UPDATE payments
           SET status = 'settling', error = NULL
           WHERE tx_hash = ? AND status = 'verified'`,
        )
        .bind(txHash)
        .run();
      return (result.meta?.changes ?? 0) === 1;
    },

    async markSettled(txHash, blockNumber, settledAt) {
      await db
        .prepare(
          `UPDATE payments
           SET status = 'settled', settled_at = ?, block_number = ?, error = NULL
           WHERE tx_hash = ? AND status = 'settling'`,
        )
        .bind(settledAt, blockNumber, txHash)
        .run();
    },

    async markFailed(txHash, error) {
      await db
        .prepare(
          `UPDATE payments
           SET status = 'failed', error = ?
           WHERE tx_hash = ? AND status = 'settling'`,
        )
        .bind(error, txHash)
        .run();
    },
  };
}

export type SettledPayment = {
  txHash: string;
  payer: string;
  payTo: string;
  amountWei: string;
  settledAt: string | null;
  blockNumber: number | null;
};

const LIST_CAP = 50;

type DbSettled = {
  tx_hash: string;
  payer: string;
  pay_to: string;
  amount_wei: string;
  settled_at: string | null;
  block_number: number | null;
};

/** Newest settled payments. Not part of PaymentStore; verify and settle do not call it. */
export async function listSettledPayments(db: RelayDatabase, limit = LIST_CAP): Promise<SettledPayment[]> {
  const capped = Math.min(LIST_CAP, Math.max(1, Math.floor(limit)));
  const result = await db
    .prepare(
      `SELECT tx_hash, payer, pay_to, amount_wei, settled_at, block_number
       FROM payments
       WHERE status = 'settled'
       ORDER BY settled_at DESC
       LIMIT ?`,
    )
    .bind(capped)
    .all<DbSettled>();

  return result.results.map((row) => ({
    txHash: row.tx_hash,
    payer: row.payer,
    payTo: row.pay_to,
    amountWei: row.amount_wei,
    settledAt: row.settled_at,
    blockNumber: row.block_number,
  }));
}

function fromDb(row: DbPayment): PaymentRow {
  return {
    txHash: row.tx_hash,
    payer: row.payer,
    payTo: row.pay_to,
    amountWei: row.amount_wei,
    resource: row.resource,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    settledAt: row.settled_at,
    blockNumber: row.block_number,
  };
}
