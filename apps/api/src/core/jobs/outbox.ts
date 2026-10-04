/**
 * The outbox and its job runner (D-034).
 *
 * A change that needs a notification writes an outbox row in the SAME batch as the change, so the
 * message exists if and only if the change does. A runner then delivers it. The runner is safe to
 * run twice at once and to crash halfway:
 *  - it claims an event with a conditional update (a lease), so only one runner sends it;
 *  - a failure schedules a retry with growing delays, and after `MAX_ATTEMPTS` the event is given
 *    up on (`dead_at`) and its payload wiped;
 *  - a crashed runner's lease runs out, and the event is picked up again. Handlers must therefore
 *    be idempotent: pass `dedupeKey` on to the provider as its idempotency key.
 * Anything secret in a payload is sealed before it is written and wiped once the event is done.
 */
import { open, seal } from "../crypto-box";

export const MAX_ATTEMPTS = 6;
/** Minutes to wait after the 1st, 2nd, ... failed attempt. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 720] as const;
const LEASE_MINUTES = 2;
const DEFAULT_LIMIT = 10;
const MAX_ERROR_LENGTH = 500;
const MINUTE = 60_000;

export interface NewEvent {
  type: string;
  payload: unknown;
  /** The same key can never be queued twice. Also the idempotency key for the provider. */
  dedupeKey?: string;
  /** If set, the payload is sealed with it before being stored. */
  sealKey?: string;
  at?: Date;
}

export type Handler = (payload: unknown, event: { id: number; dedupeKey: string | null }) => Promise<void>;

async function storedPayload(event: NewEvent): Promise<string> {
  const json = JSON.stringify(event.payload);
  return event.sealKey ? JSON.stringify({ sealed: await seal(event.sealKey, json, "outbox") }) : json;
}

/** The statement that queues an event. Put it in the batch with the change that needs it. */
export async function enqueue(db: D1Database, event: NewEvent): Promise<D1PreparedStatement> {
  const at = (event.at ?? new Date()).toISOString();
  return db
    .prepare("INSERT INTO outbox_events (at, type, payload_json, next_attempt_at, dedupe_key) VALUES (?1, ?2, ?3, ?1, ?4)")
    .bind(at, event.type, await storedPayload(event), event.dedupeKey ?? null);
}

/**
 * Queues the event only if `conditionSql` returns a row. The condition uses `?5`, `?6`, ... for
 * `params` (`?1` to `?4` are taken). This lets a request that must not reveal whether an account
 * exists do the same work either way, in one round trip.
 */
export async function enqueueIf(db: D1Database, event: NewEvent, conditionSql: string, ...params: (string | number | null)[]): Promise<D1PreparedStatement> {
  const at = (event.at ?? new Date()).toISOString();
  return db
    .prepare(
      `INSERT INTO outbox_events (at, type, payload_json, next_attempt_at, dedupe_key)
       SELECT ?1, ?2, ?3, ?1, ?4 WHERE EXISTS (${conditionSql})`,
    )
    .bind(at, event.type, await storedPayload(event), event.dedupeKey ?? null, ...params);
}

export interface DrainOptions {
  /** Opens sealed payloads. */
  sealKey: string;
  now?: Date;
  limit?: number;
}

export interface DrainResult {
  processed: number;
  failed: number;
  dead: number;
}

interface DueRow {
  id: number;
  type: string;
  payload_json: string;
  dedupe_key: string | null;
}

async function readPayload(row: DueRow, sealKey: string): Promise<unknown> {
  const parsed = JSON.parse(row.payload_json) as { sealed?: string };
  if (typeof parsed.sealed !== "string") return parsed;
  const opened = await open(sealKey, parsed.sealed, "outbox");
  if (opened === null) throw new Error("The payload could not be opened (wrong key, or damaged).");
  return JSON.parse(opened);
}

/** Delivers due events. Returns how many succeeded, failed for now, and were given up on. */
export async function drainOutbox(db: D1Database, handlers: Readonly<Record<string, Handler>>, options: DrainOptions): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const result: DrainResult = { processed: 0, failed: 0, dead: 0 };

  // `next_attempt_at` alone (every event is queued with it set, migration 0029), so the partial index `outbox_due`
  // serves the sweep: it reads the events still due, never the processed ones (D-108).
  const { results } = await db
    .prepare(
      `SELECT id, type, payload_json, dedupe_key FROM outbox_events
        WHERE processed_at IS NULL AND dead_at IS NULL
          AND next_attempt_at <= ?1
          AND (claimed_until IS NULL OR claimed_until <= ?1)
        ORDER BY id LIMIT ?2`,
    )
    .bind(nowIso, options.limit ?? DEFAULT_LIMIT)
    .all<DueRow>();

  for (const row of results) {
    // Claim it. If another runner got there first, the update changes nothing and we skip it.
    const claim = await db
      .prepare(
        `UPDATE outbox_events SET claimed_until = ?1, attempts = attempts + 1
          WHERE id = ?2 AND processed_at IS NULL AND dead_at IS NULL AND (claimed_until IS NULL OR claimed_until <= ?3)`,
      )
      .bind(new Date(now.getTime() + LEASE_MINUTES * MINUTE).toISOString(), row.id, nowIso)
      .run();
    if (claim.meta.changes !== 1) continue;

    try {
      const handler = handlers[row.type];
      if (!handler) throw new Error(`There is no handler for event type "${row.type}".`);
      await handler(await readPayload(row, options.sealKey), { id: row.id, dedupeKey: row.dedupe_key });

      await db
        .prepare("UPDATE outbox_events SET processed_at = ?1, payload_json = '{}', claimed_until = NULL, last_error = NULL WHERE id = ?2")
        .bind(nowIso, row.id)
        .run();
      result.processed++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
      const attempts = (await db.prepare("SELECT attempts FROM outbox_events WHERE id = ?1").bind(row.id).first<{ attempts: number }>())!.attempts;

      if (attempts >= MAX_ATTEMPTS) {
        await db
          .prepare("UPDATE outbox_events SET dead_at = ?1, payload_json = '{}', claimed_until = NULL, last_error = ?2 WHERE id = ?3")
          .bind(nowIso, message, row.id)
          .run();
        result.dead++;
      } else {
        const wait = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1]!;
        await db
          .prepare("UPDATE outbox_events SET next_attempt_at = ?1, claimed_until = NULL, last_error = ?2 WHERE id = ?3")
          .bind(new Date(now.getTime() + wait * MINUTE).toISOString(), message, row.id)
          .run();
        result.failed++;
      }
    }
  }
  return result;
}
