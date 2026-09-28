-- Student attendance (Phase 5, slice 1, D-069). Once a day, by the class's Class Teacher, Present or
-- Absent only, same-day edits only, no in and out times (CLAUDE.md section 6, "Attendance"). Year data:
-- it hangs off the enrollment, never the student (D-006).
--
-- `on_date` is the AD calendar date in Nepal (UTC+5:45). The service only ever writes today's date; the
-- triggers below hold the same rule in the database, so a guard removed from the code still holds (D1 has
-- no database accounts). Nothing is ever deleted.

CREATE TABLE student_attendance (
  id INTEGER PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments (id),
  on_date TEXT NOT NULL CHECK (on_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  marked_by_user_id INTEGER NOT NULL REFERENCES users (id),
  marked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (enrollment_id, on_date)
);

-- A class's day, and a student's year, are the two reads.
CREATE INDEX student_attendance_day ON student_attendance (on_date);

-- Same day only: a row is made or changed only for today in Nepal.
CREATE TRIGGER student_attendance_today_insert BEFORE INSERT ON student_attendance
BEGIN
  SELECT RAISE(ABORT, 'attendance can only be marked for today')
   WHERE NEW.on_date <> date('now', '+345 minutes');
END;

CREATE TRIGGER student_attendance_today_update BEFORE UPDATE ON student_attendance
BEGIN
  SELECT RAISE(ABORT, 'attendance can only be changed on the same day')
   WHERE OLD.on_date <> date('now', '+345 minutes') OR NEW.on_date <> OLD.on_date OR NEW.enrollment_id <> OLD.enrollment_id;
END;

-- A closed year rejects every write.
CREATE TRIGGER student_attendance_year_open_insert BEFORE INSERT ON student_attendance
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
END;

CREATE TRIGGER student_attendance_year_open_update BEFORE UPDATE ON student_attendance
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = OLD.enrollment_id) = 'closed';
END;

-- No hard deletes.
CREATE TRIGGER student_attendance_no_delete BEFORE DELETE ON student_attendance
BEGIN
  SELECT RAISE(ABORT, 'attendance is never deleted');
END;
