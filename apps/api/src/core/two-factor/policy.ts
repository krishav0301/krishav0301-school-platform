/**
 * Who must sign in with a second step. CLAUDE.md section 7: the Super Admin uses an authenticator
 * app. The Admin is held to the same rule (D-038, PM 2026-09-21), because the Admin approves money
 * and publishes content. Other staff get a code by SMS or email in Phase 9, when that channel
 * exists; until then their policy is "not required".
 */
const REQUIRED_FOR_ROLES: ReadonlySet<string> = new Set(["super_admin", "admin"]);

export function requiresTwoFactor(roles: readonly { role: string }[]): boolean {
  return roles.some((r) => REQUIRED_FOR_ROLES.has(r.role));
}
