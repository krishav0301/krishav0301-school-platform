-- Sessions and sign-in events (D-021).
--
-- A session holds only the HASH of its refresh token. The token itself lives in the user's
-- cookie, so a copy of this table cannot be used to sign in. Refresh tokens rotate on every use.
-- Deactivation and role changes take effect at the next refresh; money and approval actions
-- re-check the user's assignments inside their own batch.

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users (id),
  refresh_hash TEXT NOT NULL UNIQUE,
  previous_refresh_hash TEXT,              -- the token before the last rotation, to spot reuse
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,                -- absolute end of the session
  revoked_at TEXT,
  revoked_reason TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Every sign-in attempt that reaches a password check. It feeds the Sign-ins view for Admins and
-- the lockout rule. Append-only, like the audit log.
CREATE TABLE sign_in_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users (id),
  email_tried TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  reason TEXT,                             -- bad_password, unknown_user, inactive; NULL on success
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sign_in_events_email ON sign_in_events (email_tried, at);
CREATE INDEX sign_in_events_ip ON sign_in_events (ip, at);

CREATE TRIGGER sign_in_events_no_update BEFORE UPDATE ON sign_in_events
BEGIN SELECT RAISE(ABORT, 'sign-in log is append-only'); END;

CREATE TRIGGER sign_in_events_no_delete BEFORE DELETE ON sign_in_events
BEGIN SELECT RAISE(ABORT, 'sign-in log is append-only'); END;
