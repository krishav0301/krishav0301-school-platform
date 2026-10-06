-- The exam pattern (D-114): one per academic term, out of 100, replacing Phase 7's per-programme grading policy
-- (D-079) and the free per-subject mark components. The PM asked for the old system to be removed completely, and
-- the results entered under it (UAT test data only) to be cleared, so its tables are dropped and made again. This is
-- the one migration that is not backward compatible with the code before it; deploy the Worker with it.
--
-- The pattern: Grade system yes or no, the minimum % to pass theory and practical, the grade ranges when graded, and
-- the term's exams (terminals) with weights adding up to 100 and whether each holds the practical. A subject on a
-- level has its paper's full marks and, when it has a practical, the practical's share. Teachers enter marks out of
-- the paper; the result scales them to the terminal's weight. Pass or fail is decided on the final result only.

-- --- The old results, removed (children first: the database checks every reference) ------------------------------
DROP TABLE marks_cards;
DROP TABLE rechecks;
DROP TABLE marks;
DROP TABLE result_publications;
DROP TABLE mark_sheets;
DROP TABLE mark_components;
ALTER TABLE programmes DROP COLUMN grading_policy;

-- --- The pattern --------------------------------------------------------------------------------------------------
CREATE TABLE exam_patterns (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  academic_year_id INTEGER NOT NULL UNIQUE REFERENCES academic_years (id),
  graded INTEGER NOT NULL CHECK (graded IN (0, 1)),
  -- Whole percent: a subject passes when its theory and (where held) its practical reach these, over the whole term.
  theory_min_percent INTEGER NOT NULL CHECK (theory_min_percent BETWEEN 0 AND 100),
  practical_min_percent INTEGER NOT NULL CHECK (practical_min_percent BETWEEN 0 AND 100),
  -- When graded: [{"grade": "A+", "from": 90}, ...], highest first (checked by the service). NULL otherwise.
  grade_bands TEXT CHECK (grade_bands IS NULL OR json_valid(grade_bands)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((graded = 1) = (grade_bands IS NOT NULL))
);

CREATE TRIGGER exam_patterns_year_open_insert BEFORE INSERT ON exam_patterns
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

-- Locked once any mark sheet exists in the term: results already entered are never re-scaled.
CREATE TRIGGER exam_patterns_rules_update BEFORE UPDATE ON exam_patterns
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed';
  SELECT RAISE(ABORT, 'a pattern stays with its term') WHERE NEW.academic_year_id <> OLD.academic_year_id;
  SELECT RAISE(ABORT, 'the exam pattern is locked: marks have been entered')
   WHERE EXISTS (SELECT 1 FROM mark_sheets ms JOIN terminals t ON t.id = ms.terminal_id WHERE t.academic_year_id = OLD.academic_year_id);
END;

CREATE TRIGGER exam_patterns_no_delete BEFORE DELETE ON exam_patterns
BEGIN
  SELECT RAISE(ABORT, 'an exam pattern is never deleted');
END;

-- A terminal's weight (whole percent of the final result) and whether it holds the practical. NULL weight: made
-- before D-114, and not yet part of a pattern.
ALTER TABLE terminals ADD COLUMN weight INTEGER CHECK (weight IS NULL OR weight BETWEEN 1 AND 100);
ALTER TABLE terminals ADD COLUMN has_practical INTEGER NOT NULL DEFAULT 0 CHECK (has_practical IN (0, 1));

-- A terminal with marks keeps its weight, practical and place; one without may change or go (the pattern editor).
CREATE TRIGGER terminals_locked_update BEFORE UPDATE OF weight, has_practical, ordinal ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the exam pattern is locked: marks have been entered')
   WHERE EXISTS (SELECT 1 FROM mark_sheets ms JOIN terminals t ON t.id = ms.terminal_id WHERE t.academic_year_id = OLD.academic_year_id);
END;

-- --- A subject's paper ---------------------------------------------------------------------------------------------
-- Whole hundredths of a mark, as everywhere. `practical_hundredths` NULL: no practical. Theory is the rest.
ALTER TABLE subject_offerings ADD COLUMN full_marks_hundredths INTEGER NOT NULL DEFAULT 10000 CHECK (full_marks_hundredths BETWEEN 100 AND 100000);
ALTER TABLE subject_offerings ADD COLUMN practical_hundredths INTEGER CHECK (practical_hundredths IS NULL OR practical_hundredths >= 100);

CREATE TRIGGER subject_offerings_paper_insert BEFORE INSERT ON subject_offerings
BEGIN
  SELECT RAISE(ABORT, 'the practical must be less than the full marks')
   WHERE NEW.practical_hundredths IS NOT NULL AND NEW.practical_hundredths >= NEW.full_marks_hundredths;
END;

CREATE TRIGGER subject_offerings_paper_update BEFORE UPDATE OF full_marks_hundredths, practical_hundredths ON subject_offerings
BEGIN
  SELECT RAISE(ABORT, 'the practical must be less than the full marks')
   WHERE NEW.practical_hundredths IS NOT NULL AND NEW.practical_hundredths >= NEW.full_marks_hundredths;
END;

-- --- Mark sheets: one per class, subject and terminal ---------------------------------------------------------------
-- The paper's maxima are copied in when the sheet is made, so a later change to the subject never re-scales marks
-- already entered. `practical_max_hundredths` NULL: theory only (the terminal holds no practical, or the subject has none).
CREATE TABLE mark_sheets (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  terminal_id INTEGER NOT NULL REFERENCES terminals (id),
  theory_max_hundredths INTEGER NOT NULL CHECK (theory_max_hundredths >= 1),
  practical_max_hundredths INTEGER CHECK (practical_max_hundredths IS NULL OR practical_max_hundredths >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'under_review', 'verified', 'published')),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  submitted_by_user_id INTEGER REFERENCES users (id),
  submitted_at TEXT,
  verified_by_user_id INTEGER REFERENCES users (id),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (class_id, offering_id, terminal_id)
);

CREATE TRIGGER mark_sheets_year_open_insert BEFORE INSERT ON mark_sheets
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
  SELECT RAISE(ABORT, 'the terminal belongs to another academic year')
   WHERE (SELECT academic_year_id FROM terminals WHERE id = NEW.terminal_id) <> (SELECT academic_year_id FROM classes WHERE id = NEW.class_id);
  SELECT RAISE(ABORT, 'the term has no exam pattern')
   WHERE NOT EXISTS (SELECT 1 FROM exam_patterns p JOIN classes c ON c.academic_year_id = p.academic_year_id WHERE c.id = NEW.class_id)
      OR (SELECT weight FROM terminals WHERE id = NEW.terminal_id) IS NULL;
  SELECT RAISE(ABORT, 'a sheet starts as a draft') WHERE NEW.status <> 'draft';
END;

-- Draft -> Under review -> Verified -> Published; Under review or Verified may go back to Draft with a note.
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
           OR (OLD.status = 'verified' AND NEW.status IN ('draft', 'published')));
  SELECT RAISE(ABORT, 'a sheet sent back needs a note')
   WHERE OLD.status IN ('under_review', 'verified') AND NEW.status = 'draft' AND (NEW.note IS NULL OR length(trim(NEW.note)) = 0);
END;

CREATE TRIGGER mark_sheets_no_delete BEFORE DELETE ON mark_sheets
BEGIN
  SELECT RAISE(ABORT, 'mark sheets are never deleted');
END;

CREATE TRIGGER terminals_no_delete_with_sheets BEFORE DELETE ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the exam pattern is locked: marks have been entered')
   WHERE EXISTS (SELECT 1 FROM mark_sheets ms WHERE ms.terminal_id = OLD.id);
END;

-- A student's request to recheck one published subject of one terminal (source 6.9).
CREATE TABLE rechecks (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  sheet_id INTEGER NOT NULL REFERENCES mark_sheets (id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'changed', 'unchanged')),
  requested_at TEXT NOT NULL,
  decided_by_user_id INTEGER REFERENCES users (id),
  decided_at TEXT,
  decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  CHECK ((status = 'open') = (decided_at IS NULL)),
  CHECK (status = 'open' OR length(trim(decision_reason)) >= 3)
);

CREATE UNIQUE INDEX rechecks_one_open ON rechecks (enrollment_id, sheet_id) WHERE status = 'open';
CREATE INDEX rechecks_enrollment ON rechecks (enrollment_id);

CREATE TRIGGER rechecks_rules_insert BEFORE INSERT ON rechecks
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
  SELECT RAISE(ABORT, 'only a published result can be rechecked')
   WHERE (SELECT status FROM mark_sheets WHERE id = NEW.sheet_id) <> 'published';
  SELECT RAISE(ABORT, 'a recheck starts open') WHERE NEW.status <> 'open';
END;

CREATE TRIGGER rechecks_rules_update BEFORE UPDATE ON rechecks
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = OLD.enrollment_id) = 'closed';
  SELECT RAISE(ABORT, 'a recheck is decided once') WHERE OLD.status <> 'open';
  SELECT RAISE(ABORT, 'a recheck stays with its student and subject')
   WHERE NEW.enrollment_id <> OLD.enrollment_id OR NEW.sheet_id <> OLD.sheet_id OR NEW.reason <> OLD.reason;
END;

CREATE TRIGGER rechecks_no_delete BEFORE DELETE ON rechecks
BEGIN
  SELECT RAISE(ABORT, 'rechecks are never deleted');
END;

-- One mark per student, sheet and part (theory or practical). Null until entered; an absence is `absent` (it counts 0
-- in the result, OPEN: D-114's stated default), never a typed zero.
CREATE TABLE marks (
  id INTEGER PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES mark_sheets (id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  part TEXT NOT NULL CHECK (part IN ('theory', 'practical')),
  value_hundredths INTEGER CHECK (value_hundredths IS NULL OR (typeof(value_hundredths) = 'integer' AND value_hundredths >= 0)),
  absent INTEGER NOT NULL DEFAULT 0 CHECK (absent IN (0, 1)),
  updated_by_user_id INTEGER NOT NULL REFERENCES users (id),
  updated_at TEXT NOT NULL,
  CHECK (NOT (absent = 1 AND value_hundredths IS NOT NULL)),
  UNIQUE (sheet_id, enrollment_id, part)
);

CREATE TRIGGER marks_rules_insert BEFORE INSERT ON marks
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM mark_sheets ms JOIN classes c ON c.id = ms.class_id JOIN academic_years ay ON ay.id = c.academic_year_id WHERE ms.id = NEW.sheet_id) = 'closed';
  SELECT RAISE(ABORT, 'marks can only change on a draft sheet')
   WHERE (SELECT status FROM mark_sheets WHERE id = NEW.sheet_id) <> 'draft'
     AND NOT EXISTS (SELECT 1 FROM rechecks r WHERE r.sheet_id = NEW.sheet_id AND r.enrollment_id = NEW.enrollment_id AND r.status = 'open');
  SELECT RAISE(ABORT, 'this paper has no practical')
   WHERE NEW.part = 'practical' AND (SELECT practical_max_hundredths FROM mark_sheets WHERE id = NEW.sheet_id) IS NULL;
  SELECT RAISE(ABORT, 'a mark is above the maximum')
   WHERE NEW.value_hundredths > (SELECT CASE NEW.part WHEN 'theory' THEN theory_max_hundredths ELSE practical_max_hundredths END FROM mark_sheets WHERE id = NEW.sheet_id);
  SELECT RAISE(ABORT, 'the student is not in this class')
   WHERE (SELECT class_id FROM enrollments WHERE id = NEW.enrollment_id) <> (SELECT class_id FROM mark_sheets WHERE id = NEW.sheet_id);
END;

CREATE TRIGGER marks_rules_update BEFORE UPDATE ON marks
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM mark_sheets ms JOIN classes c ON c.id = ms.class_id JOIN academic_years ay ON ay.id = c.academic_year_id WHERE ms.id = OLD.sheet_id) = 'closed';
  SELECT RAISE(ABORT, 'marks can only change on a draft sheet')
   WHERE (SELECT status FROM mark_sheets WHERE id = OLD.sheet_id) <> 'draft'
     AND NOT EXISTS (SELECT 1 FROM rechecks r WHERE r.sheet_id = OLD.sheet_id AND r.enrollment_id = OLD.enrollment_id AND r.status = 'open');
  SELECT RAISE(ABORT, 'a mark stays with its sheet, student and part')
   WHERE NEW.sheet_id <> OLD.sheet_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.part <> OLD.part;
  SELECT RAISE(ABORT, 'a mark is above the maximum')
   WHERE NEW.value_hundredths > (SELECT CASE NEW.part WHEN 'theory' THEN theory_max_hundredths ELSE practical_max_hundredths END FROM mark_sheets WHERE id = NEW.sheet_id);
END;

CREATE TRIGGER marks_no_delete BEFORE DELETE ON marks
BEGIN
  SELECT RAISE(ABORT, 'marks are never deleted');
END;

-- A class's published result: one per terminal, and the final (terminal NULL), published automatically with the
-- class's last terminal. The pattern used that day is copied in.
CREATE TABLE result_publications (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  terminal_id INTEGER REFERENCES terminals (id),
  pattern TEXT NOT NULL CHECK (json_valid(pattern)),
  published_by_user_id INTEGER NOT NULL REFERENCES users (id),
  published_at TEXT NOT NULL,
  UNIQUE (class_id, terminal_id)
);

-- SQLite treats NULLs as distinct in a UNIQUE key, so the one final per class needs its own index.
CREATE UNIQUE INDEX result_publications_one_final ON result_publications (class_id) WHERE terminal_id IS NULL;
CREATE INDEX result_publications_terminal ON result_publications (terminal_id);

CREATE TRIGGER result_publications_rules BEFORE INSERT ON result_publications
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
END;

CREATE TRIGGER result_publications_no_update BEFORE UPDATE ON result_publications
BEGIN
  SELECT RAISE(ABORT, 'a publication never changes');
END;

CREATE TRIGGER result_publications_no_delete BEFORE DELETE ON result_publications
BEGIN
  SELECT RAISE(ABORT, 'a publication is never deleted');
END;

-- The marks card: a snapshot of one student's terminal or final result, never edited. A recheck that changes a mark
-- adds the next version (of the terminal's card, and of the final's when it exists) with its reason.
CREATE TABLE marks_cards (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  publication_id INTEGER NOT NULL REFERENCES result_publications (id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  percent_hundredths INTEGER NOT NULL CHECK (typeof(percent_hundredths) = 'integer'),
  -- Only a final result passes or fails; a terminal's card is for information (NULL).
  passed INTEGER CHECK (passed IS NULL OR passed IN (0, 1)),
  outcome TEXT NOT NULL CHECK (length(outcome) BETWEEN 1 AND 40),
  body TEXT NOT NULL CHECK (json_valid(body)),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  CHECK ((version = 1) = (reason IS NULL)),
  UNIQUE (publication_id, enrollment_id, version)
);

CREATE INDEX marks_cards_enrollment ON marks_cards (enrollment_id, publication_id);

CREATE TRIGGER marks_cards_rules BEFORE INSERT ON marks_cards
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
  SELECT RAISE(ABORT, 'a marks card version must follow the last one')
   WHERE NEW.version <> 1 + COALESCE((SELECT MAX(version) FROM marks_cards WHERE publication_id = NEW.publication_id AND enrollment_id = NEW.enrollment_id), 0);
END;

CREATE TRIGGER marks_cards_no_update BEFORE UPDATE ON marks_cards
BEGIN
  SELECT RAISE(ABORT, 'a marks card is a snapshot and never changes');
END;

CREATE TRIGGER marks_cards_no_delete BEFORE DELETE ON marks_cards
BEGIN
  SELECT RAISE(ABORT, 'a marks card is never deleted');
END;
