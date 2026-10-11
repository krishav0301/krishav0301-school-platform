-- Whether the school's Admin (the Principal) must sign in with an authenticator app (D-138, the PM 2026-10-11). On for every
-- school: the first school's pack turns it off, so its Principal signs in with an ID and a password only. Support (the
-- Super Admin) always keeps the second step; this setting does not touch it.
ALTER TABLE school ADD COLUMN admin_two_factor INTEGER NOT NULL DEFAULT 1 CHECK (admin_two_factor IN (0, 1));
