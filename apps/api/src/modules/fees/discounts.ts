import { newPublicId } from "../../core/ids";
import { ledgerInserts, writeMoney, type LedgerDraft } from "./ledger";

/**
 * Discounts are the Principal's alone (D-172, slice 4): given on the student's fees page, never more than the fees, with
 * no approval. For 15 days the Principal may change or remove one; then it is frozen. The ledger is append-only, so a
 * change or removal is a new entry: a positive `discount` entry that points at the one it cancels (migration 0042).
 * Every rule that can be raced is checked again inside the batch, so two Principals acting at once cannot pass the cap
 * or undo the same discount twice.
 */

export type DiscountReason = "scholarship" | "sibling" | "staff_child" | "other";
export type DiscountInput = { amountPaisa?: number; percent?: number; reason: DiscountReason; note?: string };
export type DiscountResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: "not_found" | "conflict" | "year_closed" | "frozen" }
  | { ok: false; reason: "invalid"; message: string };

/** How long the Principal may still change or remove a discount. */
export const DISCOUNT_WINDOW_DAYS = 15;

const now = () => new Date().toISOString();
const invalid = (message: string): DiscountResult => ({ ok: false, reason: "invalid", message });

/** An active Principal (the Admin role). `?n` is the actor's public id. The Super Admin does not give discounts. */
const principal = (n: number): string =>
  `EXISTS (SELECT 1 FROM users pu JOIN role_assignments pa ON pa.user_id = pu.id WHERE pu.public_id = ?${n} AND pu.is_active = 1 AND pa.is_active = 1 AND pa.role = 'admin')`;

/** What was charged to the enrollment `en`, less the discounts net of their undoes: the most a new discount may add up to. */
const room = (enrollment: string): string =>
  `((SELECT COALESCE(SUM(amount_paisa), 0) FROM ledger_entries WHERE enrollment_id = ${enrollment} AND kind IN ('charge', 'carried_dues'))
    + (SELECT COALESCE(SUM(amount_paisa), 0) FROM ledger_entries WHERE enrollment_id = ${enrollment} AND kind = 'discount'))`;

interface Facts {
  allowed: boolean;
  closed: boolean;
  charged: number;
  discounted: number;
}

async function facts(db: D1Database, actor: string, enrollmentId: string): Promise<Facts> {
  const [flags, entries] = await db.batch([
    db
      .prepare(
        `SELECT ${principal(1)} AS ok, EXISTS (SELECT 1 FROM enrollments WHERE public_id = ?2) AS found,
                (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.public_id = ?2) AS year_status`,
      )
      .bind(actor, enrollmentId),
    db.prepare("SELECT le.kind, le.amount_paisa FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1").bind(enrollmentId),
  ]);
  const f = flags!.results[0] as { ok: number; found: number; year_status: string | null };
  const rows = entries!.results as unknown as { kind: string; amount_paisa: number }[];
  return {
    allowed: f.ok === 1 && f.found === 1,
    closed: f.year_status === "closed",
    charged: rows.filter((r) => r.kind === "charge" || r.kind === "carried_dues").reduce((s, r) => s + r.amount_paisa, 0),
    discounted: -rows.filter((r) => r.kind === "discount").reduce((s, r) => s + r.amount_paisa, 0),
  };
}

function amountOf(input: DiscountInput, charged: number): number {
  return input.percent !== undefined ? Math.floor((charged * input.percent) / 100) : input.amountPaisa!;
}

const reasonText = (input: DiscountInput, note: string | null) => `Discount (${input.reason}${note ? `: ${note}` : ""})`.slice(0, 500);

const INSERT_DISCOUNT = `INSERT INTO student_discounts (public_id, enrollment_id, amount_paisa, percent, reason_code, note, entry_id, window_ends_at, replaces_id, created_by_user_id, created_at)
   SELECT ?1, le.enrollment_id, ?3, ?4, ?5, ?6, le.id, ?7, (SELECT id FROM student_discounts WHERE public_id = ?8), u.id, ?9
     FROM ledger_entries le, users u WHERE le.public_id = ?2 AND u.public_id = ?10 AND changes() > 0`;

/** The Principal gives a discount: an amount, or a percentage of what was charged, with a reason. */
export async function giveDiscount(db: D1Database, key: string, actor: string, enrollmentId: string, input: DiscountInput): Promise<DiscountResult> {
  const state = await facts(db, actor, enrollmentId);
  if (!state.allowed) return { ok: false, reason: "not_found" };
  if (state.closed) return { ok: false, reason: "year_closed" };
  const note = input.note?.trim() || null;
  if (input.reason === "other" && !note) return invalid("Say what the discount is for");
  const amount = amountOf(input, state.charged);
  if (amount <= 0) return invalid("There is nothing charged yet to discount");
  if (amount + state.discounted > state.charged) return invalid(state.discounted > 0 ? "With the discounts already given, this would be more than the fees" : "A discount cannot be more than the fees");

  const publicId = newPublicId();
  const entryId = newPublicId();
  const at = now();
  const draft: LedgerDraft = { publicId: entryId, enrollmentPublicId: enrollmentId, kind: "discount", amountPaisa: -amount, sourceType: "discount", sourcePublicId: publicId, memo: reasonText(input, note), actorPublicId: actor, createdAt: at };
  const windowEnds = new Date(Date.parse(at) + DISCOUNT_WINDOW_DAYS * 86_400_000).toISOString();
  const outcome = await writeMoney(
    db,
    key,
    { action: "fees.discount.given", entityType: "student_discount", entityPublicId: publicId, actorPublicId: actor, summary: `Discount of ${amount} paisa given (${input.reason})`, after: { enrollmentId, amountPaisa: amount, reason: input.reason } },
    async (head) => {
      // The cap is checked inside the batch: the entry goes in only if the discounts, with this one, stay within the fees.
      const entry = await ledgerInserts(db, key, head, [draft], { guard: `${principal(16)} AND ${room("en.id")} >= ?17`, guardBinds: [actor, amount] });
      return [...entry.statements, db.prepare(INSERT_DISCOUNT).bind(publicId, entryId, amount, input.percent ?? null, input.reason, note, windowEnds, null, at, actor)];
    },
  );
  return finish(outcome, publicId);
}

function finish(outcome: Awaited<ReturnType<typeof writeMoney>>, publicId: string): DiscountResult {
  if (outcome === "done") return { ok: true, publicId };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "rejected") return invalid("That discount is not complete");
  return { ok: false, reason: "conflict" };
}

interface Row {
  public_id: string;
  amount_paisa: number;
  status: string;
  window_ends_at: string;
  enrollment_id: string;
  entry_id: string;
}

const readDiscount = (db: D1Database, id: string) =>
  db
    .prepare(
      `SELECT sd.public_id, sd.amount_paisa, sd.status, sd.window_ends_at, en.public_id AS enrollment_id, le.public_id AS entry_id
         FROM student_discounts sd JOIN enrollments en ON en.id = sd.enrollment_id JOIN ledger_entries le ON le.id = sd.entry_id WHERE sd.public_id = ?1`,
    )
    .bind(id)
    .first<Row>();

/** The undo of a discount: a positive entry pointing at it, once, for exactly its amount. */
const undoDraft = (row: Row, actor: string, at: string): LedgerDraft => ({
  publicId: newPublicId(),
  enrollmentPublicId: row.enrollment_id,
  kind: "discount",
  amountPaisa: row.amount_paisa,
  refersToPublicId: row.entry_id,
  sourceType: "discount_undo",
  sourcePublicId: row.public_id,
  memo: "Discount taken back",
  actorPublicId: actor,
  createdAt: at,
});

/** The window and the Principal, checked inside the batch on the discount row `sd` bound at `?n` (public id) and now at `?m`. */
const openWindow = (idBind: number, nowBind: number): string => `public_id = ?${idBind} AND status = 'active' AND window_ends_at > ?${nowBind}`;

/** The Principal takes a discount back within its window: the student owes it again, and the discount is final. */
export async function removeDiscount(db: D1Database, key: string, actor: string, discountId: string): Promise<DiscountResult> {
  const row = await readDiscount(db, discountId);
  if (!row) return { ok: false, reason: "not_found" };
  const state = await facts(db, actor, row.enrollment_id);
  if (!state.allowed) return { ok: false, reason: "not_found" };
  if (state.closed) return { ok: false, reason: "year_closed" };
  const at = now();
  if (row.status !== "active") return { ok: false, reason: "conflict" };
  if (row.window_ends_at <= at) return { ok: false, reason: "frozen" };
  const outcome = await writeMoney(
    db,
    key,
    { action: "fees.discount.removed", entityType: "student_discount", entityPublicId: discountId, actorPublicId: actor, summary: `Discount of ${row.amount_paisa} paisa taken back`, after: { enrollmentId: row.enrollment_id } },
    async (head) => [
      db.prepare(`UPDATE student_discounts SET status = 'removed' WHERE ${openWindow(1, 2)} AND ${principal(3)}`).bind(discountId, at, actor),
      ...(await ledgerInserts(db, key, head, [undoDraft(row, actor, at)], { chainFirst: true })).statements,
    ],
  );
  return finish(outcome, discountId);
}

/** The Principal changes a discount within its window: the old one is taken back and the new one given, in one batch. The window carries over. */
export async function changeDiscount(db: D1Database, key: string, actor: string, discountId: string, input: DiscountInput): Promise<DiscountResult> {
  const row = await readDiscount(db, discountId);
  if (!row) return { ok: false, reason: "not_found" };
  const state = await facts(db, actor, row.enrollment_id);
  if (!state.allowed) return { ok: false, reason: "not_found" };
  if (state.closed) return { ok: false, reason: "year_closed" };
  const at = now();
  if (row.status !== "active") return { ok: false, reason: "conflict" };
  if (row.window_ends_at <= at) return { ok: false, reason: "frozen" };
  const note = input.note?.trim() || null;
  if (input.reason === "other" && !note) return invalid("Say what the discount is for");
  const amount = amountOf(input, state.charged);
  if (amount <= 0) return invalid("There is nothing charged yet to discount");
  if (amount + (state.discounted - row.amount_paisa) > state.charged) return invalid("With the other discounts given, this would be more than the fees");

  const publicId = newPublicId();
  const entryId = newPublicId();
  const draft: LedgerDraft = { publicId: entryId, enrollmentPublicId: row.enrollment_id, kind: "discount", amountPaisa: -amount, sourceType: "discount", sourcePublicId: publicId, memo: reasonText(input, note), actorPublicId: actor, createdAt: at };
  const outcome = await writeMoney(
    db,
    key,
    { action: "fees.discount.changed", entityType: "student_discount", entityPublicId: publicId, actorPublicId: actor, summary: `Discount changed from ${row.amount_paisa} to ${amount} paisa`, after: { replaces: discountId, amountPaisa: amount, reason: input.reason } },
    async (head) => {
      const undo = await ledgerInserts(db, key, head, [undoDraft(row, actor, at)], { chainFirst: true });
      const given = await ledgerInserts(db, key, undo.lastHash, [draft], { chainFirst: true });
      return [
        // The one gate of the batch: still open, still the Principal, and the new amount within the fees once the old one is out.
        db
          .prepare(`UPDATE student_discounts SET status = 'replaced' WHERE ${openWindow(1, 2)} AND ${principal(3)} AND ${room("student_discounts.enrollment_id")} + amount_paisa >= ?4`)
          .bind(discountId, at, actor, amount),
        ...undo.statements,
        ...given.statements,
        db.prepare(INSERT_DISCOUNT).bind(publicId, entryId, amount, input.percent ?? null, input.reason, note, row.window_ends_at, discountId, at, actor),
      ];
    },
  );
  return finish(outcome, publicId);
}

/** A student's discounts, newest first, for the fee account: each says whether the Principal can still change it. */
export async function discountsOf(db: D1Database, enrollmentId: string, at: string = now()) {
  const { results } = await db
    .prepare(
      `SELECT sd.public_id, sd.amount_paisa, sd.percent, sd.reason_code, sd.note, sd.status, sd.window_ends_at, sd.created_at
         FROM student_discounts sd JOIN enrollments en ON en.id = sd.enrollment_id WHERE en.public_id = ?1 ORDER BY sd.id DESC`,
    )
    .bind(enrollmentId)
    .all<{ public_id: string; amount_paisa: number; percent: number | null; reason_code: DiscountReason; note: string | null; status: "active" | "removed" | "replaced"; window_ends_at: string; created_at: string }>();
  return results.map((r) => ({
    id: r.public_id,
    amountPaisa: r.amount_paisa,
    percent: r.percent,
    reason: r.reason_code,
    note: r.note,
    status: r.status,
    changeableUntil: r.window_ends_at,
    canChange: r.status === "active" && r.window_ends_at > at,
    createdAt: r.created_at,
  }));
}
