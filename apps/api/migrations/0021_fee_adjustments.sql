-- Discounts, reversals and refunds (Phase 6, slice 4, D-077). Each is a request the Accountant makes and any Admin
-- decides through the approvals engine (D-061), never their own. The money itself is only ever a ledger entry (0019),
-- written in the approval's own batch (a discount, a reversal) or when the refund is recorded as paid back. This
-- table is the request's own state; it is never deleted, and a decided request never changes back.
--
-- status: draft (made, being sent), pending (waiting for an Admin), approved (applied; for a refund, approved but not
-- yet paid back), recorded (a refund paid back), closed (declined or withdrawn: never applied).

CREATE TABLE fee_adjustments (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('discount', 'reversal', 'refund')),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  amount_paisa INTEGER NOT NULL CHECK (typeof(amount_paisa) = 'integer' AND amount_paisa > 0 AND amount_paisa <= 100000000000),
  -- A discount: how it was asked for (the percentage is kept for the record; the amount is what applies).
  percent INTEGER CHECK (percent IS NULL OR percent BETWEEN 1 AND 100),
  -- A discount's reason (CLAUDE.md section 9 default list); OPEN: the client may add one for the published scholarship.
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('scholarship', 'sibling', 'staff_child', 'other')),
  note TEXT CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 300),
  -- A reversal's payment.
  payment_entry_id INTEGER REFERENCES ledger_entries (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'recorded', 'closed')),
  -- A refund, once paid back: how.
  refund_method TEXT CHECK (refund_method IS NULL OR refund_method IN ('cash', 'bank_transfer', 'cheque')),
  refund_reference TEXT CHECK (refund_reference IS NULL OR length(trim(refund_reference)) BETWEEN 1 AND 80),
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  CHECK ((kind = 'discount') = (reason_code IS NOT NULL)),
  CHECK ((kind = 'reversal') = (payment_entry_id IS NOT NULL)),
  CHECK (kind <> 'reversal' OR note IS NOT NULL),
  CHECK (reason_code IS NOT 'other' OR note IS NOT NULL),
  CHECK ((status = 'recorded') = (refund_method IS NOT NULL)),
  CHECK (status <> 'recorded' OR kind = 'refund')
);
CREATE INDEX fee_adjustments_enrollment ON fee_adjustments (enrollment_id, status);
-- A payment has at most one reversal waiting or done.
CREATE UNIQUE INDEX fee_adjustments_one_reversal ON fee_adjustments (payment_entry_id) WHERE kind = 'reversal' AND status IN ('draft', 'pending', 'approved');

CREATE TRIGGER fee_adjustments_forward_only BEFORE UPDATE ON fee_adjustments
BEGIN
  SELECT RAISE(ABORT, 'a fee adjustment only moves forward')
   WHERE NOT ((OLD.status = 'draft' AND NEW.status IN ('pending', 'closed'))
           OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'closed'))
           OR (OLD.status = 'approved' AND OLD.kind = 'refund' AND NEW.status = 'recorded'))
      OR NEW.amount_paisa <> OLD.amount_paisa OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.kind <> OLD.kind;
END;

CREATE TRIGGER fee_adjustments_no_delete BEFORE DELETE ON fee_adjustments
BEGIN SELECT RAISE(ABORT, 'fee adjustments are never deleted'); END;
