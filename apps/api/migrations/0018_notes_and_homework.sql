-- Notes, question papers and homework (Phase 5, slice 4, D-072). R2 is off (D-020), so everything here is text
-- and an optional https link; a file column arrives with R2 in a later migration. Year data hangs off the class
-- and the subject offering (notes, assignments) or the enrollment (submissions), never off a student.
-- Nothing is deleted: a note or an assignment is withdrawn. A closed year rejects every write.

-- A note or question paper: live at once; to replace one, withdraw it and share again (source 6.2, no versioning).
CREATE TABLE class_notes (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  kind TEXT NOT NULL CHECK (kind IN ('note', 'question_paper')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  body TEXT CHECK (body IS NULL OR length(body) BETWEEN 1 AND 5000),
  link TEXT CHECK (link IS NULL OR (link LIKE 'https://%' AND length(link) <= 500)),
  teacher_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_by_user_id INTEGER REFERENCES users (id),
  CHECK (body IS NOT NULL OR link IS NOT NULL),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_by_user_id IS NULL))
);
CREATE INDEX class_notes_class ON class_notes (class_id, created_at);

CREATE TRIGGER class_notes_year_open_insert BEFORE INSERT ON class_notes
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
END;

-- The only change a note ever takes is being withdrawn, once.
CREATE TRIGGER class_notes_withdraw_only BEFORE UPDATE ON class_notes
BEGIN
  SELECT RAISE(ABORT, 'a shared note cannot change; withdraw it and share again')
   WHERE OLD.withdrawn_at IS NOT NULL
      OR NEW.withdrawn_at IS NULL
      OR NEW.class_id <> OLD.class_id OR NEW.offering_id <> OLD.offering_id OR NEW.kind <> OLD.kind OR NEW.title <> OLD.title
      OR NEW.body IS NOT OLD.body OR NEW.link IS NOT OLD.link OR NEW.teacher_user_id <> OLD.teacher_user_id OR NEW.created_at <> OLD.created_at;
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
END;

CREATE TRIGGER class_notes_no_delete BEFORE DELETE ON class_notes
BEGIN
  SELECT RAISE(ABORT, 'notes are never deleted; withdraw one instead');
END;

-- Homework: deadline, instructions, optional marks (source 6.2). `due_at` is a UTC instant; screens enter and
-- show it as a BS date and a Nepal time.
CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  instructions TEXT NOT NULL CHECK (length(trim(instructions)) BETWEEN 1 AND 5000),
  link TEXT CHECK (link IS NULL OR (link LIKE 'https://%' AND length(link) <= 500)),
  due_at TEXT NOT NULL,
  max_marks INTEGER CHECK (max_marks IS NULL OR max_marks BETWEEN 1 AND 1000),
  teacher_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_by_user_id INTEGER REFERENCES users (id),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_by_user_id IS NULL))
);
CREATE INDEX assignments_class ON assignments (class_id, due_at);

CREATE TRIGGER assignments_year_open_insert BEFORE INSERT ON assignments
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
END;

CREATE TRIGGER assignments_withdraw_only BEFORE UPDATE ON assignments
BEGIN
  SELECT RAISE(ABORT, 'a set assignment cannot change; withdraw it and set it again')
   WHERE OLD.withdrawn_at IS NOT NULL
      OR NEW.withdrawn_at IS NULL
      OR NEW.class_id <> OLD.class_id OR NEW.offering_id <> OLD.offering_id OR NEW.title <> OLD.title OR NEW.instructions <> OLD.instructions
      OR NEW.link IS NOT OLD.link OR NEW.due_at <> OLD.due_at OR NEW.max_marks IS NOT OLD.max_marks OR NEW.teacher_user_id <> OLD.teacher_user_id;
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
END;

CREATE TRIGGER assignments_no_delete BEFORE DELETE ON assignments
BEGIN
  SELECT RAISE(ABORT, 'assignments are never deleted; withdraw one instead');
END;

-- One submission per student per assignment. Resubmission is request-then-approve (source 6.2): the student asks,
-- the teacher allows, the next submission replaces the text (the earlier text is kept in its audit entry).
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  assignment_id INTEGER NOT NULL REFERENCES assignments (id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 10000),
  submitted_at TEXT NOT NULL,
  is_late INTEGER NOT NULL CHECK (is_late IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'reviewed', 'resubmit_requested', 'resubmit_allowed')),
  marks INTEGER CHECK (marks IS NULL OR marks BETWEEN 0 AND 1000),
  feedback TEXT CHECK (feedback IS NULL OR length(feedback) <= 2000),
  reviewed_at TEXT,
  resubmit_reason TEXT CHECK (resubmit_reason IS NULL OR length(trim(resubmit_reason)) BETWEEN 1 AND 500),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL,
  UNIQUE (assignment_id, enrollment_id)
);

CREATE TRIGGER submissions_year_open_insert BEFORE INSERT ON submissions
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
END;

CREATE TRIGGER submissions_year_open_update BEFORE UPDATE ON submissions
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = OLD.enrollment_id) = 'closed';
  SELECT RAISE(ABORT, 'a submission''s assignment and student never change')
   WHERE NEW.assignment_id <> OLD.assignment_id OR NEW.enrollment_id <> OLD.enrollment_id;
  -- The text changes only through an allowed resubmission.
  SELECT RAISE(ABORT, 'a submission''s text changes only after a resubmission is allowed')
   WHERE NEW.body <> OLD.body AND OLD.status <> 'resubmit_allowed';
END;

CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions
BEGIN
  SELECT RAISE(ABORT, 'submissions are never deleted');
END;
