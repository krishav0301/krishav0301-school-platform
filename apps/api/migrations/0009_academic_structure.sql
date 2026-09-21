-- Academic structure (Phase 3, slice 1, D-056): years, programmes, levels, classes, terminals.
-- Ids shown to clients are public_id, never the integer. Dates are AD text, "YYYY-MM-DD".
-- Nothing here is deleted: rows are deactivated. A closed year rejects every write, and the triggers
-- below say so even if the service that normally checks it is bypassed (D1 has no database accounts).
-- Naming: a class's `label` (Morning, Evening) is not the institution's `sections` (+2, Bachelor's).

CREATE TABLE academic_years (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  bs_year INTEGER NOT NULL UNIQUE CHECK (bs_year BETWEEN 2000 AND 2100),
  label TEXT NOT NULL UNIQUE CHECK (length(label) BETWEEN 1 AND 40),
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK (end_date > start_date),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- At most one active year. Closing a year is Phase 8.
CREATE UNIQUE INDEX academic_years_one_active ON academic_years (status) WHERE status = 'active';

CREATE TRIGGER academic_years_closed_is_final BEFORE UPDATE ON academic_years
WHEN OLD.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed');
END;

CREATE TABLE programmes (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 60),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  section_id INTEGER NOT NULL REFERENCES sections (id),
  affiliation TEXT NOT NULL CHECK (length(affiliation) BETWEEN 1 AND 120),
  ordering INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE levels (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  programme_id INTEGER NOT NULL REFERENCES programmes (id),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (programme_id, ordinal),
  UNIQUE (id, programme_id)          -- lets a class point at a level and its programme together
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  programme_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 40),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  FOREIGN KEY (level_id, programme_id) REFERENCES levels (id, programme_id),
  UNIQUE (academic_year_id, level_id, label)
);

CREATE TABLE terminals (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 12),
  UNIQUE (academic_year_id, ordinal)
);

CREATE TRIGGER classes_year_open_insert BEFORE INSERT ON classes
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER classes_year_open_update BEFORE UPDATE ON classes
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed'
      OR (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER classes_year_open_delete BEFORE DELETE ON classes
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed';
END;

CREATE TRIGGER terminals_year_open_insert BEFORE INSERT ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER terminals_year_open_update BEFORE UPDATE ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed'
      OR (SELECT status FROM academic_years WHERE id = NEW.academic_year_id) = 'closed';
END;

CREATE TRIGGER terminals_year_open_delete BEFORE DELETE ON terminals
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed';
END;
