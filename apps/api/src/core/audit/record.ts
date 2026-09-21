import { GENESIS_HASH, hashEvent, toStored, type AuditFields } from "./chain";

/**
 * What to record. Name the actor by `actorUserId` (the integer) or, more conveniently, by
 * `actorPublicId` (what the signed-in session knows). The public id is looked up in the same
 * round trip that reads the chain head, so it costs nothing extra.
 */
export type AuditEventInput = Omit<AuditFields, "at"> & { actorPublicId?: string };

const MAX_ATTEMPTS = 40;
const CONTENTION = /audit chain moved|UNIQUE constraint failed: audit_events\.(prev_hash|hash)/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Appends an audit entry, in the same batch as the business change it describes, so either both
 * happen or neither does.
 *
 * The entry links to the newest entry it saw. If another request appended in between, the
 * database refuses the whole batch (the business change rolls back too) and this retries with the
 * new head. Pass `businessStatements` unchanged on every attempt; they were rolled back, so
 * running them again is safe.
 *
 * `onlyIfLastChanged`: write the entry only if the LAST business statement changed a row (SQLite's
 * `changes()`). For a conditional change (`UPDATE ... WHERE status = 'draft' AND <still allowed>`), a
 * lost race or a failed re-check changes nothing, so nothing is recorded, and `applied` is false. The
 * caller puts the statement that decides last; earlier statements in the batch are not undone.
 *
 * Cost: one read of the chain head (and the actor, if named by public id), then one batch: two
 * round trips.
 */
export async function recordAudit(
  db: D1Database,
  key: string,
  event: AuditEventInput,
  businessStatements: D1PreparedStatement[] = [],
  options: { onlyIfLastChanged?: boolean } = {},
): Promise<{ hash: string; applied: boolean }> {
  const { actorPublicId, ...rest } = event;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reads = [db.prepare("SELECT last_hash FROM audit_chain_head WHERE id = 1")];
    if (actorPublicId) reads.push(db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(actorPublicId));
    const [headResult, actorResult] = await db.batch(reads);

    const prevHash = (headResult!.results[0] as { last_hash: string } | undefined)?.last_hash ?? GENESIS_HASH;
    let actorUserId = rest.actorUserId ?? null;
    if (actorPublicId) {
      const found = (actorResult!.results[0] as { id: number } | undefined)?.id;
      if (found === undefined) throw new Error("Cannot record an audit entry for an actor that does not exist.");
      actorUserId = found;
    }

    const fields: AuditFields = { ...rest, actorUserId, at: new Date().toISOString() };
    const stored = toStored(fields);
    const hash = await hashEvent(key, prevHash, fields);

    const columns = `(at, actor_user_id, action, entity_type, entity_public_id, summary,
            before_json, after_json, reason, request_id, prev_hash, hash)`;
    const insert = db
      .prepare(
        options.onlyIfLastChanged
          ? `INSERT INTO audit_events ${columns} SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE changes() > 0`
          : `INSERT INTO audit_events ${columns} VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        stored.at, stored.actorUserId, stored.action, stored.entityType, stored.entityPublicId, stored.summary,
        stored.beforeJson, stored.afterJson, stored.reason, stored.requestId, prevHash, hash,
      );

    try {
      const results = await db.batch([...businessStatements, insert]);
      const applied = !options.onlyIfLastChanged || (results[results.length - 1]!.meta.changes ?? 0) > 0;
      return { hash, applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!CONTENTION.test(message)) throw error;
      await sleep(Math.random() * 10 * Math.min(attempt, 5));
    }
  }
  throw new Error("The audit log is too busy: could not append after several attempts.");
}
