-- Pass marks per subject (the PM, 2026-10-11, for the first school). Off for every school: the exam pattern's two
-- percentages decide who passes. A school's file turns it on; each subject then carries its own pass marks, in marks of its
-- paper (whole hundredths, like every mark): one for theory, one for the practical. NULL: no minimum for that part.
ALTER TABLE school ADD COLUMN pass_marks_per_subject INTEGER NOT NULL DEFAULT 0 CHECK (pass_marks_per_subject IN (0, 1));

ALTER TABLE subject_offerings ADD COLUMN pass_theory_hundredths INTEGER CHECK (pass_theory_hundredths IS NULL OR pass_theory_hundredths >= 0);
ALTER TABLE subject_offerings ADD COLUMN pass_practical_hundredths INTEGER CHECK (pass_practical_hundredths IS NULL OR pass_practical_hundredths >= 0);

-- A mark sheet keeps the pass marks it was made with, as it keeps the paper's maxima, so a later change never moves a result.
ALTER TABLE mark_sheets ADD COLUMN pass_theory_hundredths INTEGER;
ALTER TABLE mark_sheets ADD COLUMN pass_practical_hundredths INTEGER;
