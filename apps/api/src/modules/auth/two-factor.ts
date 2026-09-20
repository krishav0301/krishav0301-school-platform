/**
 * Two-step sign-in with an authenticator app (D-033).
 *
 * The flow: sign-in checks the password, and if a second step is needed returns a short-lived
 * challenge instead of a session (see `signIn`). The challenge is then exchanged here, either for a
 * session (`verifyTwoFactor`, when the person already has the app) or after first setting the app up
 * (`beginTwoFactorSetup`, then `enableTwoFactor`).
 *
 * Rules that matter:
 *  - A code works once. The newest accepted time step is remembered and claimed with a conditional
 *    update, so a code seen once cannot be replayed, and two simultaneous submissions cannot both win.
 *  - Wrong codes count toward the same lockout as wrong passwords (5 an email per 15 minutes), and a
 *    throttled attempt writes nothing.
 *  - The secret is stored sealed, bound to the person, so a copy of the table cannot make codes and a
 *    sealed secret copied to another row will not open.
 *  - Recovery codes are ten single-use codes, stored as hashes; using one is written to the audit log.
 */
import { recordAudit } from "../../core/audit";
import { open, seal } from "../../core/crypto-box";
import { verifyChallenge } from "../../core/two-factor/challenge";
import { hashRecoveryCode, newRecoveryCodes, normaliseRecoveryCode } from "../../core/two-factor/recovery";
import { newTotpSecret, otpauthUri, verifyTotp } from "../../core/two-factor/totp";
import type { RoleClaim } from "../../core/tokens";
import { EMAIL_FAILURE_LIMIT, LOCKOUT_WINDOW_MINUTES, issueAccessToken, newSession, toClaims, type PublicUser, type RoleRow, type Tokens } from "./service";

export interface TwoFactorDeps {
  db: D1Database;
  sessionSecret: string;
  /** Seals the secret. */
  dataKey: string;
  auditKey: string;
}

export interface StepInput {
  challenge: string;
  code: string;
  ip: string | null;
  userAgent: string | null;
}

const MINUTE = 60_000;
const sealPurpose = (publicId: string) => `totp:${publicId}`;

interface Person {
  id: number;
  publicId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: RoleClaim[];
  secretSealed: string | null;
  enabledAt: string | null;
  lastUsedStep: number;
  failures: number;
  schoolName: string;
}

/** Everything the second step needs to know about the person, in one round trip. */
async function loadPerson(db: D1Database, publicId: string, now: Date): Promise<Person | null> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * MINUTE).toISOString();
  const [userResult, roleResult, failureResult, schoolResult] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.public_id, u.email, u.full_name, u.is_active, tf.secret_sealed, tf.enabled_at, tf.last_used_step
           FROM users u LEFT JOIN user_two_factor tf ON tf.user_id = u.id
          WHERE u.public_id = ?1`,
      )
      .bind(publicId),
    db
      .prepare(
        `SELECT ra.role, ra.scope_type, s.key AS section_key
           FROM role_assignments ra JOIN users u ON u.id = ra.user_id LEFT JOIN sections s ON s.id = ra.section_id
          WHERE u.public_id = ?1 AND ra.is_active = 1 ORDER BY ra.id`,
      )
      .bind(publicId),
    db
      .prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE success = 0 AND at > ?2 AND email_tried = (SELECT email FROM users WHERE public_id = ?1)")
      .bind(publicId, since),
    db.prepare("SELECT name FROM school WHERE id = 1"),
  ]);

  const row = userResult!.results[0] as
    | { id: number; public_id: string; email: string; full_name: string; is_active: number; secret_sealed: string | null; enabled_at: string | null; last_used_step: number | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    email: row.email,
    fullName: row.full_name,
    isActive: row.is_active === 1,
    roles: toClaims(roleResult!.results as unknown as RoleRow[]),
    secretSealed: row.secret_sealed,
    enabledAt: row.enabled_at,
    lastUsedStep: row.last_used_step ?? 0,
    failures: (failureResult!.results[0] as { n: number }).n,
    schoolName: (schoolResult!.results[0] as { name: string } | undefined)?.name ?? "School",
  };
}

const recordFailure = (db: D1Database, person: Person, input: Pick<StepInput, "ip" | "userAgent">, now: Date) =>
  db
    .prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, ?2, ?3, 0, 'two_factor_failed', ?4, ?5)")
    .bind(now.toISOString(), person.id, person.email, input.ip, input.userAgent?.slice(0, 300) ?? null);

/** The statements that complete a sign-in: the session, the log entry, the last-login time. */
async function completeSignIn(db: D1Database, person: Person, input: Pick<StepInput, "ip" | "userAgent">, now: Date) {
  const userAgent = input.userAgent?.slice(0, 300) ?? null;
  const { sessionId, refreshToken, statement } = await newSession(db, { userId: person.id, ip: input.ip, userAgent, now });
  return {
    sessionId,
    refreshToken,
    statements: [
      statement,
      db
        .prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, ?2, ?3, 1, NULL, ?4, ?5)")
        .bind(now.toISOString(), person.id, person.email, input.ip, userAgent),
      db.prepare("UPDATE users SET last_login_at = ?1, failed_login_count = 0 WHERE id = ?2").bind(now.toISOString(), person.id),
    ],
  };
}

async function tokensFor(deps: TwoFactorDeps, person: Person, sessionId: string, refreshToken: string, now: Date): Promise<Tokens> {
  const user: PublicUser = { id: person.publicId, fullName: person.fullName, email: person.email };
  return { user, roles: person.roles, refreshToken, accessToken: await issueAccessToken({ db: deps.db, sessionSecret: deps.sessionSecret }, user, sessionId, person.roles, now) };
}

// --- the second step, for someone who already has the app -----------------------------------

export type VerifyResult = ({ ok: true } & Tokens) | { ok: false; reason: "invalid_challenge" | "invalid_code" | "throttled" };

export async function verifyTwoFactor(deps: TwoFactorDeps, input: StepInput, now: Date = new Date()): Promise<VerifyResult> {
  const { db } = deps;
  const challenge = await verifyChallenge(deps.sessionSecret, input.challenge, Math.floor(now.getTime() / 1000));
  if (!challenge || challenge.kind !== "verify") return { ok: false, reason: "invalid_challenge" };

  const person = await loadPerson(db, challenge.sub, now);
  if (!person || !person.isActive || !person.secretSealed || !person.enabledAt) return { ok: false, reason: "invalid_challenge" };
  if (person.failures >= EMAIL_FAILURE_LIMIT) return { ok: false, reason: "throttled" }; // no work, no write

  const fail = async (): Promise<VerifyResult> => {
    await recordFailure(db, person, input, now).run();
    return { ok: false, reason: "invalid_code" };
  };

  const typed = input.code.trim();
  let usedRecoveryCode = false;

  if (/^[\d\s]+$/.test(typed)) {
    const secret = await open(deps.dataKey, person.secretSealed, sealPurpose(person.publicId));
    const step = secret === null ? null : verifyTotp(secret, typed, now.getTime());
    if (step === null || step <= person.lastUsedStep) return fail();

    // Claim the time step. Only one caller can move the newest-used step forward to this value.
    const claim = await db.prepare("UPDATE user_two_factor SET last_used_step = ?1 WHERE user_id = ?2 AND last_used_step < ?1").bind(step, person.id).run();
    if (claim.meta.changes !== 1) return fail();
  } else {
    if (!normaliseRecoveryCode(typed)) return fail();
    const claim = await db
      .prepare("UPDATE two_factor_recovery_codes SET used_at = ?1 WHERE user_id = ?2 AND code_hash = ?3 AND used_at IS NULL")
      .bind(now.toISOString(), person.id, await hashRecoveryCode(typed))
      .run();
    if (claim.meta.changes !== 1) return fail();
    usedRecoveryCode = true;
  }

  const { sessionId, refreshToken, statements } = await completeSignIn(db, person, input, now);
  if (usedRecoveryCode) {
    await recordAudit(
      db,
      deps.auditKey,
      { action: "accounts.two_factor.recovery_code_used", entityType: "user", entityPublicId: person.publicId, actorUserId: person.id, summary: "Signed in with a recovery code" },
      statements,
    );
  } else {
    await db.batch(statements);
  }
  return { ok: true, ...(await tokensFor(deps, person, sessionId, refreshToken, now)) };
}

// --- setting the app up ----------------------------------------------------------------------

export type SetupResult = { ok: true; secret: string; otpauthUri: string } | { ok: false; reason: "invalid_challenge" | "already_enabled" };

/** Makes a new secret for the person (replacing an unconfirmed one) and returns it to show once. */
export async function beginTwoFactorSetup(deps: TwoFactorDeps, input: { challenge: string }, now: Date = new Date()): Promise<SetupResult> {
  const { db } = deps;
  const challenge = await verifyChallenge(deps.sessionSecret, input.challenge, Math.floor(now.getTime() / 1000));
  if (!challenge || challenge.kind !== "setup") return { ok: false, reason: "invalid_challenge" };

  const person = await loadPerson(db, challenge.sub, now);
  if (!person || !person.isActive) return { ok: false, reason: "invalid_challenge" };
  if (person.enabledAt) return { ok: false, reason: "already_enabled" };

  const secret = newTotpSecret();
  // Never overwrites a confirmed secret: the update applies only while it is still unconfirmed.
  const saved = await db
    .prepare(
      `INSERT INTO user_two_factor (user_id, secret_sealed, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id) DO UPDATE SET secret_sealed = excluded.secret_sealed, created_at = excluded.created_at
        WHERE user_two_factor.enabled_at IS NULL`,
    )
    .bind(person.id, await seal(deps.dataKey, secret, sealPurpose(person.publicId)), now.toISOString())
    .run();
  if (saved.meta.changes !== 1) return { ok: false, reason: "already_enabled" };

  return { ok: true, secret, otpauthUri: otpauthUri({ secret, account: person.email, issuer: person.schoolName }) };
}

export type EnableResult = ({ ok: true; recoveryCodes: string[] } & Tokens) | { ok: false; reason: "invalid_challenge" | "invalid_code" | "no_setup" | "throttled" };

/** Confirms the first code, turns two-step sign-in on, and signs the person in. */
export async function enableTwoFactor(deps: TwoFactorDeps, input: StepInput, now: Date = new Date()): Promise<EnableResult> {
  const { db } = deps;
  const challenge = await verifyChallenge(deps.sessionSecret, input.challenge, Math.floor(now.getTime() / 1000));
  if (!challenge || challenge.kind !== "setup") return { ok: false, reason: "invalid_challenge" };

  const person = await loadPerson(db, challenge.sub, now);
  if (!person || !person.isActive) return { ok: false, reason: "invalid_challenge" };
  if (!person.secretSealed || person.enabledAt) return { ok: false, reason: "no_setup" };
  if (person.failures >= EMAIL_FAILURE_LIMIT) return { ok: false, reason: "throttled" };

  const secret = await open(deps.dataKey, person.secretSealed, sealPurpose(person.publicId));
  const step = secret === null ? null : verifyTotp(secret, input.code, now.getTime());
  if (step === null) {
    await recordFailure(db, person, input, now).run();
    return { ok: false, reason: "invalid_code" };
  }

  const recoveryCodes = newRecoveryCodes();
  const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
  const enabledAt = now.toISOString();
  const { sessionId, refreshToken, statements: signInStatements } = await completeSignIn(db, person, input, now);

  await recordAudit(
    db,
    deps.auditKey,
    { action: "accounts.two_factor.enabled", entityType: "user", entityPublicId: person.publicId, actorUserId: person.id, summary: "Two-step sign-in turned on" },
    [
      db.prepare("UPDATE user_two_factor SET enabled_at = ?1, last_used_step = ?2 WHERE user_id = ?3 AND enabled_at IS NULL").bind(enabledAt, step, person.id),
      ...hashes.map((hash) =>
        db
          .prepare("INSERT INTO two_factor_recovery_codes (user_id, code_hash) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM user_two_factor WHERE user_id = ?1 AND enabled_at = ?3)")
          .bind(person.id, hash, enabledAt),
      ),
      ...signInStatements,
    ],
  );
  return { ok: true, recoveryCodes, ...(await tokensFor(deps, person, sessionId, refreshToken, now)) };
}

