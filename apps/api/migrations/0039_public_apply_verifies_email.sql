-- D-168: a school may take public applications without an email link. On (1) unless its pack says otherwise.
ALTER TABLE school ADD COLUMN public_apply_verifies_email INTEGER NOT NULL DEFAULT 1 CHECK (public_apply_verifies_email IN (0, 1));
