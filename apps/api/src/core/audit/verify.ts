import { GENESIS_HASH, hashStored, type StoredFields } from "./chain";

interface Row {
  id: number;
  at: string;
  actor_user_id: number | null;
  action: string;
  entity_type: string;
  entity_public_id: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  request_id: string | null;
  prev_hash: string;
  hash: string;
}

export type VerifyResult =
  | { ok: true; count: number; lastHash: string }
  | { ok: false; brokenAtId: number | null; reason: string };

const stored = (row: Row): StoredFields => ({
  at: row.at,
  actorUserId: row.actor_user_id,
  action: row.action,
  entityType: row.entity_type,
  entityPublicId: row.entity_public_id,
  summary: row.summary,
  beforeJson: row.before_json,
  afterJson: row.after_json,
  reason: row.reason,
  requestId: row.request_id,
});

/** Walks the whole chain, recomputing every hash with the secret key. */
export async function verifyAuditChain(db: D1Database, key: string): Promise<VerifyResult> {
  // One round trip for both reads.
  const [entries, headRows] = await db.batch([
    db.prepare("SELECT * FROM audit_events ORDER BY id"),
    db.prepare("SELECT last_id, last_hash FROM audit_chain_head WHERE id = 1"),
  ]);
  const rows = entries!.results as unknown as Row[];
  const head = headRows!.results[0] as unknown as { last_id: number; last_hash: string } | undefined;

  let prev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prev_hash !== prev) return { ok: false, brokenAtId: row.id, reason: "link broken" };
    const expected = await hashStored(key, prev, stored(row));
    if (expected !== row.hash) return { ok: false, brokenAtId: row.id, reason: "hash mismatch" };
    prev = row.hash;
  }

  const lastId = rows.at(-1)?.id ?? 0;
  if (!head || head.last_hash !== prev || head.last_id !== lastId) {
    return { ok: false, brokenAtId: null, reason: "head does not match the last entry" };
  }
  return { ok: true, count: rows.length, lastHash: prev };
}

/** Small enough to store elsewhere every day. */
export interface ChainSummary {
  lastId: number;
  lastHash: string;
  count: number;
}

export async function auditChainSummary(db: D1Database): Promise<ChainSummary> {
  const [head, count] = await db.batch<{ last_id: number; last_hash: string } | { n: number }>([
    db.prepare("SELECT last_id, last_hash FROM audit_chain_head WHERE id = 1"),
    db.prepare("SELECT COUNT(*) AS n FROM audit_events"),
  ]);
  const h = head!.results[0] as { last_id: number; last_hash: string };
  const c = count!.results[0] as { n: number };
  return { lastId: h.last_id, lastHash: h.last_hash, count: c.n };
}

/**
 * Compares the log with a summary exported earlier. Catches what the chain alone cannot: newest
 * entries deleted together with the head. Also runs the full verification.
 */
export async function checkAgainstExport(db: D1Database, key: string, exported: ChainSummary): Promise<VerifyResult> {
  if (exported.lastId > 0) {
    const row = await db.prepare("SELECT hash FROM audit_events WHERE id = ?1").bind(exported.lastId).first<{ hash: string }>();
    if (!row) return { ok: false, brokenAtId: exported.lastId, reason: "entries were removed since the export" };
    if (row.hash !== exported.lastHash) return { ok: false, brokenAtId: exported.lastId, reason: "an exported entry was altered" };
  }
  return verifyAuditChain(db, key);
}
