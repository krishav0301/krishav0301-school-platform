-- The gate (D-175, slice 2 of tap attendance): the computers at the school gate, and every card tap they send.
--
-- 1. `gate_devices`: a gate computer holds a secret key, shown once when the Admin registers it; only a hash is stored.
--    Each device has its own system user (switched off, no role, no sign-in) so the attendance it marks says who marked
--    it ("Gate: Main gate"). A device is revoked, never deleted.
-- 2. `card_scans`: one row for every tap the server received, including unknown and retired cards and repeat taps. It is
--    insert-only. `client_scan_id` is made by the gate page for each tap, so a tap sent twice (a lost answer, a replay
--    from the queue kept while offline) is one row. `scanned_at` is when the card was tapped; `received_at` is when the
--    server heard of it. `on_date` is the Nepal day of the tap.

CREATE TABLE gate_devices (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 60),
  key_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  last_seen_at TEXT,
  revoked_at TEXT,
  revoked_by_user_id INTEGER REFERENCES users (id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL))
);

CREATE TRIGGER gate_devices_no_delete BEFORE DELETE ON gate_devices
BEGIN SELECT RAISE(ABORT, 'a gate device is revoked, never deleted'); END;

-- Only the last-seen time moves, and a device may be revoked once; nothing else changes and nothing is reactivated.
CREATE TRIGGER gate_devices_rules BEFORE UPDATE ON gate_devices
BEGIN
  SELECT RAISE(ABORT, 'a gate device only records when it was last seen, or is revoked')
   WHERE NEW.public_id <> OLD.public_id OR NEW.name <> OLD.name OR NEW.key_hash <> OLD.key_hash OR NEW.user_id <> OLD.user_id
      OR NEW.created_at <> OLD.created_at OR NEW.created_by_user_id <> OLD.created_by_user_id
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
