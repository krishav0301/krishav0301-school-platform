import { recordAudit } from "../../core/audit";
import { adToBsText, nepalDate, nepalTime } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { sha256Hex } from "../../core/tokens";
import { DeviceNameSchema } from "./schema";

export type DeviceResult = { ok: true; id: string; name: string; key: string } | { ok: false; reason: "not_allowed" } | { ok: false; reason: "invalid"; message: string };

/** An active Admin or Super Admin, from the database, inside every write (D-021). `?${a}` is the actor's public id. */
const actorMayManage = (a: number): string =>
  `EXISTS (SELECT 1 FROM users mu JOIN role_assignments ma ON ma.user_id = mu.id WHERE mu.public_id = ?${a} AND mu.is_active = 1 AND ma.is_active = 1 AND ma.role IN ('admin', 'super_admin'))`;

const base64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The hash a key is stored as. The key itself is never stored. */
export const hashKey = (key: string): Promise<string> => sha256Hex(`gate-key:${key}`);

/**
 * Registers a gate computer (D-175). The answer carries its secret key, shown to the Admin once and never again; only a
 * hash is kept. The device gets its own system user, switched off with no role, so it can never sign in; it exists so
 * the attendance the device marks says who marked it. One audited batch, the actor checked again inside it.
 */
export async function registerDevice(db: D1Database, auditKey: string, actor: string, input: unknown, now = new Date()): Promise<DeviceResult> {
  const parsed = DeviceNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const name = parsed.data.name;
  const deviceId = newPublicId();
  const userId = newPublicId();
  const key = `gk_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const keyHash = await hashKey(key);
  const at = now.toISOString();

  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "gate.device_registered",
      entityType: "gate_device",
      entityPublicId: deviceId,
      actorPublicId: actor,
      summary: `Gate computer "${name}" registered`,
      after: { name },
    },
    [
      // An unusable password and a switched-off account: this user can never sign in.
      db
        .prepare(`INSERT INTO users (public_id, email, password_hash, full_name, is_active) SELECT ?1, ?2, '!', ?3, 0 WHERE ${actorMayManage(4)}`)
        .bind(userId, `gate-${userId}@gate.invalid`, name, actor),
      // Last: it changes a row only if the device was made, which is what decides whether the audit entry is written.
      db
        .prepare(
          `INSERT INTO gate_devices (public_id, name, key_hash, user_id, created_at, created_by_user_id)
           SELECT ?1, ?2, ?3, u.id, ?4, a.id FROM users u, users a WHERE u.public_id = ?5 AND a.public_id = ?6 AND ${actorMayManage(6)}`,
        )
        .bind(deviceId, name, keyHash, at, userId, actor),
    ],
    { onlyIfLastChanged: true },
  );
  return applied ? { ok: true, id: deviceId, name, key } : { ok: false, reason: "not_allowed" };
}

export async function listDevices(db: D1Database) {
  const { results } = await db
    .prepare("SELECT public_id, name, status, created_at, last_seen_at FROM gate_devices ORDER BY id DESC")
    .all<{ public_id: string; name: string; status: "active" | "revoked"; created_at: string; last_seen_at: string | null }>();
  return {
    devices: results.map((d) => ({
      id: d.public_id,
      name: d.name,
      status: d.status,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      lastSeenOnBs: d.last_seen_at ? adToBsText(nepalDate(new Date(d.last_seen_at))) : null,
      lastSeenTime: d.last_seen_at ? nepalTime(new Date(d.last_seen_at)) : null,
    })),
  };
}

/** Revokes a device for good; its key stops working at once. Revoking a device already revoked finds nothing. */
export async function revokeDevice(db: D1Database, auditKey: string, actor: string, id: string, now = new Date()): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const row = await db.prepare("SELECT name FROM gate_devices WHERE public_id = ?1 AND status = 'active'").bind(id).first<{ name: string }>();
  if (!row) return { ok: false, reason: "not_found" };
  const { applied } = await recordAudit(
    db,
    auditKey,
    { action: "gate.device_revoked", entityType: "gate_device", entityPublicId: id, actorPublicId: actor, summary: `Gate computer "${row.name}" revoked` },
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

/** The active device a key belongs to, or null. */
export async function deviceByKey(db: D1Database, key: string): Promise<{ id: number; userId: number; name: string } | null> {
  if (!/^gk_[A-Za-z0-9_-]{20,80}$/.test(key)) return null;
  const row = await db.prepare("SELECT id, user_id, name FROM gate_devices WHERE key_hash = ?1 AND status = 'active'").bind(await hashKey(key)).first<{ id: number; user_id: number; name: string }>();
  return row ? { id: row.id, userId: row.user_id, name: row.name } : null;
}
