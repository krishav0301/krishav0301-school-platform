-- The gate (D-175, D-176; slice 2 and 3 of tap attendance): gate accounts and the computers signed in with them, every
-- card tap, and the day's end-of-day decision.
--
-- 1. `gate_accounts`: a login for the people at the gate: a special ID, a password and an authenticator app, made by the
--    Admin (the password and the authenticator's secret are shown once). Any number of computers sign in with it. The
--    password is stored as a hash and the authenticator's secret sealed. Each account has its own system user (switched
--    off, no role, no sign-in) so the attendance its computers mark says who marked it ("Main gate").
-- 2. `gate_devices`: one row per computer signed in. Signing in gives the computer a secret key (only its hash is kept)
--    that the gate page holds, so a computer keeps working through a lost connection. A computer is revoked, never
--    deleted; it stops working at once if it, or its account, is revoked or disabled.
-- 3. `card_scans`: one row for every tap the server received, including unknown and retired cards and repeat taps. It is
--    insert-only. `client_scan_id` is made by the gate page for each tap, so a tap sent twice (a lost answer, a replay
--    from the queue kept while offline) is one row. `scanned_at` is when the card was tapped; `received_at` is when the
--    server heard of it. `on_date` is the Nepal day of the tap.
-- 4. `attendance_days`: the end-of-day decision for students and for teachers, one row each per day, insert-only. A day on
--    which nearly everyone (98% or more) of a group has no Present mark is a holiday for that group: nobody is marked
--    Absent, and those who did tap keep their Present. Otherwise whoever has no mark is marked Absent.
-- 5. A system user for the marks the end-of-day job writes ("Automatic attendance").

CREATE TABLE gate_accounts (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  gate_id TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(gate_id) BETWEEN 4 AND 40 AND gate_id NOT GLOB '*[^a-zA-Z0-9._-]*'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 60),
  password_hash TEXT NOT NULL,
  secret_sealed TEXT NOT NULL,
  last_used_step INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  disabled_at TEXT,
  disabled_by_user_id INTEGER REFERENCES users (id),
  CHECK ((status = 'disabled') = (disabled_at IS NOT NULL AND disabled_by_user_id IS NOT NULL))
);

CREATE TRIGGER gate_accounts_no_delete BEFORE DELETE ON gate_accounts
BEGIN SELECT RAISE(ABORT, 'a gate account is disabled, never deleted'); END;

-- The password, the authenticator's secret and its last used step may change (a new login is issued; a code is spent), and
-- an account may be disabled once for good. Its ID, name and system user never change, and nothing is reactivated.
CREATE TRIGGER gate_accounts_rules BEFORE UPDATE ON gate_accounts
BEGIN
  SELECT RAISE(ABORT, 'a gate account keeps its ID, name and system user, and is never reactivated')
   WHERE NEW.public_id <> OLD.public_id OR NEW.gate_id <> OLD.gate_id OR NEW.name <> OLD.name OR NEW.user_id <> OLD.user_id
      OR NEW.created_at <> OLD.created_at OR NEW.created_by_user_id <> OLD.created_by_user_id
      OR (OLD.status = 'disabled' AND (NEW.status <> 'disabled' OR NEW.password_hash <> OLD.password_hash OR NEW.secret_sealed <> OLD.secret_sealed));
END;

CREATE TABLE gate_devices (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES gate_accounts (id),
  -- What the Admin sees to tell computers apart: the name the person typed, or the browser's own description.
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  revoked_by_user_id INTEGER REFERENCES users (id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX gate_devices_account ON gate_devices (account_id);

CREATE TRIGGER gate_devices_no_delete BEFORE DELETE ON gate_devices
BEGIN SELECT RAISE(ABORT, 'a gate computer is revoked, never deleted'); END;

-- Only the last-seen time moves, and a computer may be revoked once; nothing else changes and nothing is reactivated.
CREATE TRIGGER gate_devices_rules BEFORE UPDATE ON gate_devices
BEGIN
  SELECT RAISE(ABORT, 'a gate computer only records when it was last seen, or is revoked')
   WHERE NEW.public_id <> OLD.public_id OR NEW.account_id <> OLD.account_id OR NEW.label <> OLD.label OR NEW.key_hash <> OLD.key_hash
      OR NEW.created_at <> OLD.created_at
      OR (OLD.status = 'revoked' AND (NEW.status <> 'revoked' OR NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by_user_id IS NOT OLD.revoked_by_user_id));
END;

CREATE TABLE card_scans (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES gate_devices (id),
  client_scan_id TEXT NOT NULL CHECK (length(client_scan_id) BETWEEN 8 AND 64),
  card_number TEXT NOT NULL CHECK (length(card_number) BETWEEN 1 AND 100),
  card_id INTEGER REFERENCES rfid_cards (id),
  student_id INTEGER REFERENCES students (id),
  user_id INTEGER REFERENCES users (id),
  scanned_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  on_date TEXT NOT NULL CHECK (on_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- marked: first tap of the day, Present written. again: already tapped today. recorded: a known person, nothing to mark
  -- (other staff, no class this term, the module off, or a tap kept offline from an earlier day). no_school: the weekly
  -- holiday. unknown / retired / inactive: the card is not in use.
  result TEXT NOT NULL CHECK (result IN ('marked', 'again', 'recorded', 'no_school', 'unknown', 'retired', 'inactive')),
  CHECK (student_id IS NULL OR user_id IS NULL),
  UNIQUE (device_id, client_scan_id)
);

CREATE INDEX card_scans_student_day ON card_scans (student_id, on_date) WHERE student_id IS NOT NULL;
CREATE INDEX card_scans_user_day ON card_scans (user_id, on_date) WHERE user_id IS NOT NULL;
CREATE INDEX card_scans_day ON card_scans (on_date);

CREATE TRIGGER card_scans_no_update BEFORE UPDATE ON card_scans
BEGIN SELECT RAISE(ABORT, 'a scan is never changed'); END;
CREATE TRIGGER card_scans_no_delete BEFORE DELETE ON card_scans
BEGIN SELECT RAISE(ABORT, 'a scan is never deleted'); END;

CREATE TABLE attendance_days (
  id INTEGER PRIMARY KEY,
  on_date TEXT NOT NULL CHECK (on_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  subject TEXT NOT NULL CHECK (subject IN ('students', 'teachers')),
  -- school_day: those with no Present mark were marked Absent. holiday: 98% or more had none, so nobody was.
  status TEXT NOT NULL CHECK (status IN ('school_day', 'holiday')),
  -- How many were expected, and how many had a Present mark when the day was decided.
  expected INTEGER NOT NULL CHECK (expected >= 0),
  present INTEGER NOT NULL CHECK (present >= 0 AND present <= expected),
  decided_at TEXT NOT NULL,
  UNIQUE (on_date, subject)
);
CREATE TRIGGER attendance_days_no_update BEFORE UPDATE ON attendance_days
BEGIN SELECT RAISE(ABORT, 'a decided day is never changed'); END;
CREATE TRIGGER attendance_days_no_delete BEFORE DELETE ON attendance_days
BEGIN SELECT RAISE(ABORT, 'a decided day is never deleted'); END;

-- The user the end-of-day job writes its marks as. Switched off, no role, no password that works.
INSERT INTO users (public_id, email, password_hash, full_name, is_active)
VALUES (lower(hex(randomblob(16))), 'automatic-attendance@system.invalid', '!', 'Automatic attendance', 0);
