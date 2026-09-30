import type { Grant } from "../../core/permissions";

/**
 * SQL fragments shared by the classwork reads and writes. Aliases: `cl` a class, `pv` its programme, `s` its section.
 */

export const CLASS_JOINS = `JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id`;

/** How far a grant reaches over classes, as bound values: the person, institution-wide, their sections, their assigned classes. */
export interface Reach {
  me: string;
  institution: 0 | 1;
  sections: string | null;
  assigned: 0 | 1;
}

export const reachOf = (grant: Grant, me: string): Reach => ({
  me,
  institution: grant.institution ? 1 : 0,
  sections: grant.sections.length > 0 ? JSON.stringify(grant.sections) : null,
  assigned: grant.assigned ? 1 : 0,
});

export const bindReach = (r: Reach): [string, number, string | null, number] => [r.me, r.institution, r.sections, r.assigned];

/** An active assignment of the person `?${n}` (an active user) in class `cl`, optionally to one offering (`offering`). */
export const teachesIn = (n: number, offering?: string): string =>
  `EXISTS (SELECT 1 FROM teacher_assignments ta JOIN users au ON au.id = ta.teacher_user_id
            WHERE ta.class_id = cl.id AND ta.is_active = 1 AND au.public_id = ?${n} AND au.is_active = 1${offering ? ` AND ta.offering_id = ${offering}` : ""})`;

/**
 * True when the class (`cl`, section `s`) is within reach: `?${n}` the person, `?${n+1}` institution, `?${n+2}` sections,
 * `?${n+3}` assigned (a teacher reaches the classes they teach in). A Student's `own` grant reaches no class by address.
 */
export const classInReach = (n: number): string =>
  `(?${n + 1} = 1 OR s.key IN (SELECT value FROM json_each(COALESCE(?${n + 2}, '[]'))) OR (?${n + 3} = 1 AND ${teachesIn(n)}))`;

/** An active user who still holds an active teacher role. */
export const activeTeacher = (userAlias: string): string =>
  `${userAlias}.is_active = 1 AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = ${userAlias}.id AND ra.role = 'teacher' AND ra.is_active = 1)`;

/**
 * The person `u` still teaches offering `o` in class `cl`: an active teacher with an active assignment. `?1` the
 * person, `?2` the class, `?3` the offering. The FROM clause names `cl`, `o` and `u`.
 */
export const TEACHES_SUBJECT = `u.public_id = ?1 AND cl.public_id = ?2 AND o.public_id = ?3 AND ${activeTeacher("u")}
  AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = cl.id AND ta.offering_id = o.id AND ta.teacher_user_id = u.id AND ta.is_active = 1)`;

/** The person `?${n}` teaches the subject of a row carrying `class_id` and `offering_id` (alias `row`). */
export const teachesRow = (n: number, row: string): string =>
  `EXISTS (SELECT 1 FROM users u JOIN teacher_assignments ta ON ta.teacher_user_id = u.id
            WHERE u.public_id = ?${n} AND ${activeTeacher("u")} AND ta.is_active = 1 AND ta.class_id = ${row}.class_id AND ta.offering_id = ${row}.offering_id)`;
