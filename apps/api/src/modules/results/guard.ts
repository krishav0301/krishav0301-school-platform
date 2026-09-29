import type { Grant } from "../../core/permissions";

/**
 * SQL fragments shared by the results reads and writes. Aliases: `cl` a class, `lv` its level, `pv` its programme,
 * `s` its section. Every write re-checks the actor's role inside its own batch, from the database, never the sign-in
 * token (D-021).
 */

export const CLASS_JOINS = `JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id`;
export const NAMING_COLUMNS = `pv.name AS programme_name, lv.name AS level_name, cl.label`;
export const naming = (r: { programme_name: string; level_name: string; label: string }) => ({ programmeName: r.programme_name, levelName: r.level_name, label: r.label });

/** How far a grant reaches over classes, as bound values. */
export interface Reach {
  institution: 0 | 1;
  sections: string | null;
}

export const reachOf = (grant: Grant): Reach => ({ institution: grant.institution ? 1 : 0, sections: grant.sections.length > 0 ? JSON.stringify(grant.sections) : null });

/** True when section `s` is within reach: `?${n}` institution, `?${n+1}` sections. */
export const sectionInReach = (n: number): string => `(?${n} = 1 OR s.key IN (SELECT value FROM json_each(COALESCE(?${n + 1}, '[]'))))`;

/** An active Co-ordinator whose assignment covers section id `sectionId` (an SQL expression), or an active Super Admin; `?${n}` the person. */
export const coordinatorFor = (n: number, sectionId: string): string =>
  `EXISTS (SELECT 1 FROM users ru JOIN role_assignments ra ON ra.user_id = ru.id
            WHERE ru.public_id = ?${n} AND ru.is_active = 1 AND ra.is_active = 1
              AND (ra.role = 'super_admin' OR (ra.role = 'coordinator' AND (ra.scope_type = 'institution' OR ra.section_id = ${sectionId}))))`;

/** The person `?${n}` is an active teacher with an active assignment to offering `offering` in class `klass` (SQL expressions). */
export const teaches = (n: number, klass: string, offering: string): string =>
  `EXISTS (SELECT 1 FROM users tu JOIN teacher_assignments ta ON ta.teacher_user_id = tu.id
            WHERE tu.public_id = ?${n} AND tu.is_active = 1 AND ta.is_active = 1 AND ta.class_id = ${klass} AND ta.offering_id = ${offering}
              AND EXISTS (SELECT 1 FROM role_assignments tr WHERE tr.user_id = tu.id AND tr.role = 'teacher' AND tr.is_active = 1))`;

/** The student of enrollment `en` takes offering `o`: it is compulsory, or they picked it. */
export const takes = (en: string, o: string): string =>
  `(${o}.elective_group_id IS NULL OR EXISTS (SELECT 1 FROM elective_picks ep WHERE ep.enrollment_id = ${en}.id AND ep.offering_id = ${o}.id AND ep.is_active = 1))`;

/**
 * The marks a class still lacks for a terminal, as (student, subject, component) rows: every active student, every
 * active subject they take, every active component of it, with no mark and no absence recorded. `cl` is the class;
 * `terminal` the terminal's internal id (an SQL expression). A subject with no students or no components needs nothing.
 */
export const missingMarks = (terminal: string): string =>
  `SELECT en.id AS enrollment_id, o.id AS offering_id, mc.id AS component_id
     FROM enrollments en
     JOIN subject_offerings o ON o.level_id = cl.level_id AND o.is_active = 1
     JOIN mark_components mc ON mc.offering_id = o.id AND mc.is_active = 1
    WHERE en.class_id = cl.id AND en.status = 'active' AND ${takes("en", "o")}
      AND NOT EXISTS (SELECT 1 FROM marks m JOIN mark_sheets ms ON ms.id = m.sheet_id
                       WHERE ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = ${terminal}
                         AND m.enrollment_id = en.id AND m.component_id = mc.id AND (m.value_hundredths IS NOT NULL OR m.absent = 1))`;

/** The subjects of class `cl` that someone takes and that have components: the ones a terminal's results are made of. */
export const neededSubjects = `SELECT o.id FROM subject_offerings o
    WHERE o.level_id = cl.level_id AND o.is_active = 1
      AND EXISTS (SELECT 1 FROM mark_components mc WHERE mc.offering_id = o.id AND mc.is_active = 1)
      AND EXISTS (SELECT 1 FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active' AND ${takes("en", "o")})`;

/** True when every needed subject of class `cl` has a verified (or published) sheet for the terminal and no mark is missing. */
export const readyToPublish = (terminal: string): string =>
  `NOT EXISTS (${neededSubjects}
                 AND NOT EXISTS (SELECT 1 FROM mark_sheets ms WHERE ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = ${terminal}
                                   AND ms.status IN ('verified', 'published')))
   AND NOT EXISTS (${missingMarks(terminal)})
   AND EXISTS (${neededSubjects})`;

/** How many marks of subject `o` in class `cl` are still missing for the terminal (a scalar subquery). */
export const missingCount = (terminal: string): string =>
  `(SELECT COUNT(*) FROM enrollments en JOIN mark_components mc ON mc.offering_id = o.id AND mc.is_active = 1
     WHERE en.class_id = cl.id AND en.status = 'active' AND ${takes("en", "o")}
       AND NOT EXISTS (SELECT 1 FROM marks m JOIN mark_sheets ms ON ms.id = m.sheet_id
                        WHERE ms.class_id = cl.id AND ms.offering_id = o.id AND ms.terminal_id = ${terminal}
                          AND m.enrollment_id = en.id AND m.component_id = mc.id AND (m.value_hundredths IS NOT NULL OR m.absent = 1)))`;

/** The active teacher of subject `o` in class `cl`, or null (a scalar subquery). */
export const teacherName = `(SELECT tu.full_name FROM teacher_assignments ta JOIN users tu ON tu.id = ta.teacher_user_id WHERE ta.class_id = cl.id AND ta.offering_id = o.id AND ta.is_active = 1)`;

export const top20On = `COALESCE((SELECT enabled FROM module_switches WHERE key = 'top20'), 1) = 1`;
