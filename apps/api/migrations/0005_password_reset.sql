-- Password reset (D-035).
--
-- Like a session, a reset token is stored only as its SHA-256 hash: the token itself is in the
-- email link, so a copy of this table cannot be used to take over an account. A token works once
-- and expires an hour after it is made. The created-at and address columns feed the rate limits
-- that stop someone using the reset form to flood an inbox.

CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip TEXT
);
CREATE INDEX password_resets_user ON password_resets (user_id, created_at);
CREATE INDEX password_resets_ip ON password_resets (ip, created_at);
