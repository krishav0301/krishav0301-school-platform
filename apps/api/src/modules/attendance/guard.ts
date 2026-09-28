import type { Grant } from "../../core/permissions";

/**
 * SQL fragments shared by the attendance reads and writes. Aliases: `cl` a class, `pv` its programme, `s` its
 * section. Parameters are bound by the caller at the positions named.
 */

/** The school has not switched this optional module off. Checked by the API, not only the menu (spec decision 7). */
export const moduleOn = (key: "attendance" | "teacher_attendance"): string => `COALESCE((SELECT enabled FROM module_switches WHERE key = '${key}'), 1) = 1`;

/** How far a grant reaches over classes, as four bound values: the person, institution-wide, their sections, Class Teacher only. */
export interface Reach {
  me: string;
  institution: 0 | 1;
  sections: string | null;
  classOnly: 0 | 1;
}

export function reachOf(grant: Grant, me: string): Reach {
  return {
    me,
    institution: grant.institution ? 1 : 0,
    sections: grant.sections.length > 0 ? JSON.stringify(grant.sections) : null,
    classOnly: grant.classOnly ? 1 : 0,
  };
}

/**
 * True when the class (`cl`, section `s`) is within reach. `?${n}` is the person's public id, then `?${n+1}`
 * institution, `?${n+2}` sections, `?${n+3}` Class Teacher only. A Student's `own` grant reaches no class.
 * The Class Teacher must still be an active user: deactivation takes effect here, not at the next sign-in.
 */
export const classInReach = (n: number): string =>
  `(?${n + 1} = 1
    OR s.key IN (SELECT value FROM json_each(COALESCE(?${n + 2}, '[]')))
    OR (?${n + 3} = 1 AND cl.class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?${n} AND is_active = 1)))`;

export const bindReach = (r: Reach): [string, number, string | null, number] => [r.me, r.institution, r.sections, r.classOnly];

/** The joins from a class to its section, used with `classInReach`. */
export const CLASS_JOINS = `JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id`;

/** An active user who still holds an active teacher role: the Class Teacher is re-checked inside the write (D-021). */
export const activeTeacher = (userAlias: string): string =>
  `${userAlias}.is_active = 1 AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = ${userAlias}.id AND ra.role = 'teacher' AND ra.is_active = 1)`;
