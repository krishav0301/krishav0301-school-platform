-- A section can be switched off, like a programme or a level (D-097): it keeps its history, takes no new programmes,
-- and is no longer offered where a section is chosen. A section, programme or level with nothing attached may instead
-- be deleted; the service checks that, and the foreign keys refuse a delete that would leave anything pointing nowhere.
ALTER TABLE sections ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
