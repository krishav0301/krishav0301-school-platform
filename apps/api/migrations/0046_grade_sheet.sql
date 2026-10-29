-- The grade-point marks card and the mark ledger (the PM, 2026-10-28, for the first school). A school's file may give the
-- layout its own words and scale: the grade table (letter, the lowest percent, the grade point, the remark), the division
-- names, the address lines, and how ties are ranked. NULL for every school that has none: they keep the marks card as it is.
-- Nothing already published changes: both documents are read from the stored snapshots, never recomputed.
ALTER TABLE school ADD COLUMN grade_sheet_json TEXT CHECK (grade_sheet_json IS NULL OR json_valid(grade_sheet_json));
