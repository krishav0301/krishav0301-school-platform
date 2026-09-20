import { GENESIS_HASH, hashEvent, toStored, type AuditFields } from "./chain";

export type AuditEventInput = Omit<AuditFields, "at">;

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
 * Cost: one read of the chain head, then one batch: two round trips.
 */
export async function recordAudit(
  db: D1Database,
  key: string,
  event: AuditEventInput,
  businessStatements: D1PreparedStatement[] = [],
): Promise<{ hash: string }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const head = await db.prepare("SELECT last_hash FROM audit_chain_head WHERE id = 1").first<{ last_hash: string }>();
    const prevHash = head?.last_hash ?? GENESIS_HASH;
    const fields: AuditFields = { ...event, at: new Date().toISOString() };
    const stored = toStored(fields);
    const hash = await hashEvent(key, prevHash, fields);

    const insert = db
      .prepare(
        `INSERT INTO audit_events
           (at, actor_user_id, action, entity_type, entity_public_id, summary,
            before_json, after_json, reason, request_id, prev_hash, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        stored.at, stored.actorUserId, stored.action, stored.entityType, stored.entityPublicId, stored.summary,
        stored.beforeJson, stored.afterJson, stored.reason, stored.requestId, prevHash, hash,
      );

    try {
      await db.batch([...businessStatements, insert]);
      return { hash };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!CONTENTION.test(message)) throw error;
      await sleep(Math.random() * 10 * Math.min(attempt, 5));
    }
  }
  throw new Error("The audit log is too busy: could not append after several attempts.");
}
