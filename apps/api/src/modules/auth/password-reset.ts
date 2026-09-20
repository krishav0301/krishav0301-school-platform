/**
 * Password reset (D-032).
 *
 * Request: the answer never depends on whether the address has an account, and the work is the same
 * either way (one batch of conditional statements), so neither the response nor its timing gives
 * away which addresses are registered. The token is 256 random bits; only its SHA-256 hash is
 * stored, and the email that carries it waits in the outbox sealed.
 *
 * Confirm: the token works once. It is claimed first, with a conditional update, so two people
 * using the same link at once cannot both win. If the server stops after claiming and before the
 * password is written, the person simply asks for a new link: the safe way to fail. A successful
 * reset ends every session the account had, since whoever held them may not be the owner.
 */
import { recordAudit } from "../../core/audit";
import { hashPassword, passwordProblems, schoolNameWords, type PasswordProblem } from "../../core/passwords";
import { queueEmailIf } from "../../core/notifications";
import { newRefreshToken, sha256Hex } from "../../core/tokens";
import { normaliseEmail } from "../accounts/service";

export const RESET_TTL_MINUTES = 60;
export const RESET_PER_USER_PER_HOUR = 3;
export const RESET_PER_IP_PER_HOUR = 10;

const MINUTE = 60_000;

export interface ResetDeps {
  db: D1Database;
  /** Seals the emailed token while it waits in the outbox. */
  dataKey: string;
  auditKey: string;
}

/**
 * Starts a reset for this address if it belongs to an active account and the limits allow.
 * Always resolves the same way. Queues the email; delivering it is the caller's next step.
 */
export async function requestPasswordReset(deps: Pick<ResetDeps, "db" | "dataKey">, input: { email: string; ip: string | null; now?: Date }): Promise<void> {
  const { db } = deps;
  const now = input.now ?? new Date();
  const email = normaliseEmail(input.email);
  const nowIso = now.toISOString();
  const hourAgo = new Date(now.getTime() - 60 * MINUTE).toISOString();

  const token = newRefreshToken(); // 32 random bytes, URL-safe
  const tokenHash = await sha256Hex(token);

  await db.batch([
    // 1. The reset itself, only for an active account that is within both limits.
    db
      .prepare(
        `INSERT INTO password_resets (user_id, token_hash, created_at, expires_at, ip)
         SELECT u.id, ?1, ?2, ?3, ?4 FROM users u
          WHERE u.email = ?5 AND u.is_active = 1
            AND (SELECT COUNT(*) FROM password_resets r WHERE r.user_id = u.id AND r.created_at > ?6) < ?7
            AND (?4 IS NULL OR (SELECT COUNT(*) FROM password_resets r WHERE r.ip = ?4 AND r.created_at > ?6) < ?8)`,
      )
      .bind(tokenHash, nowIso, new Date(now.getTime() + RESET_TTL_MINUTES * MINUTE).toISOString(), input.ip, email, hourAgo, RESET_PER_USER_PER_HOUR, RESET_PER_IP_PER_HOUR),
    // 2. The email, only if (1) created a row.
    await queueEmailIf(db, deps.dataKey, { template: "password_reset", to: email, data: { token }, dedupeKey: `password_reset:${tokenHash}` }, "SELECT 1 FROM password_resets WHERE token_hash = ?5", tokenHash),
    // 3. A newer link replaces any older one still open, only if (1) created a row.
    db
      .prepare(
        `UPDATE password_resets SET used_at = ?1
          WHERE used_at IS NULL AND token_hash != ?2
            AND user_id = (SELECT user_id FROM password_resets WHERE token_hash = ?2)`,
      )
      .bind(nowIso, tokenHash),
  ]);
}

export type ConfirmResult = { ok: true } | { ok: false; reason: "invalid_or_expired" } | { ok: false; reason: "weak_password"; problems: PasswordProblem[] };

interface ResetRow {
  id: number;
  user_id: number;
  email: string;
  used_at: string | null;
  expires_at: string;
  is_active: number;
  public_id: string;
}

/** Sets the new password if the token is valid, unused and not expired, and the password is acceptable. */
export async function confirmPasswordReset(deps: Pick<ResetDeps, "db" | "auditKey">, input: { token: string; password: string }, now: Date = new Date()): Promise<ConfirmResult> {
  const { db } = deps;
  const nowIso = now.toISOString();
  const invalid: ConfirmResult = { ok: false, reason: "invalid_or_expired" };

  const [resetResult, schoolResult] = await db.batch([
    db
      .prepare(
        `SELECT r.id, r.user_id, r.used_at, r.expires_at, u.email, u.is_active, u.public_id
           FROM password_resets r JOIN users u ON u.id = r.user_id
          WHERE r.token_hash = ?1`,
      )
      .bind(await sha256Hex(input.token)),
    db.prepare("SELECT name, short_name FROM school WHERE id = 1"),
  ]);

  const reset = resetResult!.results[0] as unknown as ResetRow | undefined;
  if (!reset || reset.used_at !== null || reset.expires_at <= nowIso || reset.is_active !== 1) return invalid;

  // Judge the password before touching the link, so a weak choice leaves it usable.
  const school = schoolResult!.results[0] as { name: string; short_name: string } | undefined;
  const avoid = school ? schoolNameWords([school.name, school.short_name]) : [];
  const problems = passwordProblems(input.password, reset.email, avoid);
  if (problems.length > 0) return { ok: false, reason: "weak_password", problems };

  const passwordHash = hashPassword(input.password);

  // Claim the link. Only one caller can change used_at from NULL.
  const claim = await db
    .prepare("UPDATE password_resets SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL AND expires_at > ?1")
    .bind(nowIso, reset.id)
    .run();
  if (claim.meta.changes !== 1) return invalid;

  await recordAudit(
    db,
    deps.auditKey,
    {
      action: "accounts.password.reset",
      entityType: "user",
      entityPublicId: reset.public_id,
      actorUserId: reset.user_id, // the person themselves, proven by the emailed link
      summary: "Password reset with an emailed link",
    },
    [
      db.prepare("UPDATE users SET password_hash = ?1, must_change_password = 0, failed_login_count = 0 WHERE id = ?2").bind(passwordHash, reset.user_id),
      db.prepare("UPDATE sessions SET revoked_at = ?1, revoked_reason = 'password_reset' WHERE user_id = ?2 AND revoked_at IS NULL").bind(nowIso, reset.user_id),
      db.prepare("UPDATE password_resets SET used_at = ?1 WHERE user_id = ?2 AND used_at IS NULL").bind(nowIso, reset.user_id),
    ],
  );
  return { ok: true };
}
