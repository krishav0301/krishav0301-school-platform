-- Subjects (Phase 3, slice 2, D-058): the school's catalogue, what each programme level teaches, mark
-- components, and elective groups. Ids shown to clients are public_id, never the integer.
-- Marks and credit hours are WHOLE HUNDREDTHS (375 means 3.75), never floats.
-- Nothing here is deleted: subjects are archived, everything else is switched off.
-- Offerings hang off a programme LEVEL, not a class: a class inherits its level's subjects, so a new
-- year does not mean entering them again.

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 120),
  code TEXT CHECK (code IS NULL OR length(code) BETWEEN 1 AND 20),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1))
);
-- A code is unique when there is one; several subjects may have none.
CREATE UNIQUE INDEX subjects_code_unique ON subjects (code COLLATE NOCASE) WHERE code IS NOT NULL;

-- "Pick one of Biology, Mathematics, Computer Science" (approved 2026-09-21). A student's own pick is
-- saved when students exist (Phase 4); only the groups are stored here.
CREATE TABLE elective_groups (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  level_id INTEGER NOT NULL REFERENCES levels (id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  pick_count INTEGER NOT NULL DEFAULT 1 CHECK (pick_count BETWEEN 1 AND 10),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (level_id, name),
  UNIQUE (id, level_id)              -- lets an offering point at a group and its level together
);

CREATE TABLE subject_offerings (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  level_id INTEGER NOT NULL REFERENCES levels (id),
  subject_id INTEGER NOT NULL REFERENCES subjects (id),
  credit_hundredths INTEGER CHECK (credit_hundredths IS NULL OR credit_hundredths BETWEEN 1 AND 10000),
  elective_group_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (level_id, subject_id),
  -- With no group (NULL) SQLite does not check this; with one, the group must belong to the same level.
  FOREIGN KEY (elective_group_id, level_id) REFERENCES elective_groups (id, level_id)
);

CREATE TABLE mark_components (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  offering_id INTEGER NOT NULL REFERENCES subject_offerings (id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  max_hundredths INTEGER NOT NULL CHECK (max_hundredths BETWEEN 1 AND 100000),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 10),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (offering_id, name),
  UNIQUE (offering_id, ordinal)
);
