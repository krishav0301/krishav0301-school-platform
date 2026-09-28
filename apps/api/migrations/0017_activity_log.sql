-- The daily activity log (Phase 5, slice 3, D-071). One entry per class, subject and Nepal day, written by the
-- subject's teacher and read by the class's students and parents (source 6.2: "mandatory per class per day,
-- visible to students and parents, with a reminder if skipped"). Editable the same day only; never deleted.
-- It hangs off the class and the subject offering (year data through the class), never off a student.

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  on_date TEXT NOT NULL CHECK (on_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  teacher_user_id INTEGER NOT NULL REFERENCES users (id),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (class_id, offering_id, on_date)
);

CREATE INDEX activity_log_day ON activity_log (on_date, class_id);

CREATE TRIGGER activity_log_today_insert BEFORE INSERT ON activity_log
BEGIN
  SELECT RAISE(ABORT, 'the activity log can only be written for today')
   WHERE NEW.on_date <> date('now', '+345 minutes');
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = NEW.class_id) = 'closed';
END;

CREATE TRIGGER activity_log_today_update BEFORE UPDATE ON activity_log
BEGIN
  SELECT RAISE(ABORT, 'the activity log can only be changed on the same day')
   WHERE OLD.on_date <> date('now', '+345 minutes') OR NEW.on_date <> OLD.on_date OR NEW.class_id <> OLD.class_id OR NEW.offering_id <> OLD.offering_id;
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = OLD.class_id) = 'closed';
END;

CREATE TRIGGER activity_log_no_delete BEFORE DELETE ON activity_log
BEGIN
  SELECT RAISE(ABORT, 'the activity log is never deleted');
END;
