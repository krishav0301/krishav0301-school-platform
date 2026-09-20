/**
 * Sign-in, refresh and sign-out (D-021).
 *
 * Round trips: sign-in is one read batch, then one write batch. Refresh is one read batch and one
 * write. A failed sign-in is one read batch and one small write. A throttled attempt writes
 * nothing, so an attacker cannot use lockout to burn the free plan's daily write budget.
 */
import { newPublicId } from "../../core/ids";
import { signChallenge } from "../../core/two-factor/challenge";
import { requiresTwoFactor } from "../../core/two-factor/policy";
import { hashPassword, needsRehash, verifyPassword } from "../../core/passwords";
import { IDLE_DAYS, SESSION_DAYS } from "../../core/session-cookies";
import { ACCESS_TTL_SECONDS, newRefreshToken, sha256Hex, signAccessToken, type RoleClaim } from "../../core/tokens";
import { normaliseEmail } from "../accounts/service";

export const EMAIL_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 30;
export const LOCKOUT_WINDOW_MINUTES = 15;
/** A second use of the previous refresh token this soon is two tabs racing, not theft. */
export const REFRESH_GRACE_SECONDS = 20;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface Deps {
  db: D1Database;
  sessionSecret: string;
}

export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
}

export interface Tokens {
  user: PublicUser;
  roles: RoleClaim[];
  accessToken: string;
  refreshToken: string;
}

export interface RoleRow {
  role: string;
  scope_type: RoleClaim["scope"];
  section_key: string | null;
}

export const toClaims = (rows: RoleRow[]): RoleClaim[] =>
  rows.map((r) => ({ role: r.role, scope: r.scope_type, ...(r.section_key ? { section: r.section_key } : {}) }));

// Checked against when the email is unknown, so an unknown email takes as long as a wrong password.
let dummyHash: string | undefined;
const timingHash = (): string => (dummyHash ??= hashPassword("this-is-not-anybody's-password"));

export async function issueAccessToken(deps: Deps, user: PublicUser, sessionId: string, roles: RoleClaim[], now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return signAccessToken(deps.sessionSecret, { sub: user.id, sid: sessionId, name: user.fullName, roles, iat, exp: iat + ACCESS_TTL_SECONDS });
}

// --- sign in ---------------------------------------------------------------------------------

/**
 * A finished sign-in (`Tokens`), or the password was right but a second step is still needed: enter
 * the code from the authenticator app (`required`), or set the app up first (`setup`). The
 * `challenge` is a short-lived token for that step; it is not a session.
 */
export type SignInResult =
  | ({ ok: true; twoFactor?: undefined } & Tokens)
  | { ok: true; twoFactor: "required" | "setup"; challenge: string }
  | { ok: false; reason: "invalid_credentials" | "throttled" };

/** A new session row for a user, and the refresh token that goes in their cookie. */
export async function newSession(db: D1Database, input: { userId: number; ip: string | null; userAgent: string | null; now: Date }) {
  const sessionId = newPublicId();
  const refreshToken = newRefreshToken();
  const statement = db
    .prepare("INSERT INTO sessions (public_id, user_id, refresh_hash, created_at, last_used_at, expires_at, ip, user_agent) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)")
    .bind(sessionId, input.userId, await sha256Hex(refreshToken), input.now.toISOString(), new Date(input.now.getTime() + SESSION_DAYS * DAY).toISOString(), input.ip, input.userAgent);
  return { sessionId, refreshToken, statement };
}

export interface SignInInput {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

interface UserRow {
  id: number;
  public_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: number;
}

export async function signIn(deps: Deps, input: SignInInput, now: Date = new Date()): Promise<SignInResult> {
  const { db } = deps;
  const email = normaliseEmail(input.email);
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * MINUTE).toISOString();
  const userAgent = input.userAgent?.slice(0, 300) ?? null;

  const [userResult, emailFailures, ipFailures, roleResult, twoFactorResult] = await db.batch([
    db.prepare("SELECT id, public_id, email, password_hash, full_name, is_active FROM users WHERE email = ?1").bind(email),
    db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE success = 0 AND email_tried = ?1 AND at > ?2").bind(email, since),
    // Without an address we cannot count by address, so that limit is skipped, not shared.
    db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE success = 0 AND ip = ?1 AND at > ?2").bind(input.ip ?? "", since),
    db
      .prepare(
        `SELECT ra.role, ra.scope_type, s.key AS section_key
           FROM role_assignments ra
           JOIN users u ON u.id = ra.user_id
           LEFT JOIN sections s ON s.id = ra.section_id
          WHERE u.email = ?1 AND ra.is_active = 1
          ORDER BY ra.id`,
      )
      .bind(email),
    db.prepare("SELECT enabled_at FROM user_two_factor WHERE user_id = (SELECT id FROM users WHERE email = ?1)").bind(email),
  ]);

  const failuresForEmail = (emailFailures!.results[0] as { n: number }).n;
  const failuresForIp = input.ip ? (ipFailures!.results[0] as { n: number }).n : 0;
  if (failuresForEmail >= EMAIL_FAILURE_LIMIT || failuresForIp >= IP_FAILURE_LIMIT) {
    return { ok: false, reason: "throttled" }; // no hashing and no write
  }

  const user = userResult!.results[0] as unknown as UserRow | undefined;
  const usable = user !== undefined && user.is_active === 1;

  const passwordOk = usable ? verifyPassword(input.password, user.password_hash) : (verifyPassword(input.password, timingHash()), false);

  const recordEvent = (success: boolean, reason: string | null) =>
    db
      .prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(now.toISOString(), user?.id ?? null, email.slice(0, 254), success ? 1 : 0, reason, input.ip, userAgent);

  if (!usable || !passwordOk) {
    await recordEvent(false, !user ? "unknown_user" : !usable ? "inactive" : "bad_password").run();
    return { ok: false, reason: "invalid_credentials" };
  }

  const roles = toClaims(roleResult!.results as unknown as RoleRow[]);
  const publicUser: PublicUser = { id: user.public_id, fullName: user.full_name, email: user.email };

  // The password is right. If a second step is needed, no session yet: hand back a challenge instead.
  const twoFactorEnabled = (twoFactorResult!.results[0] as { enabled_at: string | null } | undefined)?.enabled_at != null;
  const nextStep = twoFactorEnabled ? "required" : requiresTwoFactor(roles) ? "setup" : null;
  if (nextStep) {
    const pending = [recordEvent(true, `password_ok_two_factor_${nextStep}`)];
    // The password is in hand, so a hash made with weaker settings is replaced with today's.
    if (needsRehash(user.password_hash)) pending.push(db.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(hashPassword(input.password), user.id));
    await db.batch(pending);
    const challenge = await signChallenge(deps.sessionSecret, { sub: user.public_id, kind: nextStep === "required" ? "verify" : "setup" });
    return { ok: true, twoFactor: nextStep, challenge };
  }

  const { sessionId, refreshToken, statement: sessionStatement } = await newSession(db, { userId: user.id, ip: input.ip, userAgent, now });
  const statements = [
    sessionStatement,
    recordEvent(true, null),
    db.prepare("UPDATE users SET last_login_at = ?1, failed_login_count = 0 WHERE id = ?2").bind(now.toISOString(), user.id),
  ];
  // A hash made with weaker settings is replaced with today's, now that we hold the password.
  if (needsRehash(user.password_hash)) {
    statements.push(db.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(hashPassword(input.password), user.id));
  }
  await db.batch(statements);

  return { ok: true, user: publicUser, roles, refreshToken, accessToken: await issueAccessToken(deps, publicUser, sessionId, roles, now) };
}

// --- refresh ---------------------------------------------------------------------------------

export type RefreshResult = ({ ok: true } & Tokens) | { ok: false; reason: "invalid" | "in_progress" };

interface SessionRow {
  id: number;
  public_id: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_public_id: string;
  full_name: string;
  email: string;
  is_active: number;
}

/** Swaps a valid refresh token for a new pair, rotating the refresh token. */
export async function refreshSession(deps: Deps, refreshToken: string, now: Date = new Date()): Promise<RefreshResult> {
  const { db } = deps;
  const hash = await sha256Hex(refreshToken);

  const [sessionResult, roleResult] = await db.batch([
    db
      .prepare(
        `SELECT s.id, s.public_id, s.last_used_at, s.expires_at, s.revoked_at,
                u.public_id AS user_public_id, u.full_name, u.email, u.is_active
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.refresh_hash = ?1`,
      )
      .bind(hash),
    db
      .prepare(
        `SELECT ra.role, ra.scope_type, sec.key AS section_key
           FROM role_assignments ra LEFT JOIN sections sec ON sec.id = ra.section_id
          WHERE ra.is_active = 1 AND ra.user_id = (SELECT user_id FROM sessions WHERE refresh_hash = ?1)
          ORDER BY ra.id`,
      )
      .bind(hash),
  ]);

  const session = sessionResult!.results[0] as unknown as SessionRow | undefined;

  if (!session) return handleUnknownToken(deps, hash, now);
  if (session.revoked_at) return { ok: false, reason: "invalid" };

  const nowIso = now.toISOString();
  const idleLimit = new Date(new Date(session.last_used_at).getTime() + IDLE_DAYS * DAY).toISOString();
  if (session.expires_at <= nowIso || idleLimit <= nowIso) return { ok: false, reason: "invalid" };

  if (session.is_active !== 1) {
    await revoke(db, session.id, "user_inactive", now);
    return { ok: false, reason: "invalid" };
  }

  // Rotate. The condition makes a second simultaneous refresh lose instead of both succeeding.
  const newToken = newRefreshToken();
  const rotated = await db
    .prepare(
      `UPDATE sessions SET previous_refresh_hash = refresh_hash, refresh_hash = ?1, last_used_at = ?2
        WHERE id = ?3 AND refresh_hash = ?4 AND revoked_at IS NULL`,
    )
    .bind(await sha256Hex(newToken), nowIso, session.id, hash)
    .run();
  if (rotated.meta.changes !== 1) return { ok: false, reason: "in_progress" };

  const user: PublicUser = { id: session.user_public_id, fullName: session.full_name, email: session.email };
  const roles = toClaims(roleResult!.results as unknown as RoleRow[]);
  return { ok: true, user, roles, refreshToken: newToken, accessToken: await issueAccessToken(deps, user, session.public_id, roles, now) };
}

/**
 * An unknown refresh token is either garbage, or an old token used again. An old token used a
 * moment after rotation is two tabs racing. Used later, it means someone else has a copy, so the
 * whole session is revoked.
 */
async function handleUnknownToken(deps: Deps, hash: string, now: Date): Promise<RefreshResult> {
  const previous = await deps.db
    .prepare("SELECT id, last_used_at, revoked_at FROM sessions WHERE previous_refresh_hash = ?1")
    .bind(hash)
    .first<{ id: number; last_used_at: string; revoked_at: string | null }>();

  if (!previous || previous.revoked_at) return { ok: false, reason: "invalid" };

  const ageSeconds = (now.getTime() - new Date(previous.last_used_at).getTime()) / 1000;
  if (ageSeconds < REFRESH_GRACE_SECONDS) return { ok: false, reason: "in_progress" };

  await revoke(deps.db, previous.id, "refresh_token_reuse", now);
  return { ok: false, reason: "invalid" };
}

async function revoke(db: D1Database, sessionId: number, reason: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = ?1, revoked_reason = ?2 WHERE id = ?3 AND revoked_at IS NULL")
    .bind(now.toISOString(), reason, sessionId)
    .run();
}

// --- sign out --------------------------------------------------------------------------------

/** Ends the session that owns this refresh token. Harmless if there is none. */
export async function signOut(deps: Deps, refreshToken: string | undefined, now: Date = new Date()): Promise<void> {
  if (!refreshToken) return;
  await deps.db
    .prepare("UPDATE sessions SET revoked_at = ?1, revoked_reason = 'sign_out' WHERE refresh_hash = ?2 AND revoked_at IS NULL")
    .bind(now.toISOString(), await sha256Hex(refreshToken))
    .run();
}
