-- A student leaves, and the fee account closes (D-172, slice 5).
--
-- 1. `student_leave_requests`: the Co-ordinator's request to mark a student Left, with a reason. The Principal approves it
--    through the approvals engine (kind `student_leave`, added to the CHECK list in 0041). At most one is open for a
--    student. It replaces the old rule that Left needed zero dues: what is unpaid stays owed (CLAUDE.md section 6).
-- 2. `fee_account_closures`: one row when an approved leave closes the student's fee account. It is written in the same
--    batch that marks the student Left, keeps what was owed at that moment, and is never changed or removed. From then on
--    the ledger takes no new entry for that enrollment from anyone (the trigger below): no payment, discount, refund,
--    charge or price change. Nothing reopens it.

CREATE TABLE student_leave_requests (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'closed')),
  requested_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX student_leave_requests_open ON student_leave_requests (enrollment_id) WHERE status IN ('draft', 'pending');
CREATE TRIGGER student_leave_requests_no_delete BEFORE DELETE ON student_leave_requests
BEGIN SELECT RAISE(ABORT, 'leave requests are kept'); END;
CREATE TRIGGER student_leave_requests_rules BEFORE UPDATE ON student_leave_requests
BEGIN
  SELECT RAISE(ABORT, 'a leave request only moves forward')
   WHERE NOT ((OLD.status = 'draft' AND NEW.status IN ('pending', 'closed')) OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'closed')))
      OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.reason <> OLD.reason;
END;

CREATE TABLE fee_account_closures (
  id INTEGER PRIMARY KEY,
  enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments (id),
  leave_request_id INTEGER NOT NULL UNIQUE REFERENCES student_leave_requests (id),
  closed_at TEXT NOT NULL,
  closed_by_user_id INTEGER NOT NULL REFERENCES users (id),
  -- What the account owed (positive) or was in credit by (negative), in paisa, when it closed.
  owed_paisa INTEGER NOT NULL CHECK (typeof(owed_paisa) = 'integer')
);
CREATE TRIGGER fee_account_closures_no_update BEFORE UPDATE ON fee_account_closures
BEGIN SELECT RAISE(ABORT, 'a closed fee account is never reopened or changed'); END;
CREATE TRIGGER fee_account_closures_no_delete BEFORE DELETE ON fee_account_closures
BEGIN SELECT RAISE(ABORT, 'a closed fee account is never reopened or changed'); END;

-- The ledger takes nothing for a closed account. The same rules as 0042, with one more.
DROP TRIGGER ledger_rules;
CREATE TRIGGER ledger_rules BEFORE INSERT ON ledger_entries
BEGIN
  -- A new entry must link to the current head; if another request appended first, the whole batch aborts and retries.
  SELECT RAISE(ABORT, 'ledger chain moved')
   WHERE NEW.prev_hash != (SELECT last_hash FROM ledger_chain_head WHERE id = 1);
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
  SELECT RAISE(ABORT, 'the fee account is closed')
   WHERE EXISTS (SELECT 1 FROM fee_account_closures c WHERE c.enrollment_id = NEW.enrollment_id);
  -- A reversal cancels exactly one payment of the same enrollment, for exactly its amount.
  SELECT RAISE(ABORT, 'a reversal must cancel one payment of the same student, in full')
   WHERE NEW.kind = 'reversal'
     AND NOT EXISTS (SELECT 1 FROM ledger_entries p WHERE p.id = NEW.refers_to_id AND p.kind = 'payment'
                      AND p.enrollment_id = NEW.enrollment_id AND p.amount_paisa = -NEW.amount_paisa);
  -- The undo of a discount cancels exactly one discount of the same enrollment, for exactly its amount.
  SELECT RAISE(ABORT, 'a discount undo must cancel one discount of the same student, in full')
   WHERE NEW.kind = 'discount' AND NEW.refers_to_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM ledger_entries p WHERE p.id = NEW.refers_to_id AND p.kind = 'discount' AND p.refers_to_id IS NULL
                      AND p.enrollment_id = NEW.enrollment_id AND p.amount_paisa = -NEW.amount_paisa);
END;
