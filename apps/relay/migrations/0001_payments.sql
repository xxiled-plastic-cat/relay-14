CREATE TABLE payments (
  tx_hash TEXT PRIMARY KEY,
  payer TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  resource TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'settled', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT,
  block_number INTEGER
);

CREATE INDEX idx_payments_payer ON payments (payer);
CREATE INDEX idx_payments_pay_to ON payments (pay_to);
