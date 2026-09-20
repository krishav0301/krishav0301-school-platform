-- School configuration: module switches, terminology overrides, themes.
-- The school row and sections come from 0001. Everything here is data, so a new school is a
-- new pack applied to a fresh database, never a code change (D-008).

-- Only explicit choices are stored. A module not listed here uses its default (on).
CREATE TABLE module_switches (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);

-- Only overrides are stored. Everything else uses the built-in English default.
CREATE TABLE terminology (
  key TEXT PRIMARY KEY,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 60)
);

-- Every saved theme is kept, and exactly one is active. Nothing is deleted.
CREATE TABLE themes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tokens_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX themes_one_active ON themes (is_active) WHERE is_active = 1;
