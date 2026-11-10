-- Attendance for a terminal's marks card (the PM, 2026-11-10, for the first school's GRADE-SHEET). The Class Teacher gives the
-- number of working days of the class for a terminal, then the days each student was present; the card prints the percentage.
-- Not a ledger and not a register: a count the teacher can correct, kept while the year is open, read when the card is shown
-- (as the student's name and roll number are), so it can be filled before or after the result is published.
CREATE TABLE term_attendance_days (
  terminal_id INTEGER NOT NULL REFERENCES terminals (id),
  class_id INTEGER NOT NULL REFERENCES classes (id),
  working_days INTEGER NOT NULL CHECK (typeof(working_days) = 'integer' AND working_days BETWEEN 1 AND 366),
  updated_by_user_id INTEGER NOT NULL REFERENCES users (id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (terminal_id, class_id)
) WITHOUT ROWID;

CREATE TABLE term_attendance (
  terminal_id INTEGER NOT NULL REFERENCES terminals (id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  days_present INTEGER NOT NULL CHECK (typeof(days_present) = 'integer' AND days_present BETWEEN 0 AND 366),
  updated_by_user_id INTEGER NOT NULL REFERENCES users (id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (terminal_id, enrollment_id)
) WITHOUT ROWID;

CREATE INDEX term_attendance_enrollment ON term_attendance (enrollment_id);

-- A closed year rejects writes, and a terminal belongs to the same year as the class it is counted for.
CREATE TRIGGER term_attendance_days_rules_insert BEFORE INSERT ON term_attendance_days
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
  SELECT RAISE(ABORT, 'that exam belongs to another year')
   WHERE (SELECT academic_year_id FROM terminals WHERE id = NEW.terminal_id) <> (SELECT academic_year_id FROM classes WHERE id = NEW.class_id);
END;

CREATE TRIGGER term_attendance_days_rules_update BEFORE UPDATE ON term_attendance_days
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
END;

CREATE TRIGGER term_attendance_rules_insert BEFORE INSERT ON term_attendance
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments e JOIN classes c ON c.id = e.class_id JOIN academic_years ay ON ay.id = c.academic_year_id WHERE e.id = NEW.enrollment_id) = 'closed';
  SELECT RAISE(ABORT, 'that exam belongs to another year')
   WHERE (SELECT academic_year_id FROM terminals WHERE id = NEW.terminal_id) <> (SELECT c.academic_year_id FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.id = NEW.enrollment_id);
END;

CREATE TRIGGER term_attendance_rules_update BEFORE UPDATE ON term_attendance
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments e JOIN classes c ON c.id = e.class_id JOIN academic_years ay ON ay.id = c.academic_year_id WHERE e.id = OLD.enrollment_id) = 'closed';
END;

CREATE TRIGGER term_attendance_rules_delete BEFORE DELETE ON term_attendance
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments e JOIN classes c ON c.id = e.class_id JOIN academic_years ay ON ay.id = c.academic_year_id WHERE e.id = OLD.enrollment_id) = 'closed';
END;
