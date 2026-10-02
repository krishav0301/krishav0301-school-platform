/**
 * What a teacher teaches, as SQL fragments other modules may embed (D-099), so the People screen can show a teacher's
 * subjects and programmes, and filter by programme, in its own single round trip without reading this module's
 * tables itself (the same pattern as `teacherManageableBy`, D-060). `u` is the SQL expression for the teacher's
 * internal user id; `?p` is a programme's public id. Only active assignments in classes of a year that is not closed
 * count. Aliases `zta`, `zc`, `zy`, `zso`, `zs` and `zp` are reserved for these fragments.
 */
const ACTIVE_TEACHING = (u: string) => `FROM teacher_assignments zta
         JOIN classes zc ON zc.id = zta.class_id
         JOIN academic_years zy ON zy.id = zc.academic_year_id AND zy.status <> 'closed'
         JOIN subject_offerings zso ON zso.id = zta.offering_id
         JOIN subjects zs ON zs.id = zso.subject_id
         JOIN programmes zp ON zp.id = zc.programme_id
        WHERE zta.teacher_user_id = ${u} AND zta.is_active = 1`;

/** A JSON array of the names of the subjects the teacher teaches, alphabetical. */
export const teacherSubjectsJson = (u: string): string => `(SELECT json_group_array(name) FROM (SELECT DISTINCT zs.name AS name ${ACTIVE_TEACHING(u)} ORDER BY zs.name COLLATE NOCASE))`;

/** A JSON array of the names of the programmes the teacher teaches in, alphabetical. */
export const teacherProgrammesJson = (u: string): string => `(SELECT json_group_array(name) FROM (SELECT DISTINCT zp.name AS name ${ACTIVE_TEACHING(u)} ORDER BY zp.name COLLATE NOCASE))`;

/** True when the teacher teaches in the programme whose public id is `?p`. */
export const teachesInProgramme = (u: string, p: number): string => `EXISTS (SELECT 1 ${ACTIVE_TEACHING(u)} AND zp.public_id = ?${p})`;
