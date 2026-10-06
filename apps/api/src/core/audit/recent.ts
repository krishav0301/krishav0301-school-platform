/**
 * How the audit trail (Reports, Activity) reads an entry. The dashboard's "Recent activity" that first used these was
 * removed at the PM's request (2026-10-06).
 *
 * An admission names the student and their student ID, read from the student record: the
 * entry is written in the same batch that numbers the student, before the ID is known (admin FUT F-04). Earlier
 * entries, which carried an internal id, read the same way.
 */
export const STUDENT_JOIN = "LEFT JOIN students st ON ae.entity_type = 'student' AND st.public_id = ae.entity_public_id";
export const READABLE_SUMMARY = `CASE WHEN ae.action = 'admissions.approved' AND st.id IS NOT NULL
  THEN st.first_name || ' ' || st.last_name || ' admitted (' || st.sid || ')' ELSE ae.summary END`;
