-- Admissions and the student record (Phase 4, D-063). Ids shown to clients are `public_id`, never
-- the integer. Dates are AD text (`YYYY-MM-DD`); screens accept and show BS through the date module.
-- No hard deletes anywhere here: a resolved application keeps its row, and a student is deactivated
-- (`status`), never removed.

-- One row, the whole institution's SID sequence (D-021: SID = admission BS year + sequence, for
-- example 2083-00123, assigned at approval, incremented in the same batch as the student is made).
CREATE TABLE sid_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_sequence INTEGER NOT NULL DEFAULT 1
);
INSERT INTO sid_counter (id, next_sequence) VALUES (1, 1);

-- The permanent record. Year data (attendance, marks, fees, receipts) never lives here (D-006):
-- it hangs off `enrollments`. The SID never changes once assigned.
CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  sid TEXT NOT NULL UNIQUE,
  user_id INTEGER UNIQUE REFERENCES users (id),
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 60),
  middle_name TEXT CHECK (middle_name IS NULL OR length(middle_name) BETWEEN 1 AND 60),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 60),
  dob_ad TEXT NOT NULL CHECK (dob_ad GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  phone TEXT,
  email TEXT COLLATE NOCASE,
  guardian_name TEXT NOT NULL CHECK (length(guardian_name) BETWEEN 1 AND 120),
  guardian_phone TEXT NOT NULL,
  previous_school TEXT,
  referred_by TEXT,
  admission_bs_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'graduated')),
  created_at TEXT NOT NULL
);
CREATE INDEX students_name ON students (last_name, first_name, dob_ad);
CREATE INDEX students_phone ON students (phone) WHERE phone IS NOT NULL;

-- The yearly fact. Unique per student and year: a student has exactly one class per year.
CREATE TABLE enrollments (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students (id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  class_id INTEGER NOT NULL REFERENCES classes (id),
  roll_no INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'promoted', 'repeated', 'left', 'graduated')),
  created_at TEXT NOT NULL,
  UNIQUE (student_id, academic_year_id)
);

-- One row per application, public or staff-entered, from first submission to a final decision.
-- `submission_token` is the client's own idempotency key (a repeat with the same token changes
-- nothing new); it is null for a walk-in or a registration a staff member typed in themselves,
-- since only the public form can be resubmitted by accident. A composite foreign key ties the level
-- to its own programme, the same guard `classes` already has (D-057).
CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  submission_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'email_unverified'
    CHECK (status IN ('email_unverified', 'pending_review', 'needs_changes', 'approved', 'rejected', 'expired')),
  walk_in INTEGER NOT NULL DEFAULT 0 CHECK (walk_in IN (0, 1)),
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 60),
  middle_name TEXT CHECK (middle_name IS NULL OR length(middle_name) BETWEEN 1 AND 60),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 60),
  dob_ad TEXT NOT NULL CHECK (dob_ad GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  phone TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  guardian_name TEXT NOT NULL CHECK (length(guardian_name) BETWEEN 1 AND 120),
  guardian_phone TEXT NOT NULL,
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
CREATE INDEX applications_status ON applications (status, created_at);
CREATE INDEX applications_phone ON applications (phone);
CREATE INDEX applications_name_dob ON applications (last_name, first_name, dob_ad);

-- A submission-rate window: every accepted public submission leaves one row, whether or not it
-- goes on to verify. Old rows are harmless to keep (no personal data beyond the address itself,
-- already on the application), and cheap to scan for a short recent window.
CREATE TABLE application_submission_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ip TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE
);
CREATE INDEX application_submission_events_ip ON application_submission_events (ip, at);
CREATE INDEX application_submission_events_email ON application_submission_events (email, at);
