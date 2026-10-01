/**
 * Changing one's own password from Settings (D-091). The current password is required; a wrong one is recorded as a
 * failed sign-in, so it counts toward the same lockout (5 in 15 minutes for the email), and once locked even the right
 * one is refused and nothing is written. The new password meets the same rules as everywhere else. Every other session
 * of the person ends; the one making the change carries on.
 */
import { recordAudit } from "../../core/audit";
import { hashPassword, passwordProblems, schoolNameWords, verifyPassword, type PasswordProblem } from "../../core/passwords";
import { EMAIL_FAILURE_LIMIT, LOCKOUT_WINDOW_MINUTES } from "./service";

export type OwnPasswordResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "throttled" | "wrong_password" | "same_password" }
  | { ok: false; reason: "weak_password"; problems: PasswordProblem[] };

export async function changeOwnPassword(
  deps: { db: D1Database; auditKey: string },
  input: { userPublicId: string; sessionPublicId: string; currentPassword: string; newPassword: string; ip: string | null; userAgent: string | null },
  now: Date = new Date(),
): Promise<OwnPasswordResult> {
  const { db } = deps;
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * 60_000).toISOString();
  const [userResult, schoolResult] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.email, u.password_hash,
                (SELECT COUNT(*) FROM sign_in_events e WHERE e.success = 0 AND e.email_tried = u.email AND e.at > ?2) AS failures
           FROM users u WHERE u.public_id = ?1 AND u.is_active = 1`,
      )
      .bind(input.userPublicId, since),
    db.prepare("SELECT name, short_name FROM school WHERE id = 1"),
  ]);
  const user = userResult!.results[0] as { id: number; email: string; password_hash: string; failures: number } | undefined;
  if (!user) return { ok: false, reason: "not_found" };
  if (user.failures >= EMAIL_FAILURE_LIMIT) return { ok: false, reason: "throttled" }; // nothing hashed, nothing written

  if (!verifyPassword(input.currentPassword, user.password_hash)) {
    await db
      .prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, ?2, ?3, 0, 'wrong_current_password', ?4, ?5)")
      .bind(now.toISOString(), user.id, user.email, input.ip, input.userAgent?.slice(0, 300) ?? null)
      .run();
    return { ok: false, reason: "wrong_password" };
  }

  const school = schoolResult!.results[0] as { name: string; short_name: string } | undefined;
  const problems = passwordProblems(input.newPassword, user.email, school ? schoolNameWords([school.name, school.short_name]) : []);
  if (problems.length > 0) return { ok: false, reason: "weak_password", problems };
  if (verifyPassword(input.newPassword, user.password_hash)) return { ok: false, reason: "same_password" };

  const nowIso = now.toISOString();
  await recordAudit(
    db,
    deps.auditKey,
    { action: "accounts.password.changed", entityType: "user", entityPublicId: input.userPublicId, actorUserId: user.id, summary: "Changed their own password in Settings" },
    [
      db.prepare("UPDATE users SET password_hash = ?1, failed_login_count = 0, locked_until = NULL WHERE id = ?2 AND is_active = 1").bind(hashPassword(input.newPassword), user.id),
      db
        .prepare("UPDATE sessions SET revoked_at = ?1, revoked_reason = 'password_changed' WHERE user_id = ?2 AND revoked_at IS NULL AND public_id <> ?3")
        .bind(nowIso, user.id, input.sessionPublicId),
    ],
  );
  return { ok: true };
}
