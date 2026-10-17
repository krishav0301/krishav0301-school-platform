import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import type { PaymentGateway } from "../../core/payments";
import { accountantFor, enrollmentSection } from "./guard";
import { ledgerInserts, writeMoney, type LedgerDraft, type MoneyOutcome } from "./ledger";
import { CashPaymentSchema, type CashPayment } from "./schema";

/**
 * Payments (D-076): cash at the counter, or a confirmed online attempt (a reported bank voucher is not offered for now, D-172). Each becomes one ledger
 * payment entry and one receipt, with the receipt counter and the audit entry, in one batch: a payment that fails
 * takes its receipt number back with it, so numbers stay gapless. Each source applies once (the ledger's unique index
 * on the source), so a retry or a repeated callback cannot credit twice.
 */

export type PayResult = { ok: true; paymentId: string; receipt: { id: string; number: string } } | { ok: false; reason: "not_found" | "conflict" | "year_closed" } | { ok: false; reason: "invalid"; message: string };

const now = () => new Date().toISOString();

/** Makes sure the enrollment's section and year have a receipt counter. Harmless when it already exists; runs first. */
const counterStatement = (db: D1Database, enrollmentPublicId: string) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO receipt_counters (section_id, academic_year_id)
       SELECT pv.section_id, en.academic_year_id FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
        WHERE en.public_id = ?1`,
    )
    .bind(enrollmentPublicId);

/**
 * The receipt for a payment just inserted (it runs only if that insert changed a row), numbered from the counter: the
 * section's receipt code, the term's code and the sequence, such as P2-2083-00007 (D-102, D-110: one sequence per section
 * per term; a term's code defaults to its BS year, so a yearly school's numbers look as before). A section from before codes
 * numbers with its key until it is given one.
 */
const receiptStatement = (db: D1Database, receiptPublicId: string, paymentPublicId: string, at: string) =>
  db
    .prepare(
      `INSERT INTO receipts (public_id, number, section_id, academic_year_id, sequence, payment_entry_id, issued_at)
       SELECT ?1, COALESCE(s.receipt_code, s.key) || '-' || ay.code || '-' || printf('%05d', rc.next_number), s.id, ay.id, rc.next_number, le.id, ?3
         FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN academic_years ay ON ay.id = en.academic_year_id
         JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
         JOIN receipt_counters rc ON rc.section_id = s.id AND rc.academic_year_id = ay.id
        WHERE le.public_id = ?2 AND changes() > 0`,
    )
    .bind(receiptPublicId, paymentPublicId, at);

const receiptOf = async (db: D1Database, receiptPublicId: string) =>
  db.prepare("SELECT public_id AS id, number FROM receipts WHERE public_id = ?1").bind(receiptPublicId).first<{ id: string; number: string }>();

function asFailure(outcome: MoneyOutcome): PayResult {
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  return { ok: false, reason: "not_found" };
}

/** One payment entry, its receipt, and whatever must happen before it (`before`, the payment chained to its last). */
async function pay(
  db: D1Database,
  key: string,
  event: Parameters<typeof recordAudit>[2],
  draft: LedgerDraft,
  options: { before?: D1PreparedStatement[]; guard?: string; guardBinds?: unknown[] },
): Promise<PayResult> {
  const receiptPublicId = newPublicId();
  const outcome = await writeMoney(db, key, event, async (head) => {
    const { statements } = await ledgerInserts(db, key, head, [draft], { guard: options.guard, guardBinds: options.guardBinds, chainFirst: (options.before?.length ?? 0) > 0 });
    return [counterStatement(db, draft.enrollmentPublicId), ...(options.before ?? []), ...statements, receiptStatement(db, receiptPublicId, draft.publicId, draft.createdAt)];
  });
  if (outcome !== "done") return asFailure(outcome);
  return { ok: true, paymentId: draft.publicId, receipt: (await receiptOf(db, receiptPublicId))! };
}

/** The payment already recorded from this source, if any, with its receipt: what a retried request answers with. */
async function existingFromSource(db: D1Database, sourceType: string, sourcePublicId: string) {
  return db
    .prepare(
      `SELECT le.public_id AS payment_id, en.public_id AS enrollment_id, -le.amount_paisa AS amount, r.public_id AS receipt_id, r.number
         FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id LEFT JOIN receipts r ON r.payment_entry_id = le.id
        WHERE le.source_type = ?1 AND le.source_public_id = ?2`,
    )
    .bind(sourceType, sourcePublicId)
    .first<{ payment_id: string; enrollment_id: string; amount: number; receipt_id: string; number: string }>();
}

// --- Cash --------------------------------------------------------------------------------------------

export async function recordCash(db: D1Database, key: string, actor: string, input: CashPayment): Promise<PayResult> {
  const parsed = CashPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const { enrollmentId, amountPaisa, idempotencyKey } = parsed.data;

  // A retry of a payment that already went through answers with the same receipt and records nothing new.
  const previous = await existingFromSource(db, "cash", idempotencyKey);
  if (previous) {
    if (previous.enrollment_id !== enrollmentId || previous.amount !== amountPaisa) return { ok: false, reason: "conflict" };
    return { ok: true, paymentId: previous.payment_id, receipt: { id: previous.receipt_id, number: previous.number } };
  }

  const draft: LedgerDraft = {
    publicId: newPublicId(),
    enrollmentPublicId: enrollmentId,
    kind: "payment",
    amountPaisa: -amountPaisa,
    sourceType: "cash",
    sourcePublicId: idempotencyKey,
    memo: parsed.data.memo || "Cash at the counter",
    actorPublicId: actor,
    createdAt: now(),
  };
  const result = await pay(
    db,
    key,
    { action: "fees.payment.cash", entityType: "enrollment", entityPublicId: enrollmentId, actorPublicId: actor, summary: `Cash payment of ${amountPaisa} paisa`, after: { amountPaisa, idempotencyKey } },
    draft,
    { guard: accountantFor(16, enrollmentSection(17)), guardBinds: [actor, enrollmentId] },
  );
  if (!result.ok && result.reason === "conflict") {
    // Two retries raced: whichever landed is the answer, if it is the same payment.
    const landed = await existingFromSource(db, "cash", idempotencyKey);
    if (landed && landed.enrollment_id === enrollmentId && landed.amount === amountPaisa) return { ok: true, paymentId: landed.payment_id, receipt: { id: landed.receipt_id, number: landed.number } };
  }
  return result;
}

// --- The student's own enrollment ------------------------------------------------------------------------

/** The student's own enrollment in an open (active) term, the newest if ever more than one, found from the sign-in. `?1` the student's user public id. */
const OWN_ENROLLMENT = `(SELECT en.public_id FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
                          WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) AND ay.status = 'active' ORDER BY ay.start_date DESC LIMIT 1)`;

export async function ownEnrollment(db: D1Database, userPublicId: string): Promise<string | null> {
  return (await db.prepare(`SELECT ${OWN_ENROLLMENT} AS id`).bind(userPublicId).first<{ id: string | null }>())?.id ?? null;
}

export type Created = { ok: true; publicId: string } | { ok: false; reason: "not_found" | "conflict" } | { ok: false; reason: "invalid"; message: string };

// --- Online, through the gateway interface ----------------------------------------------------------------

export async function startOnlinePayment(db: D1Database, key: string, gateway: PaymentGateway, userPublicId: string, amountPaisa: number): Promise<{ ok: true; gatewayReference: string; redirectUrl: string } | { ok: false; reason: "not_found" }> {
  const enrollment = await ownEnrollment(db, userPublicId);
  if (!enrollment) return { ok: false, reason: "not_found" };
  const attemptId = newPublicId();
  const started = await gateway.start(attemptId, amountPaisa);
  const { applied } = await recordAudit(
    db,
    key,
    { action: "fees.online.started", entityType: "payment_attempt", entityPublicId: attemptId, actorPublicId: userPublicId, summary: `Online payment started (${gateway.name})`, after: { amountPaisa } },
    [
      db
        .prepare(
          `INSERT INTO payment_attempts (public_id, enrollment_id, amount_paisa, gateway, gateway_reference, created_at)
           SELECT ?1, id, ?3, ?4, ?5, ?6 FROM enrollments WHERE public_id = ?2`,
        )
        .bind(attemptId, enrollment, amountPaisa, gateway.name, started.gatewayReference, now()),
    ],
    { onlyIfLastChanged: true },
  );
  return applied ? { ok: true, ...started } : { ok: false, reason: "not_found" };
}

/**
 * The gateway says a payment happened. It is confirmed by asking the gateway (never by trusting the callback), then
 * applied once: the attempt settles once, and the ledger takes one entry per attempt. A repeat answers "done" again.
 */
export async function gatewayCallback(db: D1Database, key: string, gateway: PaymentGateway, gatewayReference: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_paid" }> {
  const attempt = await db
    .prepare(
      `SELECT pa.public_id, pa.amount_paisa, pa.status, en.public_id AS enrollment_id, u.public_id AS student_user
         FROM payment_attempts pa JOIN enrollments en ON en.id = pa.enrollment_id JOIN students st ON st.id = en.student_id JOIN users u ON u.id = st.user_id
        WHERE pa.gateway_reference = ?1 AND pa.gateway = ?2`,
    )
    .bind(gatewayReference, gateway.name)
    .first<{ public_id: string; amount_paisa: number; status: string; enrollment_id: string; student_user: string }>();
  const confirmation = await gateway.confirm(gatewayReference, attempt ? { amountPaisa: attempt.amount_paisa } : null);
  if (!attempt || !confirmation) return { ok: false, reason: "not_found" };
  if (attempt.status === "confirmed") return { ok: true };
  if (!confirmation.paid || confirmation.amountPaisa !== attempt.amount_paisa) return { ok: false, reason: "not_paid" };

  const at = now();
  const result = await pay(
    db,
    key,
    { action: "fees.payment.online", entityType: "payment_attempt", entityPublicId: attempt.public_id, actorPublicId: attempt.student_user, summary: `Online payment confirmed (${gateway.name})`, after: { gatewayReference } },
    {
      publicId: newPublicId(),
      enrollmentPublicId: attempt.enrollment_id,
      kind: "payment",
      amountPaisa: -attempt.amount_paisa,
      sourceType: "gateway",
      sourcePublicId: attempt.public_id,
      memo: `Online (${gateway.name}) ${gatewayReference}`,
      actorPublicId: attempt.student_user,
      createdAt: at,
    },
    { before: [db.prepare("UPDATE payment_attempts SET status = 'confirmed', confirmed_at = ?2 WHERE public_id = ?1 AND status = 'initiated'").bind(attempt.public_id, at)] },
  );
  // A lost race with another callback for the same reference is still "done": it was applied exactly once.
  return result.ok || result.reason === "conflict" || result.reason === "not_found" ? { ok: true } : { ok: false, reason: "not_found" };
}
