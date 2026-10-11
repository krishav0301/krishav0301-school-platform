-- A student can be entered with just a name (the PM, 2026-10-10), so the first load of students is hassle free and the
-- rest is filled in later. What was required becomes optional, without ever storing "nothing" where a screen joins the
-- name into one text:
--   * last name, guardian name, guardian phone (and the application's phone) are text that may be empty ('');
--   * date of birth is the one that may be NULL. Only the admissions screens read it.
-- The first name is still required, and so is the level the student is placed in.
--
-- SQLite cannot relax a NOT NULL or a CHECK in place, so both tables are rebuilt the way 0030 and 0031 did: copy the
-- rows aside, drop the table, create it again under the same name, put the rows back with the same ids, with foreign keys
-- deferred until the commit. `students` is pointed at by `enrollments` and `applications` only; neither table has a
-- trigger. Rows keep every id and value they had. Apply to staging first, with a Time Travel bookmark taken.

PRAGMA defer_foreign_keys = true;

-- --- students -------------------------------------------------------------------------------------------------------
CREATE TABLE students_copy AS SELECT * FROM students;
DROP TABLE students;

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  sid TEXT NOT NULL UNIQUE,
  user_id INTEGER UNIQUE REFERENCES users (id),
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 60),
  middle_name TEXT CHECK (middle_name IS NULL OR length(middle_name) BETWEEN 1 AND 60),
  last_name TEXT NOT NULL DEFAULT '' CHECK (length(last_name) <= 60),
  dob_ad TEXT CHECK (dob_ad IS NULL OR dob_ad GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  phone TEXT,
  email TEXT COLLATE NOCASE,
  guardian_name TEXT NOT NULL DEFAULT '' CHECK (length(guardian_name) <= 120),
  guardian_phone TEXT NOT NULL DEFAULT '',
  previous_school TEXT,
  referred_by TEXT,
  admission_bs_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'graduated')),
  created_at TEXT NOT NULL
);

INSERT INTO students (id, public_id, sid, user_id, first_name, middle_name, last_name, dob_ad, phone, email, guardian_name, guardian_phone, previous_school, referred_by, admission_bs_year, status, created_at)
SELECT id, public_id, sid, user_id, first_name, middle_name, last_name, dob_ad, phone, email, guardian_name, guardian_phone, previous_school, referred_by, admission_bs_year, status, created_at FROM students_copy;
DROP TABLE students_copy;

CREATE INDEX students_name ON students (last_name, first_name, dob_ad);
CREATE INDEX students_phone ON students (phone) WHERE phone IS NOT NULL;
CREATE INDEX students_name_nocase ON students (last_name COLLATE NOCASE, first_name COLLATE NOCASE, dob_ad);

-- --- applications ---------------------------------------------------------------------------------------------------
CREATE TABLE applications_copy AS SELECT * FROM applications;
DROP TABLE applications;

CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  submission_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'email_unverified'
    CHECK (status IN ('email_unverified', 'pending_review', 'needs_changes', 'approved', 'rejected', 'expired')),
  walk_in INTEGER NOT NULL DEFAULT 0 CHECK (walk_in IN (0, 1)),
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 60),
  middle_name TEXT CHECK (middle_name IS NULL OR length(middle_name) BETWEEN 1 AND 60),
  last_name TEXT NOT NULL DEFAULT '' CHECK (length(last_name) <= 60),
  dob_ad TEXT CHECK (dob_ad IS NULL OR dob_ad GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL COLLATE NOCASE,
  guardian_name TEXT NOT NULL DEFAULT '' CHECK (length(guardian_name) <= 120),
  guardian_phone TEXT NOT NULL DEFAULT '',
  previous_school TEXT,
  referred_by TEXT,
  programme_id INTEGER NOT NULL REFERENCES programmes (id),
  level_id INTEGER NOT NULL REFERENCES levels (id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  verification_token_hash TEXT UNIQUE,
  verification_expires_at TEXT,
  email_verified_at TEXT,
  submitted_ip TEXT,
  duplicate_flags TEXT,
  changes_requested TEXT,
  decision_reason TEXT,
  reviewed_by INTEGER REFERENCES users (id),
  decided_at TEXT,
  student_id INTEGER REFERENCES students (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (level_id, programme_id) REFERENCES levels (id, programme_id)
);

INSERT INTO applications (id, public_id, submission_token, status, walk_in, first_name, middle_name, last_name, dob_ad, phone, email, guardian_name, guardian_phone, previous_school, referred_by,
                          programme_id, level_id, academic_year_id, verification_token_hash, verification_expires_at, email_verified_at, submitted_ip, duplicate_flags, changes_requested,
                          decision_reason, reviewed_by, decided_at, student_id, created_at, updated_at)
SELECT id, public_id, submission_token, status, walk_in, first_name, middle_name, last_name, dob_ad, phone, email, guardian_name, guardian_phone, previous_school, referred_by,
       programme_id, level_id, academic_year_id, verification_token_hash, verification_expires_at, email_verified_at, submitted_ip, duplicate_flags, changes_requested,
       decision_reason, reviewed_by, decided_at, student_id, created_at, updated_at FROM applications_copy;
DROP TABLE applications_copy;

CREATE INDEX applications_status ON applications (status, created_at);
CREATE INDEX applications_phone ON applications (phone);
CREATE INDEX applications_name_dob ON applications (last_name, first_name, dob_ad);
CREATE INDEX applications_name_nocase ON applications (last_name COLLATE NOCASE, first_name COLLATE NOCASE, dob_ad);
