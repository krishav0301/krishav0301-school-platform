-- Phase 7: results (D-079 to D-083). CLAUDE.md section 6, "Marks and results": marks per component in a bulk grid,
-- editable by the teacher until the Co-ordinator verifies; Draft, Under review, Verified, Published; a whole class
-- publishes per terminal, only when every subject is verified; a per-programme grading policy, and a class with no
-- policy cannot be published; a policy change affects only unpublished results; published marks cards are
-- snapshots; a recheck lets the Co-ordinator edit and republish, with a reason. Year data hangs off the enrollment
-- or the class, never the student. Nothing here is ever deleted.

-- The programme's grading policy (the extension point; the code in `modules/results/grading.ts`). NULL: none, so
-- none of its classes can be published.
ALTER TABLE programmes ADD COLUMN grading_policy TEXT CHECK (grading_policy IS NULL OR grading_policy IN ('neb_gpa', 'percentage_division'));

-- Whether a mark component is theory or practical (an internal assessment counts as practical): NEB's pass rule
-- differs between them (35% and 40%, OPEN until verified).
ALTER TABLE mark_components ADD COLUMN kind TEXT NOT NULL DEFAULT 'theory' CHECK (kind IN ('theory', 'practical'));

-- A student's pick from an elective group (D-056), for one year: the marks grid of an elective subject lists only
-- the students who picked it. Changed by switching a row off and another on, never by deleting.
CREATE TABLE elective_picks (
  id INTEGER PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE (enrollment_id, offering_id)
);

CREATE TRIGGER elective_picks_year_open_insert BEFORE INSERT ON elective_picks
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
END;

CREATE TRIGGER elective_picks_year_open_update BEFORE UPDATE ON elective_picks
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = OLD.enrollment_id) = 'closed';
  SELECT RAISE(ABORT, 'a pick only switches on or off')
   WHERE NEW.enrollment_id <> OLD.enrollment_id OR NEW.offering_id <> OLD.offering_id;
END;

CREATE TRIGGER elective_picks_no_delete BEFORE DELETE ON elective_picks
BEGIN
  SELECT RAISE(ABORT, 'elective picks are never deleted');
END;

-- One sheet per class, subject and terminal: the unit a teacher submits and the Co-ordinator verifies.
CREATE TABLE mark_sheets (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  terminal_id INTEGER NOT NULL REFERENCES terminals (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'under_review', 'verified', 'published')),
  -- The Co-ordinator's note when sending it back.
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
  SELECT RAISE(ABORT, 'a sheet starts as a draft') WHERE NEW.status <> 'draft';
END;

-- Draft -> Under review -> Verified -> Published; Under review or Verified may go back to Draft with a note (a student
-- who joined late needs marks on a verified sheet). Nothing else; nothing after Published.
CREATE TRIGGER mark_sheets_rules BEFORE UPDATE ON mark_sheets
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
  SELECT RAISE(ABORT, 'a sheet stays with its class, subject and terminal')
   WHERE NEW.class_id <> OLD.class_id OR NEW.offering_id <> OLD.offering_id OR NEW.terminal_id <> OLD.terminal_id;
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

-- A student's request to recheck one published subject (source 6.9). Open until the Co-ordinator decides: changed
-- (marks edited, the next card version made) or unchanged; both with a reason.
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

-- One mark per student and component on a sheet. Null until entered; an absence is `absent`, never a zero.
CREATE TABLE marks (
  id INTEGER PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES mark_sheets (id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  component_id INTEGER NOT NULL REFERENCES mark_components (id),
  value_hundredths INTEGER CHECK (value_hundredths IS NULL OR (typeof(value_hundredths) = 'integer' AND value_hundredths >= 0)),
  absent INTEGER NOT NULL DEFAULT 0 CHECK (absent IN (0, 1)),
  updated_by_user_id INTEGER NOT NULL REFERENCES users (id),
  updated_at TEXT NOT NULL,
  CHECK (NOT (absent = 1 AND value_hundredths IS NOT NULL)),
  UNIQUE (sheet_id, enrollment_id, component_id)
);

-- A mark changes only on a draft sheet, or on a published one while that student has an open recheck of it.
CREATE TRIGGER marks_rules_insert BEFORE INSERT ON marks
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM mark_sheets ms JOIN classes c ON c.id = ms.class_id JOIN academic_years ay ON ay.id = c.academic_year_id WHERE ms.id = NEW.sheet_id) = 'closed';
  SELECT RAISE(ABORT, 'marks can only change on a draft sheet')
   WHERE (SELECT status FROM mark_sheets WHERE id = NEW.sheet_id) <> 'draft'
     AND NOT EXISTS (SELECT 1 FROM rechecks r WHERE r.sheet_id = NEW.sheet_id AND r.enrollment_id = NEW.enrollment_id AND r.status = 'open');
  SELECT RAISE(ABORT, 'a mark is above the maximum')
   WHERE NEW.value_hundredths > (SELECT max_hundredths FROM mark_components WHERE id = NEW.component_id);
  SELECT RAISE(ABORT, 'the component belongs to another subject')
   WHERE (SELECT offering_id FROM mark_components WHERE id = NEW.component_id) <> (SELECT offering_id FROM mark_sheets WHERE id = NEW.sheet_id);
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
  SELECT RAISE(ABORT, 'a mark stays with its sheet, student and component')
   WHERE NEW.sheet_id <> OLD.sheet_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.component_id <> OLD.component_id;
  SELECT RAISE(ABORT, 'a mark is above the maximum')
   WHERE NEW.value_hundredths > (SELECT max_hundredths FROM mark_components WHERE id = NEW.component_id);
END;

CREATE TRIGGER marks_no_delete BEFORE DELETE ON marks
BEGIN
  SELECT RAISE(ABORT, 'marks are never deleted');
END;

-- A class's results for a terminal, published once, with the grading policy used that day.
CREATE TABLE result_publications (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  terminal_id INTEGER NOT NULL REFERENCES terminals (id),
  grading_policy TEXT NOT NULL CHECK (grading_policy IN ('neb_gpa', 'percentage_division')),
  published_by_user_id INTEGER NOT NULL REFERENCES users (id),
  published_at TEXT NOT NULL,
  UNIQUE (class_id, terminal_id)
);

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

-- The marks card: a snapshot of one student's result as published (names, subjects, marks, grades), never edited.
-- A recheck that changes a mark adds the next version with its reason; the highest version is the current card.
CREATE TABLE marks_cards (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  publication_id INTEGER NOT NULL REFERENCES result_publications (id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  gpa_hundredths INTEGER CHECK (gpa_hundredths IS NULL OR typeof(gpa_hundredths) = 'integer'),
  percent_hundredths INTEGER CHECK (percent_hundredths IS NULL OR typeof(percent_hundredths) = 'integer'),
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
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
