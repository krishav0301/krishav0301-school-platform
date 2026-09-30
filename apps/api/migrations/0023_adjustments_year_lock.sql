-- A closed year takes no new discount, reversal or refund request (CLAUDE.md section 6: a closed year rejects all
-- writes). The service refuses first; this is the second guard, as for every other year table (D-084).
CREATE TRIGGER fee_adjustments_year_open BEFORE INSERT ON fee_adjustments
BEGIN
  SELECT RAISE(ABORT, 'the academic year is closed')
   WHERE (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.id = NEW.enrollment_id) = 'closed';
END;
