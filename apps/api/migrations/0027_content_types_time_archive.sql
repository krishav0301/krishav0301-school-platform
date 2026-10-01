-- Website content, redesigned to the PM's reference (D-098):
--   * two more kinds, Event and Information (Post keeps its key and reads "News" on screen; Routine stays);
--   * a time of day for "show from", Nepal time "HH:MM" (existing items get 00:00, so nothing that shows today stops);
--   * an Archived status: taken off the website and kept as a record, never deleted.
-- SQLite cannot change a CHECK in place, so the table is rebuilt with every row, column and rule it had,
-- and its index and holiday triggers (0025) are made again. Nothing references content_items by foreign key
-- (approvals keep a plain subject id, D-061), so the ids are kept as they were.

PRAGMA defer_foreign_keys = true;

CREATE TABLE content_items_new (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('notice', 'holiday', 'routine', 'vacancy', 'post', 'event', 'information')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  contact TEXT CHECK (contact IS NULL OR length(contact) BETWEEN 1 AND 200),
  is_urgent INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'waiting', 'live', 'archived')),
  publish_on TEXT NOT NULL CHECK (publish_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- The time of day it starts showing, by Nepal's clock, 24-hour "HH:MM".
  publish_time TEXT NOT NULL DEFAULT '00:00' CHECK (publish_time GLOB '[0-2][0-9]:[0-5][0-9]' AND publish_time < '24:00'),
  hide_after TEXT CHECK (hide_after IS NULL OR hide_after GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  published_by INTEGER REFERENCES users (id),
  version INTEGER NOT NULL DEFAULT 1,
  holiday_from TEXT CHECK (holiday_from IS NULL OR holiday_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  holiday_to TEXT CHECK (holiday_to IS NULL OR holiday_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  archived_at TEXT,
  archived_by INTEGER REFERENCES users (id),
  CHECK (kind <> 'vacancy' OR contact IS NOT NULL),
  CHECK (kind = 'vacancy' OR contact IS NULL),
  CHECK (hide_after IS NULL OR hide_after >= publish_on),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

INSERT INTO content_items_new
  (id, public_id, kind, title, body, contact, is_urgent, status, publish_on, publish_time, hide_after,
   created_by, created_at, updated_at, published_at, published_by, version, holiday_from, holiday_to)
SELECT id, public_id, kind, title, body, contact, is_urgent, status, publish_on, '00:00', hide_after,
       created_by, created_at, updated_at, published_at, published_by, version, holiday_from, holiday_to
  FROM content_items;

DROP TABLE content_items;
ALTER TABLE content_items_new RENAME TO content_items;

-- The public list: live items, by publish day.
CREATE INDEX content_items_public ON content_items (status, publish_on);
-- The Admin list: most recently touched first.
CREATE INDEX content_items_touched ON content_items (updated_at);

CREATE TRIGGER content_items_holiday_dates_insert
BEFORE INSERT ON content_items
WHEN (NEW.kind <> 'holiday' AND (NEW.holiday_from IS NOT NULL OR NEW.holiday_to IS NOT NULL))
  OR (NEW.holiday_to IS NOT NULL AND (NEW.holiday_from IS NULL OR NEW.holiday_to < NEW.holiday_from))
BEGIN
  SELECT RAISE(ABORT, 'holiday dates: only a holiday has them, and the last day is not before the first');
END;

CREATE TRIGGER content_items_holiday_dates_update
BEFORE UPDATE OF kind, holiday_from, holiday_to ON content_items
WHEN (NEW.kind <> 'holiday' AND (NEW.holiday_from IS NOT NULL OR NEW.holiday_to IS NOT NULL))
  OR (NEW.holiday_to IS NOT NULL AND (NEW.holiday_from IS NULL OR NEW.holiday_to < NEW.holiday_from))
BEGIN
  SELECT RAISE(ABORT, 'holiday dates: only a holiday has them, and the last day is not before the first');
END;
