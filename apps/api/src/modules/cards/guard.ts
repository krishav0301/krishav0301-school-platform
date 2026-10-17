/**
 * Who may manage and see a person's card, written as SQL so it is re-checked INSIDE every write from the database,
 * never from the sign-in token (D-021). `?a` is the actor's public id and `?t` the target's, bound by the caller.
 *
 * - A Super Admin: anyone (but never their own card: another person links it).
 * - A Co-ordinator: students and teachers; if their scope is one section, only that section's students and
 *   teachers. The teacher rule is `teacherManageableBy` from `accounts`, the same one that decides who may switch
 *   a teacher off (a module may import another module's `service`, D-060).
 * - An Admin: Co-ordinators and Accountants.
 * To see a card the Admin may also look at the others the Co-ordinator reaches (read only).
 */
import { teacherManageableBy } from "../accounts/service";

const activeActor = (a: number, roleTest: string): string =>
  `EXISTS (SELECT 1 FROM users cu JOIN role_assignments ca ON ca.user_id = cu.id WHERE cu.public_id = ?${a} AND cu.is_active = 1 AND ca.is_active = 1 AND ${roleTest})`;

const studentSections = (t: number): string =>
  `SELECT pv.section_id FROM students ss JOIN enrollments en ON en.student_id = ss.id JOIN classes cl ON cl.id = en.class_id JOIN programmes pv ON pv.id = cl.programme_id WHERE ss.public_id = ?${t}`;

/** The actor may link, replace or retire this student's card. */
export const mayManageStudentCard = (a: number, t: number): string =>
  `(EXISTS (SELECT 1 FROM students WHERE public_id = ?${t})
    AND ${activeActor(a, `(ca.role = 'super_admin' OR (ca.role = 'coordinator' AND (ca.scope_type = 'institution' OR ca.section_id IN (${studentSections(t)}))))`)})`;

const targetHasRole = (t: number, roles: string): string =>
  `EXISTS (SELECT 1 FROM users xu JOIN role_assignments xa ON xa.user_id = xu.id WHERE xu.public_id = ?${t} AND xa.is_active = 1 AND xa.role IN (${roles}))`;

/** The actor may link, replace or retire this staff member's card (a teacher, Co-ordinator, Accountant or Admin). Never their own. */
export const mayManagePersonCard = (a: number, t: number): string =>
  `(?${a} <> ?${t}
    AND ${targetHasRole(t, "'teacher', 'coordinator', 'accountant', 'admin'")}
    AND (${teacherManageableBy(a, t)}
         OR ${activeActor(a, "ca.role = 'super_admin'")}
         OR (${activeActor(a, "ca.role = 'admin'")} AND ${targetHasRole(t, "'coordinator', 'accountant'")})))`;

/** The actor may see this student's card: whoever may manage it, and an Admin (read only). */
export const mayViewStudentCard = (a: number, t: number): string =>
  `(${mayManageStudentCard(a, t)} OR (EXISTS (SELECT 1 FROM students WHERE public_id = ?${t}) AND ${activeActor(a, "ca.role = 'admin'")}))`;

/** The actor may see this staff member's card: whoever may manage it, and an Admin (read only). */
export const mayViewPersonCard = (a: number, t: number): string =>
  `(${mayManagePersonCard(a, t)} OR (${targetHasRole(t, "'teacher', 'coordinator', 'accountant', 'admin'")} AND ${activeActor(a, "ca.role = 'admin'")}))`;

export type CardOwnerKind = "students" | "people";

export const manageGuard = (kind: CardOwnerKind, a: number, t: number): string => (kind === "students" ? mayManageStudentCard(a, t) : mayManagePersonCard(a, t));
export const viewGuard = (kind: CardOwnerKind, a: number, t: number): string => (kind === "students" ? mayViewStudentCard(a, t) : mayViewPersonCard(a, t));
