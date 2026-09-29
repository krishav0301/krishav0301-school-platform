import { adToBsText, nepalDate } from "../../core/dates";
import type { Grant } from "../../core/permissions";
import { allocate, type LedgerKind } from "./allocation";
import type { Account, AdjustmentList, Receipt } from "./schema";

/**
 * A student's fee account for one enrollment (D-076): every total is computed from the ledger on each read (the
 * balance is never stored), and what is due and overdue comes from `allocate`, oldest due first. One round trip.
 */

interface EntryRow {
  public_id: string;
  kind: LedgerKind;
  amount_paisa: number;
  memo: string | null;
  period: string | null;
  due_on: string | null;
  created_at: string;
  reversed: number;
  receipt_id: string | null;
}

interface HeadRow {
  public_id: string;
  first_name: string;
  last_name: string;
  sid: string;
  programme_name: string;
  level_name: string;
  label: string;
  year_label: string;
}

const className = (h: { programme_name: string; level_name: string; label: string }) => [h.programme_name, h.level_name, h.label].filter(Boolean).join(" · ");
const sectionFilter = (grant: Grant): string | null => (grant.institution ? null : JSON.stringify(grant.sections));

const HEAD = `SELECT en.public_id, st.first_name, st.last_name, st.sid, pv.name AS programme_name, lv.name AS level_name, cl.label, ay.label AS year_label
                FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
                JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id`;

/** The account, for staff (scoped to their sections) or for the student themselves (`where` names their own enrollment). */
async function accountWhere(db: D1Database, where: string, binds: unknown[], today: string): Promise<Account | null> {
  const [head, entries, receipts] = await db.batch([
    db.prepare(`${HEAD} WHERE ${where}`).bind(...binds),
    db
      .prepare(
        `SELECT le.public_id, le.kind, le.amount_paisa, le.memo, le.period, le.due_on, le.created_at,
                EXISTS (SELECT 1 FROM ledger_entries rv WHERE rv.refers_to_id = le.id AND rv.kind = 'reversal') AS reversed,
                (SELECT r.public_id FROM receipts r WHERE r.payment_entry_id = le.id) AS receipt_id
           FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN students st ON st.id = en.student_id
           JOIN academic_years ay ON ay.id = en.academic_year_id JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id
           JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
          WHERE ${where}
          ORDER BY le.id`,
      )
      .bind(...binds),
    db
      .prepare(
        `SELECT r.public_id, r.number, -le.amount_paisa AS amount, r.issued_at,
                EXISTS (SELECT 1 FROM ledger_entries rv WHERE rv.refers_to_id = le.id AND rv.kind = 'reversal') AS reversed
           FROM receipts r JOIN ledger_entries le ON le.id = r.payment_entry_id JOIN enrollments en ON en.id = le.enrollment_id JOIN students st ON st.id = en.student_id
           JOIN academic_years ay ON ay.id = en.academic_year_id JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id
           JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
          WHERE ${where}
          ORDER BY r.id DESC`,
      )
      .bind(...binds),
  ]);
  const h = head!.results[0] as HeadRow | undefined;
  if (!h) return null;
  const rows = entries!.results as unknown as EntryRow[];
  const sum = (kinds: LedgerKind[]) => rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.amount_paisa, 0);
  const alloc = allocate(rows.map((r) => ({ id: r.public_id, kind: r.kind, amountPaisa: r.amount_paisa, dueOn: r.due_on })), today);
  return {
    enrollmentId: h.public_id,
    studentName: `${h.first_name} ${h.last_name}`,
    sid: h.sid,
    className: className(h),
    yearLabel: h.year_label,
    chargedPaisa: sum(["charge", "carried_dues"]),
    discountPaisa: -sum(["discount"]),
    paidPaisa: -sum(["payment"]) - sum(["reversal"]),
    refundedPaisa: sum(["refund"]),
    balancePaisa: alloc.balancePaisa,
    duePaisa: alloc.duePaisa,
    overduePaisa: alloc.overduePaisa,
    creditPaisa: alloc.creditPaisa,
    nextDue: alloc.nextDue ? { dueOn: alloc.nextDue.dueOn, dueOnBs: adToBsText(alloc.nextDue.dueOn), remainingPaisa: alloc.nextDue.remainingPaisa } : null,
    entries: rows.map((r) => ({
      id: r.public_id,
      kind: r.kind,
      amountPaisa: r.amount_paisa,
      memo: r.memo,
      period: r.period,
      dueOnBs: r.due_on ? adToBsText(r.due_on) : null,
      createdOnBs: adToBsText(nepalDate(new Date(r.created_at))),
      reversed: r.reversed === 1,
      receiptId: r.receipt_id,
    })),
    receipts: (receipts!.results as unknown as { public_id: string; number: string; amount: number; issued_at: string; reversed: number }[]).map((r) => ({
      id: r.public_id,
      number: r.number,
      amountPaisa: r.amount,
      issuedOnBs: adToBsText(nepalDate(new Date(r.issued_at))),
      reversed: r.reversed === 1,
    })),
  };
}

/** For staff: one enrollment, within the person's sections. */
export const staffAccount = (db: D1Database, grant: Grant, enrollmentId: string, today = nepalDate(new Date())) =>
  accountWhere(db, `en.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`, [enrollmentId, sectionFilter(grant)], today);

/**
 * For the student: their own account, found from the sign-in. This year's when there is an active one, else their most
 * recent year's, so fees and receipts stay visible after a year closes (found by the year test, D-084).
 */
export const ownAccount = (db: D1Database, userPublicId: string, today = nepalDate(new Date())) =>
  accountWhere(
    db,
    `en.id = (SELECT en2.id FROM enrollments en2 JOIN students st2 ON st2.id = en2.student_id JOIN academic_years ay2 ON ay2.id = en2.academic_year_id
               WHERE st2.user_id = (SELECT id FROM users WHERE public_id = ?1) ORDER BY ay2.status = 'active' DESC, ay2.start_date DESC LIMIT 1)`,
    [userPublicId],
    today,
  );

/** The staff view of a student's current account, found by the student's public id (what search returns). */
export async function enrollmentOfStudent(db: D1Database, studentPublicId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT en.public_id FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
        WHERE st.public_id = ?1 ORDER BY ay.status = 'active' DESC, ay.start_date DESC LIMIT 1`,
    )
    .bind(studentPublicId)
    .first<{ public_id: string }>();
  return row?.public_id ?? null;
}

/**
 * One receipt, generated from the ledger (never stored as a document). Staff see receipts in their sections; a student
 * only their own (`ownerUser`).
 */
export async function getReceipt(db: D1Database, receiptId: string, reach: { grant: Grant; ownerUser: string | null }): Promise<Receipt | null> {
  const row = await db
    .prepare(
      `SELECT r.public_id, r.number, -le.amount_paisa AS amount, le.source_type, r.issued_at, st.first_name, st.last_name, st.sid,
              pv.name AS programme_name, lv.name AS level_name, cl.label, ay.label AS year_label,
              EXISTS (SELECT 1 FROM ledger_entries rv WHERE rv.refers_to_id = le.id AND rv.kind = 'reversal') AS reversed,
              (SELECT COALESCE(SUM(amount_paisa), 0) FROM ledger_entries WHERE enrollment_id = en.id) AS balance
         FROM receipts r JOIN ledger_entries le ON le.id = r.payment_entry_id JOIN enrollments en ON en.id = le.enrollment_id JOIN students st ON st.id = en.student_id
         JOIN academic_years ay ON ay.id = en.academic_year_id JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id
         JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
        WHERE r.public_id = ?1
          AND (CASE WHEN ?3 IS NOT NULL THEN st.user_id = (SELECT id FROM users WHERE public_id = ?3)
                    ELSE (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2))) END)`,
    )
    .bind(receiptId, sectionFilter(reach.grant), reach.ownerUser)
    .first<{
      public_id: string;
      number: string;
      amount: number;
      source_type: "cash" | "voucher" | "gateway";
      issued_at: string;
      first_name: string;
      last_name: string;
      sid: string;
      programme_name: string;
      level_name: string;
      label: string;
      year_label: string;
      reversed: number;
      balance: number;
    }>();
  if (!row) return null;
  return {
    id: row.public_id,
    number: row.number,
    amountPaisa: row.amount,
    method: row.source_type,
    issuedAt: row.issued_at,
    issuedOnBs: adToBsText(nepalDate(new Date(row.issued_at))),
    studentName: `${row.first_name} ${row.last_name}`,
    sid: row.sid,
    className: className(row),
    yearLabel: row.year_label,
    reversed: row.reversed === 1,
    balanceAfterPaisa: row.balance,
  };
}

/** The discount, reversal and refund requests on one account, for staff in its section. Null when out of reach. */
export async function listAdjustments(db: D1Database, grant: Grant, enrollmentId: string): Promise<AdjustmentList | null> {
  const [head, rows] = await db.batch([
    db.prepare(`${HEAD} WHERE en.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`).bind(enrollmentId, sectionFilter(grant)),
    db
      .prepare(
        `SELECT fa.public_id, fa.kind, fa.status, fa.amount_paisa, fa.reason_code, fa.note, fa.created_at
           FROM fee_adjustments fa JOIN enrollments en ON en.id = fa.enrollment_id WHERE en.public_id = ?1 AND fa.status <> 'draft' ORDER BY fa.id DESC`,
      )
      .bind(enrollmentId),
  ]);
  if (!head!.results[0]) return null;
  return {
    adjustments: (rows!.results as unknown as { public_id: string; kind: "discount" | "reversal" | "refund"; status: "draft" | "pending" | "approved" | "recorded" | "closed"; amount_paisa: number; reason_code: string | null; note: string | null; created_at: string }[]).map((r) => ({
      id: r.public_id,
      kind: r.kind,
      status: r.status,
      amountPaisa: r.amount_paisa,
      reason: r.reason_code,
      note: r.note,
      createdAt: r.created_at,
    })),
  };
}
