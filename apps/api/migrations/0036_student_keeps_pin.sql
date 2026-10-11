-- Whether a student keeps the 4-digit password they are given at admission (D-145, the PM 2026-10-11). Off for every school:
-- the password is temporary and must be changed at first sign-in. The first school's file turns it on, so its students
-- sign in with their email and a PIN they keep, and see their results.
ALTER TABLE school ADD COLUMN student_keeps_pin INTEGER NOT NULL DEFAULT 0 CHECK (student_keeps_pin IN (0, 1));
