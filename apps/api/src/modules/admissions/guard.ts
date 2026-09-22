/**
 * The person is re-checked INSIDE every write, from the database, never from the sign-in token (D-021).
 * `?n` is the actor's public id. Alias names (`gu`, `ga`) must not clash with the statement they sit in.
 */

/** True for an active Super Admin, or an active Co-ordinator whose assignment covers the section. */
export const coordinatorForSection = (n: number, sectionId: string): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1
              AND (ga.role = 'super_admin'
                   OR (ga.role = 'coordinator' AND (ga.scope_type = 'institution' OR ga.section_id = ${sectionId}))))`;

/** True for an active Super Admin, or an active Accountant of any scope (registering a student needs no section reach beyond the level they name, which is checked separately). */
export const accountantAnywhere = (n: number): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1 AND ga.role IN ('super_admin', 'accountant'))`;

/** The section id of the LEVEL a public id names, for `coordinatorForSection`. */
export const levelSection = (n: number): string =>
  `(SELECT pv.section_id FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id WHERE lv.public_id = ?${n})`;

/** The section id of an APPLICATION's own level, given the application's public id. */
export const applicationSection = (n: number): string =>
  `(SELECT pv.section_id FROM applications ap JOIN levels lv ON lv.id = ap.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE ap.public_id = ?${n})`;

/** The section id of a CLASS, given its public id. */
export const classSection = (n: number): string =>
  `(SELECT pv.section_id FROM classes cl JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE cl.public_id = ?${n})`;
