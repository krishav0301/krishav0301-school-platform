/**
 * Who may create and manage staff (D-059), written as SQL so it is re-checked INSIDE every write from the database,
 * never from the sign-in token (the token can outlive a switch-off by up to 30 minutes, D-021). `?a` is the actor's
 * public id and `?t` the target's. The aliases (`mu`, `ma`, `tu`, `ta`, `tv`, `tb`, `tp`) are reserved for these
 * fragments: do not reuse them in the statement around one.
 */

/**
 * May the actor manage this person (switch them off or on, give them a new temporary password)?
 * - a Super Admin: anyone,
 * - an Admin: a Co-ordinator or an Accountant,
 * - a Co-ordinator: a teacher, and only one of their own section if their scope is one section,
 * and never themselves: nobody changes their own account this way.
 */
export const actorMayManage = (a: number, t: number): string =>
  `EXISTS (
     SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id
      WHERE mu.public_id = ?${a} AND mu.is_active = 1 AND ma.is_active = 1 AND mu.public_id <> ?${t}
        AND (
          ma.role = 'super_admin'
          OR (ma.role = 'admin' AND EXISTS (
                SELECT 1 FROM users tu JOIN role_assignments ta ON ta.user_id = tu.id
                 WHERE tu.public_id = ?${t} AND ta.is_active = 1 AND ta.role IN ('coordinator', 'accountant')))
          OR (ma.role = 'coordinator' AND EXISTS (
                SELECT 1 FROM users tv JOIN role_assignments tb ON tb.user_id = tv.id LEFT JOIN staff_profiles tp ON tp.user_id = tv.id
                 WHERE tv.public_id = ?${t} AND tb.is_active = 1 AND tb.role = 'teacher'
                   AND (ma.scope_type = 'institution' OR tp.home_section_id = ma.section_id)))
        )
   )`;

/** May the actor create a Co-ordinator or an Accountant? An Admin or a Super Admin. */
export const actorMayCreateStaff = (a: number): string =>
  `EXISTS (SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id
            WHERE mu.public_id = ?${a} AND mu.is_active = 1 AND ma.is_active = 1 AND ma.role IN ('admin', 'super_admin'))`;

/**
 * May the actor create a teacher whose home section has the key in `?k`? A Super Admin, or a Co-ordinator who is
 * whole-school or whose one section is that section.
 */
export const actorMayCreateTeacher = (a: number, k: number): string =>
  `EXISTS (SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id
            WHERE mu.public_id = ?${a} AND mu.is_active = 1 AND ma.is_active = 1
              AND (ma.role = 'super_admin'
                   OR (ma.role = 'coordinator' AND (ma.scope_type = 'institution' OR ma.section_id = (SELECT id FROM sections WHERE key = ?${k})))))`;
