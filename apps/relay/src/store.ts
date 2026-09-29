export type PaymentStatus = "verified" | "settled" | "failed";

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
  run(): Promise<unknown>;
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
      await db
        .prepare(
          `UPDATE payments
           SET payer = ?, pay_to = ?, amount_wei = ?, resource = ?, status = 'verified', error = NULL
           WHERE tx_hash = ? AND status != 'settled'`,
        )
        .bind(row.payer, row.payTo, row.amountWei, row.resource, row.txHash)
        .run();
    },

    async markSettled(txHash, blockNumber, settledAt) {
      await db
        .prepare(
          `UPDATE payments
           SET status = 'settled', settled_at = ?, block_number = ?, error = NULL
           WHERE tx_hash = ? AND status != 'settled'`,
        )
        .bind(settledAt, blockNumber, txHash)
        .run();
    },

    async markFailed(txHash, error) {
      await db
        .prepare(
          `UPDATE payments
           SET status = 'failed', error = ?
           WHERE tx_hash = ? AND status != 'settled'`,
        )
        .bind(error, txHash)
        .run();
    },
  };
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
