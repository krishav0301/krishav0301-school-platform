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
  // The head and the newest entry in one snapshot: an append moves both together, so an entry past the head was put
  // there around the guards. The entries up to the head are then checked a page at a time, so memory stays flat however
  // long the log grows (D-108); an entry appended while the check runs is left for the next one.
  const [headRows, newest] = await db.batch([
    db.prepare("SELECT last_id, last_hash FROM audit_chain_head WHERE id = 1"),
    db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM audit_events"),
  ]);
  const head = headRows!.results[0] as { last_id: number; last_hash: string } | undefined;
  const lastId = head?.last_id ?? 0;
  if ((newest!.results[0] as { id: number }).id > lastId) return { ok: false, brokenAtId: null, reason: "head does not match the last entry" };
  let prev = GENESIS_HASH;
  let count = 0;
  let after = 0;
  for (;;) {
    const { results } = await db.prepare("SELECT * FROM audit_events WHERE id > ?1 AND id <= ?2 ORDER BY id LIMIT ?3").bind(after, lastId, VERIFY_PAGE).all<Row>();
    for (const row of results) {
      if (row.prev_hash !== prev) return { ok: false, brokenAtId: row.id, reason: "link broken" };
      const expected = await hashStored(key, prev, stored(row));
      if (expected !== row.hash) return { ok: false, brokenAtId: row.id, reason: "hash mismatch" };
      prev = row.hash;
      after = row.id;
      count++;
    }
    if (results.length < VERIFY_PAGE) break;
  }
  if (!head || head.last_hash !== prev || after !== lastId) {
    return { ok: false, brokenAtId: null, reason: "head does not match the last entry" };
  }
  return { ok: true, count, lastHash: prev };
}

/** How many entries a verification reads at a time. */
const VERIFY_PAGE = 500;

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
