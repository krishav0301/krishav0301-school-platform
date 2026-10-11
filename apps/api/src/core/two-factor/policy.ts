/**
 * Who must sign in with a second step. CLAUDE.md section 7: the Super Admin uses an authenticator
 * app. The Admin is held to the same rule (D-038, PM 2026-09-21), because the Admin approves money
 * and publishes content. Other staff get a code by SMS or email in Phase 9, when that channel
 * exists; until then their policy is "not required".
 */
/**
 * `adminRequired` is the school's setting (D-138): a school may say its Admin signs in with an ID and a password only.
 * The Super Admin is always held to the second step, whatever the school says.
 */
export function requiresTwoFactor(roles: readonly { role: string }[], adminRequired = true): boolean {
  return roles.some((r) => r.role === "super_admin" || (r.role === "admin" && adminRequired));
}

/** What the sign-in reads: 1 when the school has no row or has not said, so the rule stays on. */
export const ADMIN_TWO_FACTOR_SQL = "SELECT COALESCE((SELECT admin_two_factor FROM school WHERE id = 1), 1) AS required";
