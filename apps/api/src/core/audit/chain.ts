/**
 * The audit log is a keyed hash chain (D-019). Each entry stores the hash of the previous entry,
 * and its own hash is an HMAC-SHA256 over its contents plus that link. The key is a Worker
 * secret and is never stored in the database, so someone with database access alone cannot
 * rewrite history and produce a chain that verifies.
 *
 * What this catches: an edited entry, a deleted or inserted entry in the middle, a tampered head.
 * What it cannot catch inside the database: newest entries deleted together with the head. A daily
 * export of `auditChainSummary` to a second place closes that gap (see `checkAgainstExport`).
 */

export const GENESIS_HASH = "0".repeat(64);

/** What callers provide. `before` and `after` can be any JSON-serialisable value. */
export interface AuditFields {
  at: string;
  action: string;
  entityType: string;
  entityPublicId?: string | null;
  summary: string;
  actorUserId?: number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
}

/** The exact strings stored in the database, which is what gets hashed. */
export interface StoredFields {
  at: string;
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityPublicId: string | null;
  summary: string;
  beforeJson: string | null;
  afterJson: string | null;
  reason: string | null;
  requestId: string | null;
}

export function toStored(fields: AuditFields): StoredFields {
  return {
    at: fields.at,
    actorUserId: fields.actorUserId ?? null,
    action: fields.action,
    entityType: fields.entityType,
    entityPublicId: fields.entityPublicId ?? null,
    summary: fields.summary,
    beforeJson: fields.before === undefined ? null : JSON.stringify(fields.before),
    afterJson: fields.after === undefined ? null : JSON.stringify(fields.after),
    reason: fields.reason ?? null,
    requestId: fields.requestId ?? null,
  };
}

/** A fixed order and encoding, so the same entry always hashes the same. */
function canonical(prevHash: string, s: StoredFields): string {
  return JSON.stringify([
    prevHash, s.at, s.actorUserId, s.action, s.entityType, s.entityPublicId,
    s.summary, s.beforeJson, s.afterJson, s.reason, s.requestId,
  ]);
}

const encoder = new TextEncoder();

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hashStored(key: string, prevHash: string, stored: StoredFields): Promise<string> {
  return hmacSha256Hex(key, canonical(prevHash, stored));
}

export function hashEvent(key: string, prevHash: string, fields: AuditFields): Promise<string> {
  return hashStored(key, prevHash, toStored(fields));
}
