-- Payments (Phase 6, slice 3, D-076). A payment is a ledger entry (0019); these tables are where it came from.
-- Cash is entered by the Accountant; a voucher is a bank deposit the student reports and the Accountant verifies
-- (a reference only: R2 is off, D-020, so there is no scan); an online attempt goes through the gateway interface
-- (only a demo adapter exists until Phase 9). Each source is applied to the ledger at most once (the ledger's own
-- unique index on its source), and a gateway reference is unique, so a repeated callback cannot credit twice.

CREATE TABLE fee_vouchers (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  amount_paisa INTEGER NOT NULL CHECK (typeof(amount_paisa) = 'integer' AND amount_paisa > 0 AND amount_paisa <= 10000000000),
  bank TEXT NOT NULL CHECK (length(trim(bank)) BETWEEN 1 AND 80),
  reference TEXT NOT NULL CHECK (length(trim(reference)) BETWEEN 1 AND 80),
  paid_on TEXT NOT NULL CHECK (paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'verified', 'rejected')),
  reason TEXT CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 300),
  submitted_at TEXT NOT NULL,
  decided_by_user_id INTEGER REFERENCES users (id),
  decided_at TEXT,
  CHECK ((status = 'submitted') = (decided_at IS NULL)),
  CHECK (status <> 'rejected' OR reason IS NOT NULL)
);
CREATE INDEX fee_vouchers_status ON fee_vouchers (status, submitted_at);
-- One bank deposit is claimed once (a rejected one may be sent again, corrected).
CREATE UNIQUE INDEX fee_vouchers_one_reference ON fee_vouchers (bank COLLATE NOCASE, reference COLLATE NOCASE) WHERE status <> 'rejected';

CREATE TRIGGER fee_vouchers_decide_once BEFORE UPDATE ON fee_vouchers
BEGIN
  SELECT RAISE(ABORT, 'a voucher is decided once')
   WHERE OLD.status <> 'submitted' OR NEW.amount_paisa <> OLD.amount_paisa OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.reference <> OLD.reference;
END;
CREATE TRIGGER fee_vouchers_no_delete BEFORE DELETE ON fee_vouchers
BEGIN SELECT RAISE(ABORT, 'vouchers are never deleted'); END;

CREATE TABLE payment_attempts (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  amount_paisa INTEGER NOT NULL CHECK (typeof(amount_paisa) = 'integer' AND amount_paisa > 0 AND amount_paisa <= 10000000000),
  gateway TEXT NOT NULL,
  gateway_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'confirmed', 'failed')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TRIGGER payment_attempts_settle_once BEFORE UPDATE ON payment_attempts
BEGIN
  SELECT RAISE(ABORT, 'a payment attempt settles once')
   WHERE OLD.status <> 'initiated' OR NEW.amount_paisa <> OLD.amount_paisa OR NEW.gateway_reference <> OLD.gateway_reference OR NEW.enrollment_id <> OLD.enrollment_id;
END;
CREATE TRIGGER payment_attempts_no_delete BEFORE DELETE ON payment_attempts
BEGIN SELECT RAISE(ABORT, 'payment attempts are never deleted'); END;
