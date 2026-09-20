-- Two-step sign-in with an authenticator app (D-033).
--
-- The secret behind the six-digit codes has to be readable by the server to check a code, so it is
-- stored SEALED (encrypted with a Worker secret): a copy of this table alone cannot produce codes.
-- A row with enabled_at NULL is a setup that has not been confirmed yet. last_used_step remembers
-- the newest time step already accepted, so a code cannot be used twice. Recovery codes are stored
-- only as hashes and each works once.

CREATE TABLE user_two_factor (
  user_id INTEGER PRIMARY KEY REFERENCES users (id),
  secret_sealed TEXT NOT NULL,
  created_at TEXT NOT NULL,
  enabled_at TEXT,
  last_used_step INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE two_factor_recovery_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT
);
CREATE INDEX two_factor_recovery_user ON two_factor_recovery_codes (user_id);
