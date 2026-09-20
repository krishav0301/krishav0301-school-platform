DROP TABLE IF EXISTS ledger;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS receipt_counter;

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  amount_paisa INTEGER NOT NULL
);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  approval_id INTEGER,
  receipt_no INTEGER,
  at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ledger_receipt_unique ON ledger(receipt_no) WHERE receipt_no IS NOT NULL;
CREATE UNIQUE INDEX ledger_approval_unique ON ledger(approval_id) WHERE approval_id IS NOT NULL;

CREATE TABLE receipt_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_no INTEGER NOT NULL
);
INSERT INTO receipt_counter (id, next_no) VALUES (1, 1);

CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
