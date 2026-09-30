import { recordAudit, type AuditEventInput } from "../../core/audit";
import type { LedgerKind } from "./allocation";

/**
 * The ledger's keyed hash chain (D-074), the same design as the audit log (D-023): each entry stores the previous
 * entry's hash, and its own hash is an HMAC-SHA256 over its contents plus that link, keyed by the `AUDIT_HMAC_KEY`
 * Worker secret (never in the database) with a "ledger" domain tag, so a ledger hash can never be passed off as an
 * audit hash or the other way round. A head row and a trigger make a stale link abort the whole batch; the write then
 * retries against the new head.
 *
 * What is hashed are values that do not depend on internal row numbers: public ids (the enrollment's, and a reversal's
 * target), so verification recomputes them through joins and an entry moved to another student is caught.
 */

export const LEDGER_GENESIS = "0".repeat(64);

export interface LedgerDraft {
  publicId: string;
  enrollmentPublicId: string;
  kind: LedgerKind;
  amountPaisa: number;
  /** A charge's fee item (public id) and billing period. */
  feeItemPublicId?: string | null;
  period?: string | null;
  dueOn?: string | null;
  /** A reversal's payment (public id). */
  refersToPublicId?: string | null;
  sourceType?: string | null;
  sourcePublicId?: string | null;
  memo?: string | null;
  actorPublicId: string;
  createdAt: string;
}

/** The exact values hashed, in a fixed order. */
function canonical(prevHash: string, d: LedgerDraft): string {
  return JSON.stringify([
    "ledger",
    prevHash,
    d.publicId,
    d.enrollmentPublicId,
    d.kind,
    d.amountPaisa,
    d.feeItemPublicId ?? null,
    d.period ?? null,
    d.dueOn ?? null,
    d.refersToPublicId ?? null,
    d.sourceType ?? null,
    d.sourcePublicId ?? null,
    d.memo ?? null,
    d.actorPublicId,
    d.createdAt,
  ]);
}

const encoder = new TextEncoder();
async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const hashLedgerEntry = (key: string, prevHash: string, draft: LedgerDraft): Promise<string> => hmac(key, canonical(prevHash, draft));

/**
 * The insert statements for a run of entries, chained from `head`. Each insert is conditional: `guard` (SQL over the
 * enrollment `en`, its year `ay` and the actor `u`, with `guardBinds` bound from `?16` on) must hold, and every entry
 * after the first also needs the one before it to have gone in (`changes() > 0`), so a failed guard inserts nothing at
 * all and leaves the chain untouched. `chainFirst` makes the first entry depend on the statement before it too.
 */
export async function ledgerInserts(
  db: D1Database,
  key: string,
  head: string,
  drafts: readonly LedgerDraft[],
  options: { guard?: string; guardBinds?: unknown[]; chainFirst?: boolean } = {},
): Promise<{ statements: D1PreparedStatement[]; lastHash: string }> {
  const statements: D1PreparedStatement[] = [];
  let prev = head;
  for (const [index, d] of drafts.entries()) {
    const hash = await hashLedgerEntry(key, prev, d);
    const chained = index > 0 || options.chainFirst ? "AND changes() > 0" : "";
    statements.push(
      db
        .prepare(
          `INSERT INTO ledger_entries (public_id, enrollment_id, kind, amount_paisa, fee_item_id, period, due_on, refers_to_id, source_type, source_public_id, memo, created_by_user_id, created_at, prev_hash, hash)
           SELECT ?1, en.id, ?3, ?4, (SELECT id FROM fee_items WHERE public_id = ?5), ?6, ?7, (SELECT id FROM ledger_entries WHERE public_id = ?8), ?9, ?10, ?11, u.id, ?13, ?14, ?15
             FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id, users u
            WHERE en.public_id = ?2 AND u.public_id = ?12 ${options.guard ? `AND (${options.guard})` : ""} ${chained}`,
        )
        .bind(
          d.publicId,
          d.enrollmentPublicId,
          d.kind,
          d.amountPaisa,
          d.feeItemPublicId ?? null,
          d.period ?? null,
          d.dueOn ?? null,
          d.refersToPublicId ?? null,
          d.sourceType ?? null,
          d.sourcePublicId ?? null,
          d.memo ?? null,
          d.actorPublicId,
          d.createdAt,
          prev,
          hash,
          ...(options.guardBinds ?? []),
        ),
    );
    prev = hash;
  }
  return { statements, lastHash: prev };
}

const LEDGER_CONTENTION = /ledger chain moved|UNIQUE constraint failed: ledger_entries\.(prev_hash|hash)/;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type MoneyOutcome = "done" | "not_applied" | "year_closed" | "duplicate" | "rejected";

/**
 * Runs one money change as one batch: `build(head)` returns the statements (ledger inserts made from that head, and
 * anything riding with them), and the audit entry is appended last, written only if the last statement changed a row.
 * If another request moved the ledger head in between, the batch rolled back entirely; it is rebuilt and retried.
 */
export async function writeMoney(db: D1Database, key: string, event: AuditEventInput, build: (head: string) => Promise<D1PreparedStatement[]>): Promise<MoneyOutcome> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    const head = (await db.prepare("SELECT last_hash FROM ledger_chain_head WHERE id = 1").first<{ last_hash: string }>())?.last_hash ?? LEDGER_GENESIS;
    const statements = await build(head);
    try {
      const { applied } = await recordAudit(db, key, event, statements, { onlyIfLastChanged: true });
      return applied ? "done" : "not_applied";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (LEDGER_CONTENTION.test(message)) {
        await sleep(Math.random() * 10 * Math.min(attempt, 5));
        continue;
      }
      if (/academic year is closed/i.test(message)) return "year_closed";
      if (/UNIQUE constraint failed/i.test(message)) return "duplicate";
      if (/CHECK constraint failed|must cancel one payment|must be the next|only for a payment/i.test(message)) return "rejected";
      throw error;
    }
  }
  throw new Error("The ledger is too busy: could not append after several attempts.");
}

interface LedgerRow {
  id: number;
  public_id: string;
  enrollment_public_id: string;
  kind: LedgerKind;
  amount_paisa: number;
  fee_item_public_id: string | null;
  period: string | null;
  due_on: string | null;
  refers_to_public_id: string | null;
  source_type: string | null;
  source_public_id: string | null;
  memo: string | null;
  actor_public_id: string;
  created_at: string;
  prev_hash: string;
  hash: string;
}

export type LedgerVerifyResult = { ok: true; count: number; lastHash: string } | { ok: false; brokenAtId: number | null; reason: string };

/** Walks the whole ledger, recomputing every hash with the secret key, and checks the head. */
export async function verifyLedgerChain(db: D1Database, key: string): Promise<LedgerVerifyResult> {
  const [entries, headRows] = await db.batch([
    db.prepare(
      `SELECT le.id, le.public_id, en.public_id AS enrollment_public_id, le.kind, le.amount_paisa, fi.public_id AS fee_item_public_id, le.period, le.due_on,
              rt.public_id AS refers_to_public_id, le.source_type, le.source_public_id, le.memo, u.public_id AS actor_public_id, le.created_at, le.prev_hash, le.hash
         FROM ledger_entries le
         LEFT JOIN enrollments en ON en.id = le.enrollment_id
         LEFT JOIN fee_items fi ON fi.id = le.fee_item_id
         LEFT JOIN ledger_entries rt ON rt.id = le.refers_to_id
         LEFT JOIN users u ON u.id = le.created_by_user_id
        ORDER BY le.id`,
    ),
    db.prepare("SELECT last_id, last_hash FROM ledger_chain_head WHERE id = 1"),
  ]);
  const rows = entries!.results as unknown as LedgerRow[];
  const head = headRows!.results[0] as { last_id: number; last_hash: string } | undefined;
  let prev = LEDGER_GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev) return { ok: false, brokenAtId: r.id, reason: "link broken" };
    const expected = await hashLedgerEntry(key, prev, {
      publicId: r.public_id,
      enrollmentPublicId: r.enrollment_public_id,
      kind: r.kind,
      amountPaisa: r.amount_paisa,
      feeItemPublicId: r.fee_item_public_id,
      period: r.period,
      dueOn: r.due_on,
      refersToPublicId: r.refers_to_public_id,
      sourceType: r.source_type,
      sourcePublicId: r.source_public_id,
      memo: r.memo,
      actorPublicId: r.actor_public_id,
      createdAt: r.created_at,
    });
    if (expected !== r.hash) return { ok: false, brokenAtId: r.id, reason: "hash mismatch" };
    prev = r.hash;
  }
  const lastId = rows.at(-1)?.id ?? 0;
  if (!head || head.last_hash !== prev || head.last_id !== lastId) return { ok: false, brokenAtId: null, reason: "head does not match the last entry" };
  return { ok: true, count: rows.length, lastHash: prev };
}

/** What a daily export copies to a second place: enough to catch the newest entries deleted together with the head. */
export async function ledgerChainSummary(db: D1Database): Promise<{ lastId: number; lastHash: string; count: number; sumPaisa: number }> {
  const row = await db
    .prepare("SELECT h.last_id, h.last_hash, (SELECT COUNT(*) FROM ledger_entries) AS n, (SELECT COALESCE(SUM(amount_paisa), 0) FROM ledger_entries) AS total FROM ledger_chain_head h WHERE h.id = 1")
    .first<{ last_id: number; last_hash: string; n: number; total: number }>();
  return { lastId: row!.last_id, lastHash: row!.last_hash, count: row!.n, sumPaisa: row!.total };
}
