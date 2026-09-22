-- Teaching (Phase 3, slice 3b, D-060): who teaches what, and each class's Class Teacher.
-- Nothing is deleted: reassigning a subject ends the old active row and starts a new one.

CREATE TABLE teacher_assignments (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  teacher_user_id INTEGER NOT NULL REFERENCES users (id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);

-- One active teacher per subject in a class. A past assignment stays, inactive, for history.
CREATE UNIQUE INDEX teacher_assignments_one_active ON teacher_assignments (class_id, offering_id) WHERE is_active = 1;

-- The offering must be the class's own level (mirrors the classes/levels composite check, which cannot be
-- expressed as a foreign key here because a class does not carry its level id alongside an offering id).
CREATE TRIGGER teacher_assignments_same_level BEFORE INSERT ON teacher_assignments
BEGIN
  SELECT RAISE(ABORT, 'the offering is not this class''s level')
   WHERE (SELECT level_id FROM classes WHERE id = NEW.class_id)
      <> (SELECT level_id FROM subject_offerings WHERE id = NEW.offering_id);
END;

CREATE TRIGGER teacher_assignments_year_open_insert BEFORE INSERT ON teacher_assignments
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
END;

CREATE TRIGGER teacher_assignments_year_open_update BEFORE UPDATE ON teacher_assignments
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
END;

ALTER TABLE classes ADD COLUMN class_teacher_user_id INTEGER REFERENCES users (id);

-- A teacher is Class Teacher of at most one class per academic year. The existing classes_year_open_update
-- trigger already blocks this column changing once the year is closed (it fires on any update to the row).
CREATE UNIQUE INDEX classes_one_class_teacher_per_year ON classes (academic_year_id, class_teacher_user_id)
  WHERE class_teacher_user_id IS NOT NULL;
