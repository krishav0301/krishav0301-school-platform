-- Taking back a published result (D-199, the PM, 2026-11-23). The Principal (or Support) takes back one class's published
-- exam, names the subjects that were entered wrongly and why; those sheets go back to their teachers as drafts, the rest
-- wait as verified, and the Co-ordinator publishes again as usual. Nothing is deleted: the publication stays, a
-- withdrawal is recorded beside it, and publishing again adds the next version of every card (the old ones are kept).
-- While a withdrawal is open the class's exam, and its final result if it has one, are not shown to anyone.

CREATE TABLE result_withdrawals (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  publication_id INTEGER NOT NULL REFERENCES result_publications (id),
  class_id INTEGER NOT NULL REFERENCES classes (id),
  terminal_id INTEGER NOT NULL REFERENCES terminals (id),
  -- The subjects sent back to their teachers (offering public ids), at least one.
  offerings TEXT NOT NULL CHECK (json_valid(offerings) AND json_array_length(offerings) >= 1),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  withdrawn_by_user_id INTEGER NOT NULL REFERENCES users (id),
  withdrawn_at TEXT NOT NULL,
  republished_by_user_id INTEGER REFERENCES users (id),
  republished_at TEXT,
  CHECK ((republished_at IS NULL) = (republished_by_user_id IS NULL))
);

-- One open withdrawal per class at a time: the final result depends on every exam, so two at once could not be republished cleanly.
CREATE UNIQUE INDEX result_withdrawals_one_open ON result_withdrawals (class_id) WHERE republished_at IS NULL;
CREATE INDEX result_withdrawals_publication ON result_withdrawals (publication_id);

CREATE TRIGGER result_withdrawals_rules_insert BEFORE INSERT ON result_withdrawals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
  SELECT RAISE(ABORT, 'only an exam''s publication can be taken back')
   WHERE NOT EXISTS (SELECT 1 FROM result_publications rp WHERE rp.id = NEW.publication_id AND rp.class_id = NEW.class_id AND rp.terminal_id = NEW.terminal_id);
  SELECT RAISE(ABORT, 'a withdrawal starts open') WHERE NEW.republished_at IS NOT NULL;
END;

CREATE TRIGGER result_withdrawals_rules_update BEFORE UPDATE ON result_withdrawals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
  SELECT RAISE(ABORT, 'a withdrawal is closed once') WHERE OLD.republished_at IS NOT NULL;
  SELECT RAISE(ABORT, 'a withdrawal never changes except to be closed')
   WHERE NEW.public_id <> OLD.public_id OR NEW.publication_id <> OLD.publication_id OR NEW.class_id <> OLD.class_id OR NEW.terminal_id <> OLD.terminal_id
      OR NEW.offerings <> OLD.offerings OR NEW.reason <> OLD.reason OR NEW.withdrawn_by_user_id <> OLD.withdrawn_by_user_id OR NEW.withdrawn_at <> OLD.withdrawn_at;
END;

CREATE TRIGGER result_withdrawals_no_delete BEFORE DELETE ON result_withdrawals
BEGIN
  SELECT RAISE(ABORT, 'a withdrawal is never deleted');
END;

-- A sheet's status: as before (Draft -> Under review -> Verified -> Published; Under review or Verified back to Draft with a
-- note), and now a published sheet may go back to Draft (with a note) or to Verified, only while its class's exam is taken back.
DROP TRIGGER mark_sheets_rules;
CREATE TRIGGER mark_sheets_rules BEFORE UPDATE ON mark_sheets
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
  SELECT RAISE(ABORT, 'a sheet stays with its class, subject, terminal and paper')
   WHERE NEW.class_id <> OLD.class_id OR NEW.offering_id <> OLD.offering_id OR NEW.terminal_id <> OLD.terminal_id
      OR NEW.theory_max_hundredths <> OLD.theory_max_hundredths OR NEW.practical_max_hundredths IS NOT OLD.practical_max_hundredths;
  SELECT RAISE(ABORT, 'that status change is not allowed')
   WHERE NEW.status <> OLD.status
     AND NOT ((OLD.status = 'draft' AND NEW.status = 'under_review')
           OR (OLD.status = 'under_review' AND NEW.status IN ('draft', 'verified'))
           OR (OLD.status = 'verified' AND NEW.status IN ('draft', 'published'))
           OR (OLD.status = 'published' AND NEW.status IN ('draft', 'verified')
               AND EXISTS (SELECT 1 FROM result_withdrawals w WHERE w.class_id = OLD.class_id AND w.terminal_id = OLD.terminal_id AND w.republished_at IS NULL)));
  SELECT RAISE(ABORT, 'a sheet sent back needs a note')
   WHERE OLD.status IN ('under_review', 'verified', 'published') AND NEW.status = 'draft' AND (NEW.note IS NULL OR length(trim(NEW.note)) = 0);
END;
