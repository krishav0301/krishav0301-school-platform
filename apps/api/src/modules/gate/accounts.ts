import { recordAudit } from "../../core/audit";
import { open, seal } from "../../core/crypto-box";
import { adToBsText, nepalDate, nepalTime } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { hashPassword } from "../../core/passwords";
import { newTotpSecret, otpauthUri } from "../../core/two-factor/totp";
import { newGateId, newGatePassword } from "./keys";
import { AccountNameSchema } from "./schema";

/** What the Admin is shown once when an account is made or given a new login. */
export interface IssuedLogin {
  id: string;
  name: string;
  gateId: string;
  password: string;
  /** The authenticator's setup key and the address that makes its QR code. */
  authenticator: { secret: string; uri: string };
}

export type AccountResult = ({ ok: true } & IssuedLogin) | { ok: false; reason: "not_allowed" | "not_found" } | { ok: false; reason: "invalid"; message: string };
export type Done = { ok: true } | { ok: false; reason: "not_found" };

/** An active Admin or Super Admin, from the database, inside every write (D-021). `?${a}` is the actor's public id. */
export const actorMayManage = (a: number): string =>
  `EXISTS (SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id WHERE mu.public_id = ?${a} AND mu.is_active = 1 AND ma.is_active = 1 AND ma.role IN ('admin', 'super_admin'))`;

export const sealPurpose = (publicId: string): string => `gate-totp:${publicId}`;

async function schoolName(db: D1Database): Promise<string> {
  return (await db.prepare("SELECT name FROM school WHERE id = 1").first<{ name: string }>())?.name ?? "School";
}

/**
 * Makes a gate account (D-176): a special ID, a password and an authenticator, all made here and shown once. Any number of
 * computers can sign in with it. It also makes the account's system user (switched off, no role) so the attendance its
 * computers mark says who marked it. One audited batch, the actor checked again inside it. The password is stored as a
 * hash, the authenticator's secret sealed; neither is ever in the audit entry or a log.
 */
export async function createAccount(db: D1Database, auditKey: string, dataKey: string, actor: string, input: unknown, now = new Date()): Promise<AccountResult> {
  const parsed = AccountNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const name = parsed.data.name;

  for (let attempt = 0; attempt < 5; attempt++) {
    const publicId = newPublicId();
    const userId = newPublicId();
    const gateId = newGateId();
    const password = newGatePassword();
    const secret = newTotpSecret();
    const sealed = await seal(dataKey, secret, sealPurpose(publicId));
    try {
      const { applied } = await recordAudit(
        db,
        auditKey,
        {
          action: "gate.account_created",
          entityType: "gate_account",
          entityPublicId: publicId,
          actorPublicId: actor,
          summary: `Gate account "${name}" created (${gateId})`,
          after: { name, gateId },
        },
        [
          db
            .prepare(`INSERT INTO users (public_id, email, password_hash, full_name, is_active) SELECT ?1, ?2, '!', ?3, 0 WHERE ${actorMayManage(4)}`)
            .bind(userId, `gate-${userId}@gate.invalid`, name, actor),
          // Last: it changes a row only if the account was made, which is what decides whether the audit entry is written.
          db
            .prepare(
              `INSERT INTO gate_accounts (public_id, gate_id, name, password_hash, secret_sealed, user_id, created_at, created_by_user_id)
               SELECT ?1, ?2, ?3, ?4, ?5, u.id, ?6, a.id FROM users u, users a WHERE u.public_id = ?7 AND a.public_id = ?8 AND ${actorMayManage(8)}`,
            )
            .bind(publicId, gateId, name, hashPassword(password), sealed, now.toISOString(), userId, actor),
        ],
        { onlyIfLastChanged: true },
      );
      if (!applied) return { ok: false, reason: "not_allowed" };
      return { ok: true, id: publicId, name, gateId, password, authenticator: { secret, uri: otpauthUri({ secret, account: gateId, issuer: await schoolName(db) }) } };
    } catch (error) {
      // A made-up ID that is already taken: make another.
      if (/UNIQUE constraint failed: gate_accounts\.gate_id/i.test(error instanceof Error ? error.message : String(error))) continue;
      throw error;
    }
  }
  throw new Error("Could not make a free gate ID");
}

/**
 * Gives an account a new password and a new authenticator, and signs every computer out of it: for a lost password, a
 * lost phone, or a person who should no longer have the login. One audited batch.
 */
export async function reissueLogin(db: D1Database, auditKey: string, dataKey: string, actor: string, id: string, now = new Date()): Promise<AccountResult> {
  const row = await db.prepare("SELECT name, gate_id FROM gate_accounts WHERE public_id = ?1 AND status = 'active'").bind(id).first<{ name: string; gate_id: string }>();
  if (!row) return { ok: false, reason: "not_found" };
  const password = newGatePassword();
  const secret = newTotpSecret();
  const sealed = await seal(dataKey, secret, sealPurpose(id));
  const at = now.toISOString();
  const { applied } = await recordAudit(
    db,
    auditKey,
    { action: "gate.login_reissued", entityType: "gate_account", entityPublicId: id, actorPublicId: actor, summary: `New login issued for gate account "${row.name}"; its computers were signed out` },
    [
      db
        .prepare(
          `UPDATE gate_devices SET status = 'revoked', revoked_at = ?2, revoked_by_user_id = (SELECT id FROM users WHERE public_id = ?3)
            WHERE status = 'active' AND account_id = (SELECT id FROM gate_accounts WHERE public_id = ?1) AND ${actorMayManage(3)}`,
        )
        .bind(id, at, actor),
      db
        .prepare(
          `UPDATE gate_accounts SET password_hash = ?2, secret_sealed = ?3, last_used_step = 0
            WHERE public_id = ?1 AND status = 'active' AND ${actorMayManage(4)}`,
        )
        .bind(id, hashPassword(password), sealed, actor),
    ],
    { onlyIfLastChanged: true },
  );
  if (!applied) return { ok: false, reason: "not_allowed" };
  return { ok: true, id, name: row.name, gateId: row.gate_id, password, authenticator: { secret, uri: otpauthUri({ secret, account: row.gate_id, issuer: await schoolName(db) }) } };
}

/** Disables an account for good: it can no longer sign in and every computer signed in with it stops at once. */
export async function disableAccount(db: D1Database, auditKey: string, actor: string, id: string, now = new Date()): Promise<Done> {
  const row = await db.prepare("SELECT name FROM gate_accounts WHERE public_id = ?1 AND status = 'active'").bind(id).first<{ name: string }>();
  if (!row) return { ok: false, reason: "not_found" };
  const at = now.toISOString();
  const { applied } = await recordAudit(
    db,
    auditKey,
    { action: "gate.account_disabled", entityType: "gate_account", entityPublicId: id, actorPublicId: actor, summary: `Gate account "${row.name}" disabled` },
    [
      db
        .prepare(
          `UPDATE gate_devices SET status = 'revoked', revoked_at = ?2, revoked_by_user_id = (SELECT id FROM users WHERE public_id = ?3)
            WHERE status = 'active' AND account_id = (SELECT id FROM gate_accounts WHERE public_id = ?1) AND ${actorMayManage(3)}`,
        )
        .bind(id, at, actor),
      db
        .prepare(
          `UPDATE gate_accounts SET status = 'disabled', disabled_at = ?2, disabled_by_user_id = (SELECT id FROM users WHERE public_id = ?3)
            WHERE public_id = ?1 AND status = 'active' AND ${actorMayManage(3)}`,
        )
        .bind(id, at, actor),
    ],
    { onlyIfLastChanged: true },
  );
  return applied ? { ok: true } : { ok: false, reason: "not_found" };
}

/** Revokes one signed-in computer; its key stops working at once. The account stays, and the computer can sign in again. */
export async function revokeComputer(db: D1Database, auditKey: string, actor: string, id: string, now = new Date()): Promise<Done> {
  const row = await db.prepare("SELECT d.label, a.name FROM gate_devices d JOIN gate_accounts a ON a.id = d.account_id WHERE d.public_id = ?1 AND d.status = 'active'").bind(id).first<{ label: string; name: string }>();
  if (!row) return { ok: false, reason: "not_found" };
  const { applied } = await recordAudit(
    db,
    auditKey,
    { action: "gate.computer_revoked", entityType: "gate_computer", entityPublicId: id, actorPublicId: actor, summary: `Gate computer "${row.label}" of "${row.name}" signed out` },
    [
      db
        .prepare(
          `UPDATE gate_devices SET status = 'revoked', revoked_at = ?2, revoked_by_user_id = (SELECT id FROM users WHERE public_id = ?3)
            WHERE public_id = ?1 AND status = 'active' AND ${actorMayManage(3)}`,
        )
        .bind(id, now.toISOString(), actor),
    ],
    { onlyIfLastChanged: true },
  );
  return applied ? { ok: true } : { ok: false, reason: "not_found" };
}

interface AccountRow {
  public_id: string;
  gate_id: string;
  name: string;
  status: "active" | "disabled";
  created_at: string;
}
interface ComputerRow {
  public_id: string;
  account: string;
  label: string;
  status: "active" | "revoked";
  created_at: string;
  last_seen_at: string | null;
}

/** The gate accounts, newest first, each with the computers signed in with it. Never a password, a secret or a key. */
export async function listAccounts(db: D1Database) {
  const [accounts, computers] = await db.batch([
    db.prepare("SELECT public_id, gate_id, name, status, created_at FROM gate_accounts ORDER BY id DESC"),
    db.prepare("SELECT d.public_id, a.public_id AS account, d.label, d.status, d.created_at, d.last_seen_at FROM gate_devices d JOIN gate_accounts a ON a.id = d.account_id ORDER BY d.id DESC"),
  ]);
  const all = computers!.results as unknown as ComputerRow[];
  return {
    accounts: (accounts!.results as unknown as AccountRow[]).map((a) => ({
      id: a.public_id,
      gateId: a.gate_id,
      name: a.name,
      status: a.status,
      createdAt: a.created_at,
      computers: all
        .filter((c) => c.account === a.public_id)
        .map((c) => ({
          id: c.public_id,
          label: c.label,
          status: c.status,
          signedInAt: c.created_at,
          lastSeenAt: c.last_seen_at,
          lastSeenOnBs: c.last_seen_at ? adToBsText(nepalDate(new Date(c.last_seen_at))) : null,
          lastSeenTime: c.last_seen_at ? nepalTime(new Date(c.last_seen_at)) : null,
        })),
    })),
  };
}

/** Opens an account's sealed authenticator secret. */
export const openSecret = (dataKey: string, publicId: string, sealed: string): Promise<string | null> => open(dataKey, sealed, sealPurpose(publicId));
