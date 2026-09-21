/**
 * Choosing a password of one's own after being given a temporary one (D-059).
 *
 * Sign-in with a temporary password returns a `password` challenge and no session. This turns that challenge and a new
 * password into the person's real password, clears the flag, records it, and then carries on exactly as sign-in would: an
 * authenticator step if the person needs one, otherwise the session. A challenge works once: after the change the flag is
 * clear, so a second use finds nothing to change and is refused, and two people racing on one challenge cannot both win
 * (the update applies only while the flag is still set, and the audit entry is written only if it did).
 */
import { recordAudit } from "../../core/audit";
import { hashPassword, passwordProblems, schoolNameWords, verifyPassword, type PasswordProblem } from "../../core/passwords";
import { signChallenge, verifyChallenge } from "../../core/two-factor/challenge";
import { requiresTwoFactor } from "../../core/two-factor/policy";
import { issueAccessToken, newSession, toClaims, type PublicUser, type RoleRow, type Tokens } from "./service";

export interface ChangeDeps {
  db: D1Database;
  sessionSecret: string;
  auditKey: string;
}

export interface ChangeInput {
  challenge: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export type ChangeResult =
  | ({ ok: true; twoFactor?: undefined } & Tokens)
  | { ok: true; twoFactor: "required" | "setup"; challenge: string }
  | { ok: false; reason: "invalid_challenge" | "same_password" }
  | { ok: false; reason: "weak_password"; problems: PasswordProblem[] };

interface UserRow {
  id: number;
  public_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: number;
  must_change_password: number;
}

export async function changeRequiredPassword(deps: ChangeDeps, input: ChangeInput, now: Date = new Date()): Promise<ChangeResult> {
  const { db } = deps;
  const invalid = { ok: false, reason: "invalid_challenge" } as const;

  const challenge = await verifyChallenge(deps.sessionSecret, input.challenge, Math.floor(now.getTime() / 1000));
  if (!challenge || challenge.kind !== "password") return invalid;

  const [userResult, roleResult, twoFactorResult, schoolResult] = await db.batch([
    db.prepare("SELECT id, public_id, email, password_hash, full_name, is_active, must_change_password FROM users WHERE public_id = ?1").bind(challenge.sub),
    db
      .prepare(
        `SELECT ra.role, ra.scope_type, s.key AS section_key
           FROM role_assignments ra JOIN users u ON u.id = ra.user_id LEFT JOIN sections s ON s.id = ra.section_id
          WHERE u.public_id = ?1 AND ra.is_active = 1 ORDER BY ra.id`,
      )
      .bind(challenge.sub),
    db.prepare("SELECT enabled_at FROM user_two_factor WHERE user_id = (SELECT id FROM users WHERE public_id = ?1)").bind(challenge.sub),
    db.prepare("SELECT name, short_name FROM school WHERE id = 1"),
  ]);

  const user = userResult!.results[0] as unknown as UserRow | undefined;
  // Someone switched off, or whose flag is already clear (they have chosen a password, or never needed to), has nothing to change.
  if (!user || user.is_active !== 1 || user.must_change_password !== 1) return invalid;

  // Judge the password before changing anything, so a weak choice leaves the challenge usable.
  const school = schoolResult!.results[0] as { name: string; short_name: string } | undefined;
  const problems = passwordProblems(input.password, user.email, school ? schoolNameWords([school.name, school.short_name]) : []);
  if (problems.length > 0) return { ok: false, reason: "weak_password", problems };
  if (verifyPassword(input.password, user.password_hash)) return { ok: false, reason: "same_password" };

  const { applied } = await recordAudit(
    db,
    deps.auditKey,
    {
      action: "accounts.password.changed",
      entityType: "user",
      entityPublicId: user.public_id,
      actorUserId: user.id, // the person themselves, proven by the temporary password
      summary: "Chose a new password after being given a temporary one",
    },
    [
      db
        .prepare("UPDATE users SET password_hash = ?1, must_change_password = 0, failed_login_count = 0, locked_until = NULL WHERE id = ?2 AND must_change_password = 1 AND is_active = 1")
        .bind(hashPassword(input.password), user.id),
    ],
    { onlyIfLastChanged: true },
  );
  if (!applied) return invalid; // a second use of the same challenge, a moment too late

  // The password is now theirs. Carry on as sign-in does: a second step if one is needed, otherwise the session.
  const roles = toClaims(roleResult!.results as unknown as RoleRow[]);
  const twoFactorEnabled = (twoFactorResult!.results[0] as { enabled_at: string | null } | undefined)?.enabled_at != null;
  const nextStep = twoFactorEnabled ? "required" : requiresTwoFactor(roles) ? "setup" : null;
  if (nextStep) return { ok: true, twoFactor: nextStep, challenge: await signChallenge(deps.sessionSecret, { sub: user.public_id, kind: nextStep === "required" ? "verify" : "setup" }) };

  const userAgent = input.userAgent?.slice(0, 300) ?? null;
  const { sessionId, refreshToken, statement } = await newSession(db, { userId: user.id, ip: input.ip, userAgent, now });
  await db.batch([
    statement,
    db
      .prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, ?2, ?3, 1, 'password_changed', ?4, ?5)")
      .bind(now.toISOString(), user.id, user.email, input.ip, userAgent),
    db.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2").bind(now.toISOString(), user.id),
  ]);

  const publicUser: PublicUser = { id: user.public_id, fullName: user.full_name, email: user.email };
  return { ok: true, user: publicUser, roles, refreshToken, accessToken: await issueAccessToken({ db, sessionSecret: deps.sessionSecret }, publicUser, sessionId, roles, now) };
}
