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
 * True for an active Admin or Super Admin. Programmes and their levels are the Admin's alone (D-087): no Co-ordinator,
 * of any scope, makes or changes one.
 */
export const adminForProgrammes = (n: number): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1 AND ga.role IN ('admin', 'super_admin'))`;

/**
 * True for an active Super Admin, or an active INSTITUTION-wide Co-ordinator. For things that belong to
 * the whole school (years, terminals): a section-scoped Co-ordinator does not qualify.
 */
export const coordinatorForInstitution = (n: number): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1
              AND (ga.role = 'super_admin' OR (ga.role = 'coordinator' AND ga.scope_type = 'institution')))`;

/**
 * True for an active Super Admin, or an active Co-ordinator of ANY scope. For adding a name to the shared subject
 * catalogue: a catalogue entry is only a name, so a section-scoped Co-ordinator may add one.
 */
export const coordinatorAnywhere = (n: number): string =>
  `EXISTS (SELECT 1 FROM users gu JOIN role_assignments ga ON ga.user_id = gu.id
            WHERE gu.public_id = ?${n} AND gu.is_active = 1 AND ga.is_active = 1 AND ga.role IN ('super_admin', 'coordinator'))`;

/*
 * The section id of a level, an offering, a mark component or an elective group, given its public id as parameter
 * `?n`. Pass one to `coordinatorForSection` to decide whether a person's scope covers what they are changing. The
 * aliases (`lv`, `pv`, `so`, `mc`, `eg`) are reserved for these: do not reuse them in the statement around one.
 */
export const levelSection = (n: number): string =>
  `(SELECT pv.section_id FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id WHERE lv.public_id = ?${n})`;

export const offeringSection = (n: number): string =>
  `(SELECT pv.section_id FROM subject_offerings so JOIN levels lv ON lv.id = so.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE so.public_id = ?${n})`;

export const componentSection = (n: number): string =>
  `(SELECT pv.section_id FROM mark_components mc JOIN subject_offerings so ON so.id = mc.offering_id JOIN levels lv ON lv.id = so.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE mc.public_id = ?${n})`;

export const groupSection = (n: number): string =>
  `(SELECT pv.section_id FROM elective_groups eg JOIN levels lv ON lv.id = eg.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE eg.public_id = ?${n})`;

/** The section id of a CLASS, given its public id as parameter `?n` (D-060, teaching assignments). */
export const classSection = (n: number): string =>
  `(SELECT pv.section_id FROM classes cl JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE cl.public_id = ?${n})`;
