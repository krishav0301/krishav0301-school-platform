-- Discounts given by the Principal, undone inside a window (D-172, slice 4).
--
-- 1. A discount is no longer asked for and approved: the Principal gives it on the student's fees page, and for 15 days
--    can change or remove it. The ledger is append-only, so an undo is a new entry: a `discount` entry with a POSITIVE
--    amount that points (`refers_to_id`) at the discount it cancels, for exactly its amount, once. Every sum that adds
--    up `discount` entries (what was discounted, the balance, the credit pool) is therefore right without change.
--    The ledger's CHECKs and its rules trigger say so, which needs the table rebuilt the way 0030, 0031, 0040 and 0041
--    rebuilt theirs: copy the rows aside, drop, create again under the same name, put the rows back with the same ids and
--    hashes (so the chain is untouched), with foreign keys deferred until the commit.
-- 2. `student_discounts` keeps what the ledger entry cannot say: the reason, the percentage asked for, the note, and the
--    day the window closes. It moves from `active` to `removed` or `replaced` and nothing else changes in it.

PRAGMA defer_foreign_keys = true;

CREATE TABLE ledger_entries_copy AS SELECT * FROM ledger_entries;
DROP TABLE ledger_entries;

CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  kind TEXT NOT NULL CHECK (kind IN ('charge', 'carried_dues', 'discount', 'payment', 'reversal', 'refund')),
  amount_paisa INTEGER NOT NULL CHECK (typeof(amount_paisa) = 'integer' AND amount_paisa <> 0 AND abs(amount_paisa) <= 100000000000),
  fee_item_id INTEGER REFERENCES fee_items (id),
  period TEXT,
  due_on TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- A reversal points to the payment it reverses; the undo of a discount points to the discount it cancels.
  refers_to_id INTEGER REFERENCES ledger_entries (id),
  source_type TEXT,
  source_public_id TEXT,
  memo TEXT CHECK (memo IS NULL OR length(memo) <= 500),
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL UNIQUE,
  -- A discount lowers what is owed (negative) unless it is the undo of one (positive, and pointing at it).
  CHECK (CASE WHEN kind = 'discount' THEN (amount_paisa < 0) = (refers_to_id IS NULL)
              ELSE (kind IN ('charge', 'carried_dues', 'reversal', 'refund')) = (amount_paisa > 0) END),
  CHECK ((kind IN ('charge', 'carried_dues')) = (due_on IS NOT NULL)),
  CHECK ((kind = 'charge') = (fee_item_id IS NOT NULL AND period IS NOT NULL)),
  CHECK (CASE WHEN kind = 'reversal' THEN refers_to_id IS NOT NULL WHEN kind = 'discount' THEN 1 ELSE refers_to_id IS NULL END)
);

INSERT INTO ledger_entries (id, public_id, enrollment_id, kind, amount_paisa, fee_item_id, period, due_on, refers_to_id, source_type, source_public_id, memo, created_by_user_id, created_at, prev_hash, hash)
SELECT id, public_id, enrollment_id, kind, amount_paisa, fee_item_id, period, due_on, refers_to_id, source_type, source_public_id, memo, created_by_user_id, created_at, prev_hash, hash FROM ledger_entries_copy ORDER BY id;
DROP TABLE ledger_entries_copy;

CREATE INDEX ledger_entries_enrollment ON ledger_entries (enrollment_id, kind);
CREATE INDEX ledger_entries_kind_time ON ledger_entries (kind, created_at);
CREATE UNIQUE INDEX ledger_one_charge ON ledger_entries (enrollment_id, fee_item_id, period) WHERE kind = 'charge';
CREATE UNIQUE INDEX ledger_one_reversal ON ledger_entries (refers_to_id) WHERE kind = 'reversal';
-- A discount is undone at most once.
CREATE UNIQUE INDEX ledger_one_discount_undo ON ledger_entries (refers_to_id) WHERE kind = 'discount' AND refers_to_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_one_per_source ON ledger_entries (source_type, source_public_id) WHERE source_public_id IS NOT NULL;

CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;

CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;

CREATE TRIGGER ledger_rules BEFORE INSERT ON ledger_entries
BEGIN
  -- A new entry must link to the current head; if another request appended first, the whole batch aborts and retries.
  SELECT RAISE(ABORT, 'ledger chain moved')
   WHERE NEW.prev_hash != (SELECT last_hash FROM ledger_chain_head WHERE id = 1);
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
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

CREATE TRIGGER ledger_advance_head AFTER INSERT ON ledger_entries
BEGIN
  UPDATE ledger_chain_head SET last_id = NEW.id, last_hash = NEW.hash WHERE id = 1;
END;

CREATE TABLE student_discounts (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  amount_paisa INTEGER NOT NULL CHECK (typeof(amount_paisa) = 'integer' AND amount_paisa > 0 AND amount_paisa <= 100000000000),
  -- How it was asked for (the percentage is kept for the record; the amount is what applies).
  percent INTEGER CHECK (percent IS NULL OR percent BETWEEN 1 AND 100),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('scholarship', 'sibling', 'staff_child', 'other')),
  note TEXT CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 300),
  -- The ledger entry that lowers what is owed.
  entry_id INTEGER NOT NULL UNIQUE REFERENCES ledger_entries (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'replaced')),
  -- Until this moment (15 days after it was first given) the Principal may change or remove it; then it is frozen.
  window_ends_at TEXT NOT NULL,
  -- The discount this one replaced when it was changed (the window carries over).
  replaces_id INTEGER REFERENCES student_discounts (id),
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  CHECK (reason_code <> 'other' OR note IS NOT NULL)
);
CREATE INDEX student_discounts_enrollment ON student_discounts (enrollment_id, status);

CREATE TRIGGER student_discounts_rules BEFORE UPDATE ON student_discounts
BEGIN
  SELECT RAISE(ABORT, 'a discount only moves from active to removed or replaced')
   WHERE NOT (OLD.status = 'active' AND NEW.status IN ('removed', 'replaced'))
      OR NEW.amount_paisa <> OLD.amount_paisa OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.entry_id <> OLD.entry_id
      OR NEW.window_ends_at <> OLD.window_ends_at OR NEW.reason_code <> OLD.reason_code;
END;
CREATE TRIGGER student_discounts_no_delete BEFORE DELETE ON student_discounts
BEGIN SELECT RAISE(ABORT, 'discounts are never deleted'); END;
CREATE TRIGGER student_discounts_year_open BEFORE INSERT ON student_discounts
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
END;
