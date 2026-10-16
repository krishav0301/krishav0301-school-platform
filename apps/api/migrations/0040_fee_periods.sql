-- Fee structures as period price lists, linked to levels (D-172, `docs/superpowers/specs/2026-10-17-fee-structures-design.md`).
--
-- Until now a fee structure belonged to one level in one term. Now a structure is a priced list (its lines are the
-- existing `fee_items`) with a name, a wing, a start and an end date. Several levels can be linked to it, and a level
-- keeps a link for as long as the structure's dates run. An approved structure is fixed; editing it makes a new
-- version (a row that `replaces` the live one and shares its `root`), and the live version stays in force until the new
-- one is approved. The chain of versions is the "period"; a row with no `root_id` is the chain's first version.
--
-- The table is rebuilt the way 0030 and 0031 rebuilt theirs on D1: copy the rows aside, drop it, create it again under
-- the same name, put the rows back with the same ids (so every `fee_items.structure_id` still points at its structure),
-- with foreign keys deferred until the commit. `fee_items` and the ledger, which points at it, are not touched: no
-- charge, payment or chain link changes.
--
-- Each existing structure becomes a named structure of its term's dates in its level's wing. A live one is linked to the
-- level it was made for, so a student admitted later is charged as the old "generate charges" would have charged them
-- (the items keep their frequency, and the billing policy still reads it). Nothing is charged twice: the ledger's own
-- unique index allows one charge per student, item and period.

PRAGMA defer_foreign_keys = true;

CREATE TABLE fee_structures_copy AS SELECT * FROM fee_structures;
DROP TABLE fee_structures;

CREATE TABLE fee_structures (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  -- The wing it is for: a structure is linked only to levels of its own wing, and an Accountant of one wing sees only its own.
  section_id INTEGER NOT NULL REFERENCES sections (id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'waiting', 'live', 'superseded')),
  -- Bumped by every change to its items, so a pending approval goes stale.
  version INTEGER NOT NULL DEFAULT 1,
  -- The chain this version belongs to: the first version's id, or NULL on the first version itself.
  root_id INTEGER REFERENCES fee_structures (id),
  replaces_id INTEGER REFERENCES fee_structures (id),
  created_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  live_at TEXT,
  CHECK (end_date > start_date),
  CHECK ((status IN ('live', 'superseded')) = (live_at IS NOT NULL))
);

INSERT INTO fee_structures (id, public_id, section_id, name, start_date, end_date, status, version, created_by_user_id, created_at, live_at)
SELECT c.id, c.public_id, pv.section_id, pv.name || ' ' || lv.name || ' · ' || ay.label, ay.start_date, ay.end_date, c.status, c.version, c.created_by_user_id, c.created_at, c.live_at
  FROM fee_structures_copy c JOIN levels lv ON lv.id = c.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN academic_years ay ON ay.id = c.academic_year_id;

-- At most one live version, and at most one version being drafted or waiting, in a chain.
CREATE UNIQUE INDEX fee_structures_one_live ON fee_structures (COALESCE(root_id, id)) WHERE status = 'live';
CREATE UNIQUE INDEX fee_structures_one_open ON fee_structures (COALESCE(root_id, id)) WHERE status IN ('draft', 'waiting');
-- A name is used once for a start date in a wing (the same name serves the next year's period).
CREATE UNIQUE INDEX fee_structures_name ON fee_structures (section_id, name COLLATE NOCASE, start_date) WHERE root_id IS NULL;
CREATE INDEX fee_structures_root ON fee_structures (root_id);

-- Which levels use a structure. A level can have several over time, never two whose dates overlap.
CREATE TABLE level_fee_structures (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES levels (id),
  -- The chain's first version (a link follows the chain, so a new live version is used at once).
  root_id INTEGER NOT NULL REFERENCES fee_structures (id),
  linked_by_user_id INTEGER NOT NULL REFERENCES users (id),
  linked_at TEXT NOT NULL,
  UNIQUE (level_id, root_id)
);
CREATE INDEX level_fee_structures_root ON level_fee_structures (root_id);

INSERT INTO level_fee_structures (level_id, root_id, linked_by_user_id, linked_at)
SELECT c.level_id, c.id, c.created_by_user_id, COALESCE(c.live_at, c.created_at) FROM fee_structures_copy c WHERE c.status = 'live';

DROP TABLE fee_structures_copy;

-- Rules ---------------------------------------------------------------------------------------------------------------

-- What is not a draft is fixed; a live version only becomes superseded; a superseded one is final; nothing is deleted.
CREATE TRIGGER fee_structures_rules BEFORE UPDATE ON fee_structures
BEGIN
  SELECT RAISE(ABORT, 'a fee structure that is not a draft is fixed')
   WHERE OLD.status <> 'draft' AND (NEW.name <> OLD.name OR NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date OR NEW.section_id <> OLD.section_id
                                    OR NEW.root_id IS NOT OLD.root_id OR NEW.replaces_id IS NOT OLD.replaces_id);
  SELECT RAISE(ABORT, 'a live fee structure can only be superseded')
   WHERE OLD.status = 'live' AND NEW.status NOT IN ('live', 'superseded');
  SELECT RAISE(ABORT, 'a superseded fee structure is final')
   WHERE OLD.status = 'superseded' AND NEW.status <> 'superseded';
END;
CREATE TRIGGER fee_structures_no_delete BEFORE DELETE ON fee_structures
BEGIN SELECT RAISE(ABORT, 'fee structures are never deleted'); END;

-- A link needs a live structure of the level's own wing, and no other link of the level whose dates overlap.
CREATE TRIGGER level_fee_structures_make BEFORE INSERT ON level_fee_structures
BEGIN
  SELECT RAISE(ABORT, 'only a live fee structure can be linked')
   WHERE NOT EXISTS (SELECT 1 FROM fee_structures v WHERE COALESCE(v.root_id, v.id) = NEW.root_id AND v.status = 'live');
  SELECT RAISE(ABORT, 'a fee structure is linked only to levels of its own wing')
   WHERE (SELECT section_id FROM fee_structures WHERE id = NEW.root_id)
      IS NOT (SELECT pv.section_id FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id WHERE lv.id = NEW.level_id);
  SELECT RAISE(ABORT, 'a level has one fee structure at a time')
   WHERE EXISTS (SELECT 1 FROM level_fee_structures l JOIN fee_structures r ON r.id = l.root_id, fee_structures n
                  WHERE l.level_id = NEW.level_id AND n.id = NEW.root_id AND r.start_date <= n.end_date AND n.start_date <= r.end_date);
END;
CREATE TRIGGER level_fee_structures_no_update BEFORE UPDATE ON level_fee_structures
BEGIN SELECT RAISE(ABORT, 'a link is made or removed, never changed'); END;

-- A link is in use once any student of the level, charged under it, has paid anything.
CREATE TRIGGER level_fee_structures_in_use BEFORE DELETE ON level_fee_structures
BEGIN
  SELECT RAISE(ABORT, 'the level''s fees are in use: a student has paid')
   WHERE EXISTS (
     SELECT 1 FROM ledger_entries p JOIN enrollments en ON en.id = p.enrollment_id JOIN classes cl ON cl.id = en.class_id
      WHERE p.kind = 'payment' AND cl.level_id = OLD.level_id
        AND EXISTS (SELECT 1 FROM ledger_entries c JOIN fee_items fi ON fi.id = c.fee_item_id JOIN fee_structures fv ON fv.id = fi.structure_id
                     WHERE c.enrollment_id = en.id AND c.kind = 'charge' AND COALESCE(fv.root_id, fv.id) = OLD.root_id));
END;
