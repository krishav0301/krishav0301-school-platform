-- The words of the six fixed public pages (Phase 2, slice 3). One row: the school's `site` block from its
-- pack, as JSON. `npm run provision` writes it and only changes the row when the text changed, so
-- `updated_at` says when the words last changed. Nothing here is deleted. Additive: safe to migrate before
-- the code that reads it is deployed.

CREATE TABLE site_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  updated_at TEXT NOT NULL
);
