-- Setup made by mistake can be deleted while nothing uses it (the PM, 2026-10-12): a term, a subject on a level, an elective
-- group and a term's exam pattern. Each delete re-checks "nothing uses it" in the service. The one rule the database itself
-- held back was the exam pattern's: it was never deleted. It may now go while its term is open and no mark has been entered
-- (the same lock that stops it being changed); once marks exist it stays.
DROP TRIGGER exam_patterns_no_delete;
CREATE TRIGGER exam_patterns_delete_before_marks BEFORE DELETE ON exam_patterns
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT status FROM academic_years WHERE id = OLD.academic_year_id) = 'closed';
  SELECT RAISE(ABORT, 'the exam pattern is locked: marks have been entered')
   WHERE EXISTS (SELECT 1 FROM mark_sheets ms JOIN terminals t ON t.id = ms.terminal_id WHERE t.academic_year_id = OLD.academic_year_id);
END;
