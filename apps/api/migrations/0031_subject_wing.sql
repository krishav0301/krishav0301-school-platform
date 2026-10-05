-- Subjects belong to a wing (D-114, FUT point 11). The +2 wing's English and the Bachelor's wing's English are two
-- subjects, each listed only in its own wing, so a name is unique WITHIN a wing, not across the school.
--
-- The table is rebuilt the way SQLite allows on D1, as 0030 did for `academic_years`: copy the rows aside, drop it,
-- create it again under the same name, put the rows back with the same ids (so every `subject_offerings.subject_id`
-- still points at its subject), with foreign keys deferred until the commit.
--
-- Then the subjects are sorted into wings from their curriculum. Every statement after "Sorting" acts only on subjects
-- with no wing yet, so the block is safe to repeat (its test runs it again on prepared rows):
--   * used in one wing's levels: that wing;
--   * used in several: the subject stays in the wing with the lowest id, and a copy is made for each other wing,
--     whose offerings move to the copy (marks, teaching and results follow their offering, untouched);
--   * not used anywhere: left without a wing. It is listed as "Choose a wing" and cannot join a curriculum until a
--     whole-school Co-ordinator sets one.

PRAGMA defer_foreign_keys = true;

CREATE TABLE subjects_copy AS SELECT * FROM subjects;
DROP TABLE subjects;

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  -- The wing (`sections`). NULL only for an old subject not sorted yet.
  section_id INTEGER REFERENCES sections (id),
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 120),
  code TEXT CHECK (code IS NULL OR length(code) BETWEEN 1 AND 20),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1))
);
-- A name, and a code when there is one, are unique within a wing whatever their letter case. Unsorted subjects count as
-- one more wing, so two of them cannot share a name either (they could not before: names were unique school-wide).
CREATE UNIQUE INDEX subjects_name_in_wing ON subjects (COALESCE(section_id, 0), name COLLATE NOCASE);
CREATE UNIQUE INDEX subjects_code_in_wing ON subjects (COALESCE(section_id, 0), code COLLATE NOCASE) WHERE code IS NOT NULL;
CREATE INDEX subjects_wing ON subjects (section_id);

INSERT INTO subjects (id, public_id, section_id, name, code, is_archived)
SELECT id, public_id, NULL, name, code, is_archived FROM subjects_copy;
DROP TABLE subjects_copy;

-- Sorting ----------------------------------------------------------------------------------------------------------

-- Used in exactly one wing: that wing.
UPDATE subjects SET section_id = (
  SELECT MIN(p.section_id) FROM subject_offerings o JOIN levels l ON l.id = o.level_id JOIN programmes p ON p.id = l.programme_id
   WHERE o.subject_id = subjects.id)
 WHERE section_id IS NULL
   AND (SELECT COUNT(DISTINCT p.section_id) FROM subject_offerings o JOIN levels l ON l.id = o.level_id JOIN programmes p ON p.id = l.programme_id
         WHERE o.subject_id = subjects.id) = 1;

-- Used in several wings: each one, and the wing the subject itself keeps (the lowest id).
CREATE TABLE subject_wing_split AS
SELECT DISTINCT o.subject_id AS subject_id, p.section_id AS section_id,
       (SELECT MIN(p2.section_id) FROM subject_offerings o2 JOIN levels l2 ON l2.id = o2.level_id JOIN programmes p2 ON p2.id = l2.programme_id
         WHERE o2.subject_id = o.subject_id) AS home
  FROM subject_offerings o JOIN levels l ON l.id = o.level_id JOIN programmes p ON p.id = l.programme_id
  JOIN subjects s ON s.id = o.subject_id
 WHERE s.section_id IS NULL;

-- A copy in every other wing, with the same name, code and archived state.
INSERT INTO subjects (public_id, section_id, name, code, is_archived)
SELECT lower(hex(randomblob(16))), w.section_id, s.name, s.code, s.is_archived
  FROM subject_wing_split w JOIN subjects s ON s.id = w.subject_id
 WHERE w.section_id <> w.home;

-- That wing's offerings move to its copy.
UPDATE subject_offerings SET subject_id = (
  SELECT c.id FROM subject_wing_split w JOIN subjects s ON s.id = w.subject_id JOIN subjects c ON c.section_id = w.section_id AND c.name = s.name
   WHERE w.subject_id = subject_offerings.subject_id
     AND w.section_id = (SELECT p.section_id FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.id = subject_offerings.level_id))
 WHERE subject_id IN (SELECT subject_id FROM subject_wing_split WHERE section_id <> home)
   AND (SELECT p.section_id FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.id = subject_offerings.level_id)
       <> (SELECT home FROM subject_wing_split WHERE subject_id = subject_offerings.subject_id LIMIT 1);

-- The subject itself keeps its home wing.
UPDATE subjects SET section_id = (SELECT home FROM subject_wing_split WHERE subject_id = subjects.id LIMIT 1)
 WHERE section_id IS NULL AND id IN (SELECT subject_id FROM subject_wing_split);

DROP TABLE subject_wing_split;
