-- Website content (Phase 2, D-039): Notice, Holiday, Routine, Vacancy and Post.
-- Dates are AD calendar days by Nepal's clock ("YYYY-MM-DD"), so the day changes at Nepal midnight.
-- Nothing here is deleted: taking an item down returns it to a draft. "Expired" is not stored; an
-- item stops showing after its hide-after day, so nothing depends on a job having run.
-- Images and files are not modelled yet (R2 is held, D-020); they are added by a later migration.

CREATE TABLE content_items (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('notice', 'holiday', 'routine', 'vacancy', 'post')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  -- A vacancy shows an email or phone to contact; there is no application system in V1.
  contact TEXT CHECK (contact IS NULL OR length(contact) BETWEEN 1 AND 200),
  is_urgent INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0, 1)),
  -- 'waiting' is used when Co-ordinator drafts need approval (Phase 3); Phase 2 uses draft and live.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'waiting', 'live')),
  publish_on TEXT NOT NULL CHECK (publish_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  hide_after TEXT CHECK (hide_after IS NULL OR hide_after GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  published_by INTEGER REFERENCES users (id),
  CHECK (kind <> 'vacancy' OR contact IS NOT NULL),
  CHECK (kind = 'vacancy' OR contact IS NULL),
  CHECK (hide_after IS NULL OR hide_after >= publish_on)
);

-- The public list: live items, by publish day.
CREATE INDEX content_items_public ON content_items (status, publish_on);
