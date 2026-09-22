/**
 * Who may decide a request (D-061), written as SQL so it is re-checked INSIDE every write from the
 * database, never from the sign-in token (D-021). `?n` is the actor's public id.
 */

/** True for an active Admin or Super Admin. */
export const isDecider = (n: number): string =>
  `EXISTS (SELECT 1 FROM users du JOIN role_assignments dra ON dra.user_id = du.id
            WHERE du.public_id = ?${n} AND du.is_active = 1 AND dra.is_active = 1 AND dra.role IN ('admin', 'super_admin'))`;

/**
 * True for an active Co-ordinator, Admin or Super Admin (the `approvals.request` matrix cells): who may
 * send something for approval, across every kind. A specific kind's OWN write (drafting content, for
 * example) has its own, separate guard in its own module; this one only governs the approvals engine.
 */
export const mayRequest = (n: number): string =>
  `EXISTS (SELECT 1 FROM users ru JOIN role_assignments rra ON rra.user_id = ru.id
            WHERE ru.public_id = ?${n} AND ru.is_active = 1 AND rra.is_active = 1 AND rra.role IN ('coordinator', 'admin', 'super_admin'))`;
