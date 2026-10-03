import { recordAudit } from "../../core/audit";
import { adToBsText, nepalDate } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { requestApproval, type ApprovalHandler } from "../approvals/service";
import { allocate, type LedgerKind } from "./allocation";
import { accountantFor, anyAccountant, enrollmentSection } from "./guard";
import { ledgerInserts, writeMoney, type LedgerDraft } from "./ledger";
import { formatNpr } from "./money";

/**
 * Discounts, reversals and refunds (D-077). The Accountant asks; any Admin decides through the approvals engine, never
 * their own request (D-061). Approve-and-apply is one batch: the request's state moves only from `pending`, the ledger
 * entry is chained to that move, and the engine's own decide statement is chained last, so a second click or a second
 * Admin changes nothing. A request goes stale when the student's ledger changes before the decision (its version is
 * the number of entries on the account). A refund is approved first and written to the ledger when paid back.
 */

type Kind = "discount" | "reversal" | "refund";
export type Created = { ok: true; publicId: string } | { ok: false; reason: "not_found" | "conflict" | "year_closed" } | { ok: false; reason: "invalid"; message: string };
const now = () => new Date().toISOString();
const invalid = (message: string): Created => ({ ok: false, reason: "invalid", message });

/** The account's totals right now, and whether the actor may act on it. `?1` the actor, `?2` the enrollment. */
async function accountState(db: D1Database, actor: string, enrollmentId: string) {
  const [allowed, entries] = await db.batch([
    db
      .prepare(
        `SELECT ${accountantFor(1, enrollmentSection(2))} AS ok, EXISTS (SELECT 1 FROM enrollments WHERE public_id = ?2) AS found,
                (SELECT ay.status FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.public_id = ?2) AS year_status`,
      )
      .bind(actor, enrollmentId),
    db.prepare("SELECT le.public_id, le.kind, le.amount_paisa, le.due_on FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1").bind(enrollmentId),
  ]);
  const flags = allowed!.results[0] as { ok: number; found: number; year_status: string | null };
  const rows = entries!.results as unknown as { public_id: string; kind: LedgerKind; amount_paisa: number; due_on: string | null }[];
  const alloc = allocate(rows.map((r) => ({ id: r.public_id, kind: r.kind, amountPaisa: r.amount_paisa, dueOn: r.due_on })), nepalDate(new Date()));
  const charged = rows.filter((r) => r.kind === "charge" || r.kind === "carried_dues").reduce((s, r) => s + r.amount_paisa, 0);
  const discounted = -rows.filter((r) => r.kind === "discount").reduce((s, r) => s + r.amount_paisa, 0);
  // A closed year takes no new requests either (CLAUDE.md section 6: a closed year rejects all writes; found by the year test, D-084).
  return { allowed: flags.ok === 1 && flags.found === 1, closed: flags.year_status === "closed", charged, discounted, credit: alloc.creditPaisa };
}

/** Makes the request row (a draft) and sends it to the engine, which moves it to pending with the approval request. */
async function makeAndSend(db: D1Database, key: string, actor: string, kind: Kind, insert: D1PreparedStatement, publicId: string, summary: string): Promise<Created> {
  try {
    const { applied } = await recordAudit(db, key, { action: `fees.${kind}.requested`, entityType: "fee_adjustment", entityPublicId: publicId, actorPublicId: actor, summary }, [insert], { onlyIfLastChanged: true });
    if (!applied) return { ok: false, reason: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return { ok: false, reason: "conflict" };
    if (/CHECK constraint failed/i.test(message)) return invalid("That request is not complete");
    throw error;
  }
  const sent = await requestApproval(db, key, actor, { kind, subjectId: publicId });
  if (sent.ok) return { ok: true, publicId };
  return { ok: false, reason: sent.reason === "conflict" ? "conflict" : "not_found" };
}

const INSERT = `INSERT INTO fee_adjustments (public_id, kind, enrollment_id, amount_paisa, percent, reason_code, note, payment_entry_id, created_by_user_id, created_at)`;

export async function proposeDiscount(
  db: D1Database,
  key: string,
  actor: string,
  enrollmentId: string,
  input: { amountPaisa?: number; percent?: number; reason: "scholarship" | "sibling" | "staff_child" | "other"; note?: string },
): Promise<Created> {
  const state = await accountState(db, actor, enrollmentId);
  if (!state.allowed) return { ok: false, reason: "not_found" };
  if (state.closed) return { ok: false, reason: "year_closed" };
  const note = input.note?.trim() || null;
  if (input.reason === "other" && !note) return invalid("Say what the discount is for");
  const amount = input.percent !== undefined ? Math.floor((state.charged * input.percent) / 100) : input.amountPaisa!;
  if (amount <= 0) return invalid("There is nothing charged yet to discount");
  if (amount > state.charged) return invalid("A discount cannot be more than what was charged");
  // Together with the discounts already given, never more than was charged (D-085). One pending beside another is
  // caught when the first is approved: that makes the second stale (see currentVersion), and asked again it lands here.
  if (amount + state.discounted > state.charged) return invalid("With the discounts already given, this would be more than was charged");
  const publicId = newPublicId();
  return makeAndSend(
    db,
    key,
    actor,
    "discount",
    db
      .prepare(`${INSERT} SELECT ?1, 'discount', en.id, ?3, ?4, ?5, ?6, NULL, u.id, ?7 FROM enrollments en, users u WHERE en.public_id = ?2 AND u.public_id = ?8 AND ${accountantFor(8, enrollmentSection(2))}`)
      .bind(publicId, enrollmentId, amount, input.percent ?? null, input.reason, note, now(), actor),
    publicId,
    `Discount of ${amount} paisa proposed (${input.reason})`,
  );
}

export async function requestReversal(db: D1Database, key: string, actor: string, paymentId: string, reason: string): Promise<Created> {
  const payment = await db
    .prepare(
      `SELECT -le.amount_paisa AS amount, en.public_id AS enrollment_id,
              EXISTS (SELECT 1 FROM ledger_entries rv WHERE rv.refers_to_id = le.id AND rv.kind = 'reversal') AS reversed
         FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE le.public_id = ?1 AND le.kind = 'payment'`,
    )
    .bind(paymentId)
    .first<{ amount: number; enrollment_id: string; reversed: number }>();
  if (!payment) return { ok: false, reason: "not_found" };
  const state = await accountState(db, actor, payment.enrollment_id);
  if (!state.allowed) return { ok: false, reason: "not_found" };
  if (state.closed) return { ok: false, reason: "year_closed" };
  if (payment.reversed === 1) return { ok: false, reason: "conflict" };
  const publicId = newPublicId();
  return makeAndSend(
    db,
    key,
    actor,
    "reversal",
    db
      .prepare(`${INSERT} SELECT ?1, 'reversal', le.enrollment_id, ?3, NULL, NULL, ?4, le.id, u.id, ?5 FROM ledger_entries le, users u WHERE le.public_id = ?2 AND le.kind = 'payment' AND u.public_id = ?6
                 AND ${accountantFor(6, "(SELECT pv.section_id FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE en.id = le.enrollment_id)")}`)
      .bind(publicId, paymentId, payment.amount, reason, now(), actor),
    publicId,
    `Reversal of a payment of ${payment.amount} paisa requested`,
  );
}

export async function requestRefund(db: D1Database, key: string, actor: string, enrollmentId: string, amountPaisa: number, reason: string): Promise<Created> {
  const state = await accountState(db, actor, enrollmentId);
  if (!state.allowed) return { ok: false, reason: "not_found" };
  if (state.closed) return { ok: false, reason: "year_closed" };
  if (amountPaisa > state.credit) return invalid("A refund can only return credit: this is more than the student has paid over what is owed");
  const publicId = newPublicId();
  return makeAndSend(
    db,
    key,
    actor,
    "refund",
    db
      .prepare(`${INSERT} SELECT ?1, 'refund', en.id, ?3, NULL, NULL, ?4, NULL, u.id, ?5 FROM enrollments en, users u WHERE en.public_id = ?2 AND u.public_id = ?6 AND ${accountantFor(6, enrollmentSection(2))}`)
      .bind(publicId, enrollmentId, amountPaisa, reason, now(), actor),
    publicId,
    `Refund of ${amountPaisa} paisa requested`,
  );
}

/** Records how an approved refund was paid back: then, and only then, the ledger takes the refund. Once. */
export async function recordRefund(
  db: D1Database,
  key: string,
  actor: string,
  adjustmentId: string,
  method: "cash" | "bank_transfer" | "cheque",
  reference: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "conflict" | "year_closed" }> {
  const row = await db
    .prepare("SELECT fa.status, fa.amount_paisa, en.public_id AS enrollment_id FROM fee_adjustments fa JOIN enrollments en ON en.id = fa.enrollment_id WHERE fa.public_id = ?1 AND fa.kind = 'refund'")
    .bind(adjustmentId)
    .first<{ status: string; amount_paisa: number; enrollment_id: string }>();
  if (!row) return { ok: false, reason: "not_found" };
  const state = await accountState(db, actor, row.enrollment_id);
  if (!state.allowed) return { ok: false, reason: "not_found" };
  if (row.status !== "approved" || row.amount_paisa > state.credit) return { ok: false, reason: "conflict" };

  const at = now();
  const draft: LedgerDraft = {
    publicId: newPublicId(),
    enrollmentPublicId: row.enrollment_id,
    kind: "refund",
    amountPaisa: row.amount_paisa,
    sourceType: "refund",
    sourcePublicId: adjustmentId,
    memo: `Refund paid back (${method}${reference ? ` ${reference}` : ""})`,
    actorPublicId: actor,
    createdAt: at,
  };
  const outcome = await writeMoney(
    db,
    key,
    { action: "fees.refund.recorded", entityType: "fee_adjustment", entityPublicId: adjustmentId, actorPublicId: actor, summary: `Refund of ${row.amount_paisa} paisa paid back`, after: { method, reference: reference ?? null } },
    async (head) => [
      db
        .prepare(
          `UPDATE fee_adjustments SET status = 'recorded', refund_method = ?2, refund_reference = ?3
            WHERE public_id = ?1 AND kind = 'refund' AND status = 'approved'
              -- Only credit goes back, checked here inside the batch so two refunds recorded at once cannot both pass (D-085):
              -- the credit is minus the balance (the sum of every entry), so after this refund the sum must not go above zero.
              AND (SELECT COALESCE(SUM(le.amount_paisa), 0) FROM ledger_entries le WHERE le.enrollment_id = fee_adjustments.enrollment_id) + fee_adjustments.amount_paisa <= 0
              AND ${accountantFor(4, "(SELECT pv.section_id FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE en.id = fee_adjustments.enrollment_id)")}`,
        )
        .bind(adjustmentId, method, reference ?? null, actor),
      ...(await ledgerInserts(db, key, head, [draft], { chainFirst: true })).statements,
    ],
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  return { ok: false, reason: "conflict" };
}

// --- The three approval kinds -----------------------------------------------------------------------------------

interface AdjustmentRow {
  public_id: string;
  kind: Kind;
  amount_paisa: number;
  percent: number | null;
  reason_code: string | null;
  note: string | null;
  enrollment_id: string;
  payment_id: string | null;
  student_name: string;
  sid: string;
}

const readAdjustment = (db: D1Database, id: number) =>
  db
    .prepare(
      `SELECT fa.public_id, fa.kind, fa.amount_paisa, fa.percent, fa.reason_code, fa.note, en.public_id AS enrollment_id, le.public_id AS payment_id,
              st.first_name || ' ' || st.last_name AS student_name, st.sid
         FROM fee_adjustments fa JOIN enrollments en ON en.id = fa.enrollment_id JOIN students st ON st.id = en.student_id
         LEFT JOIN ledger_entries le ON le.id = fa.payment_entry_id
        WHERE fa.id = ?1`,
    )
    .bind(id)
    .first<AdjustmentRow>();

const KIND_WORD: Record<Kind, string> = { discount: "Discount", reversal: "Payment reversal", refund: "Refund" };

function adjustmentHandler(kind: Kind): ApprovalHandler {
  return {
    requesterSql: anyAccountant,
    async resolveId(db, publicId) {
      return (await db.prepare("SELECT id FROM fee_adjustments WHERE public_id = ?1 AND kind = ?2").bind(publicId, kind).first<{ id: number }>())?.id ?? null;
    },
    async describe(db, id) {
      const a = await readAdjustment(db, id);
      if (!a) return null;
      return {
        snapshot: { kind: a.kind, student: a.student_name, sid: a.sid, amountPaisa: a.amount_paisa, percent: a.percent, reason: a.reason_code, note: a.note },
        summary: `${KIND_WORD[kind]} of NPR ${formatNpr(a.amount_paisa)} for ${a.student_name} (${a.sid})${a.note ? `: ${a.note}` : ""}`,
        subjectPublicId: a.public_id,
      };
    },
    /**
     * What the Principal reads before deciding (D-102): the student and their class; a discount's reason and note
     * (admin FUT F-06); a reversal's original payment, its day and receipt; a refund's credit as it stands now. One
     * round trip.
     */
    async detail(db, id) {
      const row = await db
        .prepare(
          `SELECT fa.kind, fa.amount_paisa, fa.percent, fa.reason_code, fa.note, st.first_name || ' ' || st.last_name AS student, st.sid,
                  pv.name || ' · ' || lv.name || CASE WHEN cl.label IS NULL OR cl.label = '' THEN '' ELSE ' ' || cl.label END AS class_name,
                  pe.amount_paisa AS paid_paisa, pe.created_at AS paid_at, pe.source_type AS paid_method, rc.number AS receipt_number,
                  (SELECT COALESCE(SUM(le.amount_paisa), 0) FROM ledger_entries le WHERE le.enrollment_id = fa.enrollment_id) AS balance
             FROM fee_adjustments fa JOIN enrollments en ON en.id = fa.enrollment_id JOIN students st ON st.id = en.student_id
             LEFT JOIN classes cl ON cl.id = en.class_id LEFT JOIN levels lv ON lv.id = cl.level_id LEFT JOIN programmes pv ON pv.id = lv.programme_id
             LEFT JOIN ledger_entries pe ON pe.id = fa.payment_entry_id LEFT JOIN receipts rc ON rc.payment_entry_id = pe.id
            WHERE fa.id = ?1`,
        )
        .bind(id)
        .first<{
          kind: Kind;
          amount_paisa: number;
          percent: number | null;
          reason_code: "scholarship" | "sibling" | "staff_child" | "other" | null;
          note: string | null;
          student: string;
          sid: string;
          class_name: string | null;
          paid_paisa: number | null;
          paid_at: string | null;
          paid_method: string | null;
          receipt_number: string | null;
          balance: number;
        }>();
      if (!row) return null;
      const who = { student: row.student, sid: row.sid, className: row.class_name, amountPaisa: row.amount_paisa };
      if (kind === "discount") return { kind: "discount" as const, ...who, percent: row.percent, reason: row.reason_code, note: row.note };
      if (kind === "reversal")
        return {
          kind: "reversal" as const,
          ...who,
          reason: row.note,
          payment:
            row.paid_paisa === null
              ? null
              : { amountPaisa: -row.paid_paisa, paidOnBs: row.paid_at ? adToBsText(nepalDate(new Date(row.paid_at))) : null, receiptNumber: row.receipt_number, method: row.paid_method },
        };
      return { kind: "refund" as const, ...who, availableCreditPaisa: Math.max(0, -row.balance), note: row.note };
    },
    // Stale when what the request refers to changes between asking and deciding (CLAUDE.md section 6): a discount, the
    // student's charges (a percentage was taken of them); a reversal, its payment (already reversed); a refund, the
    // credit (any payment, discount, reversal or refund moves it).
    async currentVersion(db, id) {
      const counted =
        kind === "discount"
          ? // The charges (a percentage was taken of them) and the other discounts (together they may not pass the charges, D-085).
            "le.kind IN ('charge', 'carried_dues', 'discount')"
          : kind === "reversal"
            ? "le.kind = 'reversal' AND le.refers_to_id = fa.payment_entry_id"
            : // A refund returns credit: it goes stale when something takes credit away (a new charge, carried dues, a
              // reversal, another refund), not when a payment or discount adds to it (found by the year test, D-084).
              "le.kind IN ('charge', 'carried_dues', 'reversal', 'refund')";
      const row = await db
        .prepare(`SELECT (SELECT COUNT(*) FROM ledger_entries le WHERE le.enrollment_id = fa.enrollment_id AND ${counted}) AS n FROM fee_adjustments fa WHERE fa.id = ?1`)
        .bind(id)
        .first<{ n: number }>();
      return row ? row.n + 1 : null;
    },
    onRequested: (db, id) => [db.prepare("UPDATE fee_adjustments SET status = 'pending' WHERE id = ?1 AND status = 'draft'").bind(id)],
    async onApproved(db, id, context) {
      const approveRow = db.prepare("UPDATE fee_adjustments SET status = 'approved' WHERE id = ?1 AND status = 'pending'").bind(id);
      if (kind === "refund") return [approveRow];
      const a = (await readAdjustment(db, id))!;
      const draft: LedgerDraft =
        kind === "discount"
          ? { publicId: newPublicId(), enrollmentPublicId: a.enrollment_id, kind: "discount", amountPaisa: -a.amount_paisa, sourceType: "adjustment", sourcePublicId: a.public_id, memo: `Discount (${a.reason_code}${a.note ? `: ${a.note}` : ""})`, actorPublicId: context.actorPublicId, createdAt: now() }
          : { publicId: newPublicId(), enrollmentPublicId: a.enrollment_id, kind: "reversal", amountPaisa: a.amount_paisa, refersToPublicId: a.payment_id, sourceType: "adjustment", sourcePublicId: a.public_id, memo: `Reversal: ${a.note}`, actorPublicId: context.actorPublicId, createdAt: now() };
      return [approveRow, ...(await ledgerInserts(db, context.auditKey, context.ledgerHead, [draft], { chainFirst: true })).statements];
    },
    onResolved: (db, id) => [db.prepare("UPDATE fee_adjustments SET status = 'closed' WHERE id = ?1 AND status IN ('draft', 'pending')").bind(id)],
  };
}

export const discountApprovalHandler = adjustmentHandler("discount");
export const reversalApprovalHandler = adjustmentHandler("reversal");
export const refundApprovalHandler = adjustmentHandler("refund");
