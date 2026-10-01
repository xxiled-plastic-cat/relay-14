-- SQLite cannot alter a CHECK constraint in place.
CREATE TABLE payments_next (
  tx_hash TEXT PRIMARY KEY,
  payer TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  resource TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'settling', 'settled', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT,
  block_number INTEGER
);

INSERT INTO payments_next (
  tx_hash, payer, pay_to, amount_wei, resource, status, error, created_at, settled_at, block_number
)
SELECT
  tx_hash, payer, pay_to, amount_wei, resource, status, error, created_at, settled_at, block_number
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_next RENAME TO payments;

CREATE INDEX idx_payments_payer ON payments (payer);
CREATE INDEX idx_payments_pay_to ON payments (pay_to);
