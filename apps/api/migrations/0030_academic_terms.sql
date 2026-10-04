-- Academic terms of any length (D-109, D-110). The table keeps its name, `academic_years`, and every column that points
-- at it keeps `academic_year_id`: a row is now an academic term (a quarter, a semester, a year), set by the Principal.
-- What changes:
--   * several terms can be open at once, so the one-active index goes;
--   * a BS year can hold several terms, so `bs_year` (the BS year the term starts in) is no longer unique;
--   * each term has a short `code`, the marker in its receipt numbers (P2-2083-00007); existing years get their BS year,
--     so the numbers they already issue do not change;
--   * `term_levels` says which levels run in a term, and a level is in only one open term at a time;
--   * a class may only be made for a level its term runs;
--   * a level has a usual length in months, used to fill in the next term's dates;
--   * an enrollment can name the one it came from (promotion), so a closed term is never written to.
--
-- The table is rebuilt the way SQLite allows on D1 (no PRAGMA foreign_keys = OFF there): copy the rows aside, drop it,
-- create it again under the same name and put the rows back. Foreign keys are deferred, so the moment between the drop
-- and the re-insert does not fail; putting the rows back with the same ids settles every reference before the commit.
-- Nothing is renamed, so the triggers on other tables that read `academic_years` keep working unchanged.

PRAGMA defer_foreign_keys = true;

CREATE TABLE academic_years_copy AS SELECT * FROM academic_years;
DROP TABLE academic_years;

CREATE TABLE academic_years (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  bs_year INTEGER NOT NULL CHECK (bs_year BETWEEN 2000 AND 2100),
  code TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 2 AND 10 AND code NOT GLOB '*[^A-Z0-9]*'),
  label TEXT NOT NULL UNIQUE CHECK (length(label) BETWEEN 1 AND 60),
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK (end_date > start_date),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

INSERT INTO academic_years (id, public_id, bs_year, code, label, start_date, end_date, status, created_at, closed_at)
  SELECT id, public_id, bs_year, CAST(bs_year AS TEXT), label, start_date, end_date, status, created_at, closed_at FROM academic_years_copy;
DROP TABLE academic_years_copy;

CREATE INDEX academic_years_status ON academic_years (status, start_date);

-- Dropped with the old table; the same rule again.
CREATE TRIGGER academic_years_closed_is_final BEFORE UPDATE ON academic_years
WHEN OLD.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed');
END;

-- The levels a term runs. A level is in only one open (draft or active) term at a time, so two terms never claim the
-- same students or classes. A closed term's levels never change.
CREATE TABLE term_levels (
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  level_id INTEGER NOT NULL REFERENCES levels (id),
  PRIMARY KEY (academic_year_id, level_id)
);
CREATE INDEX term_levels_level ON term_levels (level_id);

-- What the existing classes already run: each year holds the levels it has classes for.
INSERT INTO term_levels (academic_year_id, level_id) SELECT DISTINCT academic_year_id, level_id FROM classes;

CREATE TRIGGER term_levels_insert BEFORE INSERT ON term_levels
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
  SELECT RAISE(ABORT, 'that level is already in another open term')
   WHERE EXISTS (SELECT 1 FROM term_levels tl JOIN academic_years ay ON ay.id = tl.academic_year_id
                  WHERE tl.level_id = NEW.level_id AND tl.academic_year_id <> NEW.academic_year_id AND ay.status <> 'closed');
END;

CREATE TRIGGER term_levels_no_update BEFORE UPDATE ON term_levels
BEGIN
  SELECT RAISE(ABORT, 'a term''s levels are added or removed, never changed');
END;

CREATE TRIGGER term_levels_delete BEFORE DELETE ON term_levels
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed';
  SELECT RAISE(ABORT, 'the term has classes at that level')
   WHERE EXISTS (SELECT 1 FROM classes WHERE academic_year_id = OLD.academic_year_id AND level_id = OLD.level_id);
END;

-- A class is only for a level its term runs.
CREATE TRIGGER classes_level_in_term_insert BEFORE INSERT ON classes
BEGIN
  SELECT RAISE(ABORT, 'that level is not in the term')
   WHERE NOT EXISTS (SELECT 1 FROM term_levels WHERE academic_year_id = NEW.academic_year_id AND level_id = NEW.level_id);
END;

CREATE TRIGGER classes_level_in_term_update BEFORE UPDATE OF academic_year_id, level_id ON classes
BEGIN
  SELECT RAISE(ABORT, 'that level is not in the term')
   WHERE NOT EXISTS (SELECT 1 FROM term_levels WHERE academic_year_id = NEW.academic_year_id AND level_id = NEW.level_id);
END;

-- How long a level usually runs, in months: fills in the next term's end date. Optional; set by the Admin.
ALTER TABLE levels ADD COLUMN usual_months INTEGER CHECK (usual_months IS NULL OR usual_months BETWEEN 1 AND 60);

-- Promotion writes only to the new term: the new enrollment names the one it came from, at most once.
ALTER TABLE enrollments ADD COLUMN previous_enrollment_id INTEGER REFERENCES enrollments (id);
CREATE UNIQUE INDEX enrollments_previous ON enrollments (previous_enrollment_id) WHERE previous_enrollment_id IS NOT NULL;

-- Teacher attendance is by date, not by term. With several terms, a day is locked only when every term covering it is
-- closed (and at least one does): a day inside an open term stays editable.
DROP TRIGGER teacher_attendance_rules_insert;
DROP TRIGGER teacher_attendance_rules_update;

CREATE TRIGGER teacher_attendance_rules_insert BEFORE INSERT ON teacher_attendance
BEGIN
  SELECT RAISE(ABORT, 'teacher attendance cannot be marked for a future day')
   WHERE NEW.on_date > date('now', '+345 minutes');
  SELECT RAISE(ABORT, 'a past day needs a reason')
   WHERE NEW.on_date < date('now', '+345 minutes') AND NEW.reason IS NULL;
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE EXISTS (SELECT 1 FROM academic_years WHERE status = 'closed' AND NEW.on_date BETWEEN start_date AND end_date)
     AND NOT EXISTS (SELECT 1 FROM academic_years WHERE status <> 'closed' AND NEW.on_date BETWEEN start_date AND end_date);
END;

CREATE TRIGGER teacher_attendance_rules_update BEFORE UPDATE ON teacher_attendance
BEGIN
  SELECT RAISE(ABORT, 'a day''s teacher and date never change')
   WHERE NEW.user_id <> OLD.user_id OR NEW.on_date <> OLD.on_date;
  SELECT RAISE(ABORT, 'a past day needs a reason')
   WHERE NEW.on_date < date('now', '+345 minutes') AND NEW.reason IS NULL;
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE EXISTS (SELECT 1 FROM academic_years WHERE status = 'closed' AND OLD.on_date BETWEEN start_date AND end_date)
     AND NOT EXISTS (SELECT 1 FROM academic_years WHERE status <> 'closed' AND OLD.on_date BETWEEN start_date AND end_date);
END;
