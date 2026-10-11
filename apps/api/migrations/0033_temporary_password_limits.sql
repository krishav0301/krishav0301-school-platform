-- A temporary password is now 4 digits (the PM, 2026-10-10), which is easy to guess, so it is limited instead: it
-- stops working 24 hours after it was issued, and after 3 wrong tries. A new one (Give a new password) clears both.
-- Backward compatible: older temporary passwords have no expiry and keep working until used.
ALTER TABLE users ADD COLUMN temporary_password_expires_at TEXT;
ALTER TABLE users ADD COLUMN temporary_password_failures INTEGER NOT NULL DEFAULT 0;
