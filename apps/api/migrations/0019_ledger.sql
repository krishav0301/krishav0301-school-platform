-- The fee ledger (Phase 6, slice 1, D-074). CLAUDE.md section 6, "Fees and money": the balance is never stored; it
-- is the sum of an append-only ledger (charge, discount, payment, reversal, refund, carried dues). Money is whole
-- paisa. A payment is never edited or deleted: mistakes are reversed, and reversals and refunds are new entries that
-- point to the original. Append-only is enforced by triggers AND a keyed hash chain (D1 has no database accounts, so
-- our own code could remove a guard; the chain makes any edit, insert or delete in the middle detectable).
--
-- Signs: a positive amount raises what the student owes (charge, carried dues, reversal, refund); a negative one
-- lowers it (discount, payment). Year data: every entry hangs off an enrollment.

-- Fee structures (slice 2): one per academic year and programme level, drafted by the Accountant, approved by an
-- Admin, then live and fixed for the year (source 6.4). Items are One-time, Monthly, Yearly or Whole course, in whole
-- paisa. A draft's lines are switched off, never deleted; a live structure never changes.
CREATE TABLE fee_structures (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  level_id INTEGER NOT NULL REFERENCES levels (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'waiting', 'live')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  live_at TEXT,
  CHECK ((status = 'live') = (live_at IS NOT NULL)),
  UNIQUE (academic_year_id, level_id)
);

CREATE TABLE fee_items (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  structure_id INTEGER NOT NULL REFERENCES fee_structures (id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  amount_paisa INTEGER NOT NULL CHECK (typeof(amount_paisa) = 'integer' AND amount_paisa > 0 AND amount_paisa <= 10000000000),
  frequency TEXT NOT NULL CHECK (frequency IN ('one_time', 'monthly', 'yearly', 'whole_course')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX fee_items_structure ON fee_items (structure_id);

-- Only a draft's lines change, and every change bumps the structure's version (a pending approval then goes stale).
CREATE TRIGGER fee_items_draft_insert BEFORE INSERT ON fee_items
BEGIN
  SELECT RAISE(ABORT, 'only a draft fee structure can change')
   WHERE (SELECT status FROM fee_structures WHERE id = NEW.structure_id) <> 'draft';
END;
CREATE TRIGGER fee_items_draft_update BEFORE UPDATE ON fee_items
BEGIN
  SELECT RAISE(ABORT, 'only a draft fee structure can change')
   WHERE (SELECT status FROM fee_structures WHERE id = OLD.structure_id) <> 'draft' OR NEW.structure_id <> OLD.structure_id;
END;
CREATE TRIGGER fee_items_no_delete BEFORE DELETE ON fee_items
BEGIN SELECT RAISE(ABORT, 'fee items are switched off, never deleted'); END;
CREATE TRIGGER fee_items_bump_insert AFTER INSERT ON fee_items
BEGIN UPDATE fee_structures SET version = version + 1 WHERE id = NEW.structure_id; END;
CREATE TRIGGER fee_items_bump_update AFTER UPDATE ON fee_items
BEGIN UPDATE fee_structures SET version = version + 1 WHERE id = NEW.structure_id; END;

-- A live structure never changes; a closed year's structures neither; nothing is deleted.
CREATE TRIGGER fee_structures_rules BEFORE UPDATE ON fee_structures
BEGIN
  SELECT RAISE(ABORT, 'a live fee structure is fixed for the year')
   WHERE OLD.status = 'live' AND (NEW.status <> 'live' OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.level_id <> OLD.level_id);
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed' AND NEW.status <> OLD.status;
END;
CREATE TRIGGER fee_structures_year_open BEFORE INSERT ON fee_structures
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;
CREATE TRIGGER fee_structures_no_delete BEFORE DELETE ON fee_structures
BEGIN SELECT RAISE(ABORT, 'fee structures are never deleted'); END;

CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  kind TEXT NOT NULL CHECK (kind IN ('charge', 'carried_dues', 'discount', 'payment', 'reversal', 'refund')),
  amount_paisa INTEGER NOT NULL CHECK (typeof(amount_paisa) = 'integer' AND amount_paisa <> 0 AND abs(amount_paisa) <= 100000000000),
  -- What a charge is for: the fee item and its billing period ('year', 'course', or a BS month 'YYYY-MM').
  fee_item_id INTEGER REFERENCES fee_items (id),
  period TEXT,
  due_on TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- A reversal points to the payment it reverses.
  refers_to_id INTEGER REFERENCES ledger_entries (id),
  -- Where the entry came from: a cash payment, a voucher, a gateway attempt, an approval request.
  source_type TEXT,
  source_public_id TEXT,
  memo TEXT CHECK (memo IS NULL OR length(memo) <= 500),
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL UNIQUE,   -- unique: the chain can never fork
  hash TEXT NOT NULL UNIQUE,
  CHECK ((kind IN ('charge', 'carried_dues', 'reversal', 'refund')) = (amount_paisa > 0)),
  CHECK ((kind IN ('charge', 'carried_dues')) = (due_on IS NOT NULL)),
  CHECK ((kind = 'charge') = (fee_item_id IS NOT NULL AND period IS NOT NULL)),
  CHECK ((kind = 'reversal') = (refers_to_id IS NOT NULL))
);

CREATE INDEX ledger_entries_enrollment ON ledger_entries (enrollment_id, kind);
-- A fee item is charged once per student and billing period.
CREATE UNIQUE INDEX ledger_one_charge ON ledger_entries (enrollment_id, fee_item_id, period) WHERE kind = 'charge';
-- A payment is reversed at most once.
CREATE UNIQUE INDEX ledger_one_reversal ON ledger_entries (refers_to_id) WHERE kind = 'reversal';
-- A source (a voucher, a gateway attempt, an approval) is applied at most once.
CREATE UNIQUE INDEX ledger_one_per_source ON ledger_entries (source_type, source_public_id) WHERE source_public_id IS NOT NULL;

CREATE TABLE ledger_chain_head (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_id INTEGER NOT NULL,
  last_hash TEXT NOT NULL
);
INSERT INTO ledger_chain_head (id, last_id, last_hash) VALUES (1, 0, '0000000000000000000000000000000000000000000000000000000000000000');

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
END;

CREATE TRIGGER ledger_advance_head AFTER INSERT ON ledger_entries
BEGIN
  UPDATE ledger_chain_head SET last_id = NEW.id, last_hash = NEW.hash WHERE id = 1;
END;

-- Receipts: a gapless sequence per section and academic year. The counter row is incremented in the same batch as
-- the payment, so a payment that fails rolls its number back with it. A receipt is never edited or deleted.
CREATE TABLE receipt_counters (
  section_id INTEGER NOT NULL REFERENCES sections (id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (section_id, academic_year_id)
);

CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  number TEXT NOT NULL UNIQUE,
  section_id INTEGER NOT NULL REFERENCES sections (id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  sequence INTEGER NOT NULL,
  payment_entry_id INTEGER NOT NULL UNIQUE REFERENCES ledger_entries (id),
  issued_at TEXT NOT NULL,
  UNIQUE (section_id, academic_year_id, sequence)
);

CREATE TRIGGER receipts_no_update BEFORE UPDATE ON receipts
BEGIN SELECT RAISE(ABORT, 'a receipt is never edited'); END;

CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts
BEGIN SELECT RAISE(ABORT, 'a receipt is never deleted'); END;

-- Gapless: a receipt takes exactly the counter's next number (the counter then moves on in the same batch).
CREATE TRIGGER receipts_gapless BEFORE INSERT ON receipts
BEGIN
  SELECT RAISE(ABORT, 'a receipt number must be the next in its sequence')
   WHERE NEW.sequence <> (SELECT next_number FROM receipt_counters WHERE section_id = NEW.section_id AND academic_year_id = NEW.academic_year_id);
  SELECT RAISE(ABORT, 'a receipt is only for a payment')
   WHERE (SELECT kind FROM ledger_entries WHERE id = NEW.payment_entry_id) <> 'payment';
END;

CREATE TRIGGER receipts_advance_counter AFTER INSERT ON receipts
BEGIN
  UPDATE receipt_counters SET next_number = next_number + 1 WHERE section_id = NEW.section_id AND academic_year_id = NEW.academic_year_id;
END;
