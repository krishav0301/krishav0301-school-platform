/**
 * Who must sign in with a second step. CLAUDE.md section 7: the Super Admin uses an authenticator
 * app. Other staff get a code by SMS or email in Phase 9, when that channel exists; until then their
 * policy is "not required". `OPEN:` decide with the PM whether Admin should require it too.
 */
const REQUIRED_FOR_ROLES: ReadonlySet<string> = new Set(["super_admin"]);

export function requiresTwoFactor(roles: readonly { role: string }[]): boolean {
  return roles.some((r) => REQUIRED_FOR_ROLES.has(r.role));
}
