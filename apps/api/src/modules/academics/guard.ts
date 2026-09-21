/**
 * The person is re-checked INSIDE every write, from the database, never from the sign-in token: the
 * token can outlive a switch-off by up to 30 minutes (D-021). `?n` in each fragment is the actor's
 * public id. The alias names (`gu`, `ga`) must not clash with the aliases of the statement they sit in.
 */

/**
 * True for an active Super Admin, or an active Co-ordinator whose assignment covers the section:
 * institution-wide, or section-scoped to exactly this one. `sectionId` is an SQL expression that
 * gives the section's integer id.
 */
export const coordinatorForSection = (n: number, sectionId: string): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1
              AND (ga.role = 'super_admin'
                   OR (ga.role = 'coordinator' AND (ga.scope_type = 'institution' OR ga.section_id = ${sectionId}))))`;

/**
 * True for an active Super Admin, or an active INSTITUTION-wide Co-ordinator. For things that belong to
 * the whole school (years, terminals): a section-scoped Co-ordinator does not qualify.
 */
export const coordinatorForInstitution = (n: number): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1
              AND (ga.role = 'super_admin' OR (ga.role = 'coordinator' AND ga.scope_type = 'institution')))`;
