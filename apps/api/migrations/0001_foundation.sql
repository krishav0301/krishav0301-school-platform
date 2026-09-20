-- Foundation: school, sections, users, role assignments, audit log, outbox.
-- Timestamps are UTC text (ISO 8601). Ids exposed to clients are `public_id`, never the integer.

CREATE TABLE school (
  id INTEGER PRIMARY KEY CHECK (id = 1),               -- exactly one row per deployment
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NPR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kathmandu',
  template_key TEXT,
  region_pack TEXT NOT NULL DEFAULT 'nepal',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ordering INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A role assignment carries a scope (D-004). Impossible role and scope pairs are refused by the
-- database itself, so a bad row can never exist.
CREATE TABLE role_assignments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'coordinator', 'accountant', 'admin', 'super_admin')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('own', 'assigned', 'section', 'institution')),
  section_id INTEGER REFERENCES sections (id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((scope_type = 'section') = (section_id IS NOT NULL)),
  CHECK (
    (role = 'student' AND scope_type = 'own') OR
    (role = 'teacher' AND scope_type = 'assigned') OR
    (role IN ('coordinator', 'accountant') AND scope_type IN ('institution', 'section')) OR
    (role IN ('admin', 'super_admin') AND scope_type = 'institution')
  )
);
CREATE UNIQUE INDEX role_assignments_unique
  ON role_assignments (user_id, role, scope_type, COALESCE(section_id, 0));

-- Audit log: append-only and chained. Each row stores the hash of the previous row, and its own
-- hash over its contents plus that link. D1 has no database accounts, so a guard could be removed
-- by our own code; the chain makes any edit, insert or delete in the middle detectable, and a
-- daily export to a second place catches the tail (D-019).
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users (id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_public_id TEXT,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  request_id TEXT,
  prev_hash TEXT NOT NULL UNIQUE,   -- unique: a chain can never fork
  hash TEXT NOT NULL UNIQUE
);

CREATE TABLE audit_chain_head (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_id INTEGER NOT NULL,
  last_hash TEXT NOT NULL
);
INSERT INTO audit_chain_head (id, last_id, last_hash)
VALUES (1, 0, '0000000000000000000000000000000000000000000000000000000000000000');

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

-- A new entry must link to the current head. If another request appended first, this aborts the
-- whole batch (including the business change riding with it) and the caller retries.
CREATE TRIGGER audit_events_chain_check BEFORE INSERT ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit chain moved')
  WHERE NEW.prev_hash != (SELECT last_hash FROM audit_chain_head WHERE id = 1);
END;

CREATE TRIGGER audit_events_advance_head AFTER INSERT ON audit_events
BEGIN
  UPDATE audit_chain_head SET last_id = NEW.id, last_hash = NEW.hash WHERE id = 1;
END;

-- Outbox: written in the same batch as the change that needs a notification; a job drains it.
CREATE TABLE outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  processed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX outbox_unprocessed ON outbox_events (id) WHERE processed_at IS NULL;
