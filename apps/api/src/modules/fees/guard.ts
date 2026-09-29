/**
 * Who may act on fees, as SQL re-checked inside every write from the database, never the sign-in token (D-021).
 * `?n` is the actor's public id. The Co-ordinator has no fees access at all (CLAUDE.md section 6).
 */

/** An active Accountant whose assignment covers the section (`sectionId`, an SQL expression), or an active Super Admin. */
export const accountantFor = (n: number, sectionId: string): string =>
  `EXISTS (SELECT 1 FROM users fu JOIN role_assignments fa ON fa.user_id = fu.id
            WHERE fu.public_id = ?${n} AND fu.is_active = 1 AND fa.is_active = 1
              AND (fa.role = 'super_admin' OR (fa.role = 'accountant' AND (fa.scope_type = 'institution' OR fa.section_id = ${sectionId}))))`;

/** An active Accountant of any scope, or an active Super Admin (who may send a fees request; the subject's own guard narrows it). */
export const anyAccountant = (n: number): string =>
  `EXISTS (SELECT 1 FROM users fu JOIN role_assignments fa ON fa.user_id = fu.id
            WHERE fu.public_id = ?${n} AND fu.is_active = 1 AND fa.is_active = 1 AND fa.role IN ('accountant', 'super_admin'))`;

/** The section id of a level, by its public id bound at `?n`. */
export const levelSection = (n: number): string => `(SELECT pv.section_id FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id WHERE lv.public_id = ?${n})`;

/** The section id of a fee structure, by its internal id expression. */
export const structureSection = (structureId: string): string =>
  `(SELECT pv.section_id FROM fee_structures fs JOIN levels lv ON lv.id = fs.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE fs.id = ${structureId})`;

/** The section id of an enrollment, by its public id bound at `?n`. */
export const enrollmentSection = (n: number): string =>
  `(SELECT pv.section_id FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE en.public_id = ?${n})`;
