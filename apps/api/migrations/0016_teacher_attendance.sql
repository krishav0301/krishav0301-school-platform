-- Teacher attendance (Phase 5, slice 2, D-070). Marked by the Co-ordinator in a daily list pre-filled
-- Present; exceptions are Absent or On leave; past days stay editable with a reason recorded
-- (CLAUDE.md section 6, "Attendance"). The teacher sees their own month, read-only.
--
-- `on_date` is the AD calendar date in Nepal (UTC+5:45). The triggers hold the rules without the code
-- (D1 has no database accounts): no future day, a reason for any day but today, no change inside a
-- closed academic year, and nothing is ever deleted.

CREATE TABLE teacher_attendance (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  on_date TEXT NOT NULL CHECK (on_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'leave')),
  reason TEXT CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 300),
  marked_by_user_id INTEGER NOT NULL REFERENCES users (id),
  marked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, on_date)
);

CREATE INDEX teacher_attendance_day ON teacher_attendance (on_date);

CREATE TRIGGER teacher_attendance_rules_insert BEFORE INSERT ON teacher_attendance
BEGIN
  SELECT RAISE(ABORT, 'teacher attendance cannot be marked for a future day')
   WHERE NEW.on_date > date('now', '+345 minutes');
  SELECT RAISE(ABORT, 'a past day needs a reason')
   WHERE NEW.on_date < date('now', '+345 minutes') AND NEW.reason IS NULL;
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE EXISTS (SELECT 1 FROM academic_years WHERE status = 'closed' AND NEW.on_date BETWEEN start_date AND end_date);
END;

CREATE TRIGGER teacher_attendance_rules_update BEFORE UPDATE ON teacher_attendance
BEGIN
  SELECT RAISE(ABORT, 'a day''s teacher and date never change')
   WHERE NEW.user_id <> OLD.user_id OR NEW.on_date <> OLD.on_date;
  SELECT RAISE(ABORT, 'a past day needs a reason')
   WHERE NEW.on_date < date('now', '+345 minutes') AND NEW.reason IS NULL;
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE EXISTS (SELECT 1 FROM academic_years WHERE status = 'closed' AND OLD.on_date BETWEEN start_date AND end_date);
END;

CREATE TRIGGER teacher_attendance_no_delete BEFORE DELETE ON teacher_attendance
BEGIN
  SELECT RAISE(ABORT, 'attendance is never deleted');
END;
