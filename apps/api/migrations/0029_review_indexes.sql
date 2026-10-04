-- Indexes for the reads every day relies on (D-108, the code review of 2026-10-04). Each was found by running SQLite's own
-- query planner over every statement the Worker prepared while the whole Co-ordinator FUT, the Teacher, Student and
-- Accountant click-through and every list endpoint ran on a fresh school; each named a full scan of a table that grows
-- with the school, and D1 bills every row a query reads (5,000,000 a day on the free plan).

-- A class's students: every register, mark sheet, homework list, dues list, charge run and class count. Without it each
-- read scanned every enrollment of every year, once per class.
CREATE INDEX enrollments_class ON enrollments (class_id, status);
-- The active year's students: the dues list, the fees and attendance dashboards.
CREATE INDEX enrollments_year ON enrollments (academic_year_id, status);
-- A teacher's own subjects: their home, mark sheets, activity log, notes and homework.
CREATE INDEX teacher_assignments_teacher ON teacher_assignments (teacher_user_id, is_active);
-- Everyone with a role (the teachers' list, staff counts) without reading every student's login.
CREATE INDEX role_assignments_role ON role_assignments (role, is_active, user_id);
-- The duplicate check compares names without regard to case, which the case-sensitive name indexes cannot serve.
CREATE INDEX students_name_nocase ON students (last_name COLLATE NOCASE, first_name COLLATE NOCASE, dob_ad);
CREATE INDEX applications_name_nocase ON applications (last_name COLLATE NOCASE, first_name COLLATE NOCASE, dob_ad);
-- A refresh with an old token (two tabs racing, or theft detection) looks the session up by the token before.
CREATE INDEX sessions_previous_refresh ON sessions (previous_refresh_hash) WHERE previous_refresh_hash IS NOT NULL;
-- A student's own rechecks.
CREATE INDEX rechecks_enrollment ON rechecks (enrollment_id);
-- The failed sign-ins only (the Sign-ins page's filter).
CREATE INDEX sign_in_events_failed ON sign_in_events (id) WHERE success = 0;
-- A terminal's publications: the Top 20 read every marks card of every year without it.
CREATE INDEX result_publications_terminal ON result_publications (terminal_id);

-- The outbox sweep now reads `next_attempt_at` alone, so its partial index serves it. Every event is queued with it set;
-- this covers any row from before that was not.
UPDATE outbox_events SET next_attempt_at = at WHERE next_attempt_at IS NULL;
