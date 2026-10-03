import { rowsOf, type DashboardPart } from "../../core/dashboard";
import { recordAudit } from "../../core/audit";
import { nepalDate } from "../../core/dates";
import { queueEmailIf } from "../../core/notifications";
import type { Grant } from "../../core/permissions";
import { allocate, type LedgerKind } from "./allocation";
import { formatNpr } from "./money";
import type { DuesList } from "./schema";

/**
 * The dues list and overdue reminders (D-078): every student of the active year in the person's sections, with what
 * was charged, discounted and paid, and what is due and overdue, computed from the ledger (oldest due first).
 */

const sectionFilter = (grant: Grant): string | null => (grant.institution ? null : JSON.stringify(grant.sections));

export async function listDues(db: D1Database, grant: Grant, classId: string | null, today = nepalDate(new Date())): Promise<DuesList> {
  const [students, entries] = await db.batch([
    db
      .prepare(
        `SELECT en.public_id, st.public_id AS student_id, st.first_name, st.last_name, st.sid, st.email, pv.name AS programme_name, lv.name AS level_name, cl.label, cl.public_id AS class_id
           FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
           JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
          WHERE ay.status = 'active' AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1))) AND (?2 IS NULL OR cl.public_id = ?2)
          ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label, st.last_name, st.first_name`,
      )
      .bind(sectionFilter(grant), classId),
    db
      .prepare(
        `SELECT en.public_id AS enrollment, le.public_id, le.kind, le.amount_paisa, le.due_on
           FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN academic_years ay ON ay.id = en.academic_year_id
           JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
          WHERE ay.status = 'active' AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1))) AND (?2 IS NULL OR cl.public_id = ?2)`,
      )
      .bind(sectionFilter(grant), classId),
  ]);
  const byEnrollment = new Map<string, { public_id: string; kind: LedgerKind; amount_paisa: number; due_on: string | null }[]>();
  for (const e of entries!.results as unknown as { enrollment: string; public_id: string; kind: LedgerKind; amount_paisa: number; due_on: string | null }[]) {
    const list = byEnrollment.get(e.enrollment) ?? [];
    list.push(e);
    byEnrollment.set(e.enrollment, list);
  }
  const rows = (students!.results as unknown as { public_id: string; student_id: string; first_name: string; last_name: string; sid: string; email: string | null; programme_name: string; level_name: string; label: string; class_id: string }[]).map((st) => {
    const lines = byEnrollment.get(st.public_id) ?? [];
    const sum = (kinds: LedgerKind[]) => lines.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.amount_paisa, 0);
    const alloc = allocate(lines.map((l) => ({ id: l.public_id, kind: l.kind, amountPaisa: l.amount_paisa, dueOn: l.due_on })), today);
    return {
      enrollmentId: st.public_id,
      studentId: st.student_id,
      studentName: `${st.first_name} ${st.last_name}`,
      sid: st.sid,
      classId: st.class_id,
      className: [st.programme_name, st.level_name, st.label].filter(Boolean).join(" · "),
      hasEmail: Boolean(st.email),
      chargedPaisa: sum(["charge", "carried_dues"]),
      discountPaisa: -sum(["discount"]),
      paidPaisa: -sum(["payment"]) - sum(["reversal"]),
      balancePaisa: alloc.balancePaisa,
      duePaisa: alloc.duePaisa,
      overduePaisa: alloc.overduePaisa,
    };
  });
  return {
    today,
    students: rows,
    totals: {
      chargedPaisa: rows.reduce((s, r) => s + r.chargedPaisa, 0),
      discountPaisa: rows.reduce((s, r) => s + r.discountPaisa, 0),
      paidPaisa: rows.reduce((s, r) => s + r.paidPaisa, 0),
      duePaisa: rows.reduce((s, r) => s + r.duePaisa, 0),
      overduePaisa: rows.reduce((s, r) => s + r.overduePaisa, 0),
    },
  };
}

const CSV_HEADER = ["SID", "Student", "Class", "Charged (NPR)", "Discount (NPR)", "Paid (NPR)", "Due (NPR)", "Overdue (NPR)"];

/** One field, quoted when it holds a comma, a quote or a line break, and never starting a formula in a spreadsheet. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The dues list as CSV (Excel opens it). OPEN: a real .xlsx needs a library, which needs the PM (CLAUDE.md section 3). */
export function duesCsv(list: DuesList): string {
  const money = (p: number) => formatNpr(p);
  const lines = [CSV_HEADER, ...list.students.map((r) => [r.sid, r.studentName, r.className, money(r.chargedPaisa), money(r.discountPaisa), money(r.paidPaisa), money(r.duePaisa), money(r.overduePaisa)])];
  return `﻿${lines.map((line) => line.map(csvField).join(",")).join("\r\n")}\r\n`;
}

/**
 * Emails every student in reach who has something overdue and an email address. Once per student per day (the
 * outbox's dedupe key), so pressing it twice sends nothing new. In-app and email only; SMS waits for Phase 9.
 */
export async function sendOverdueReminders(db: D1Database, key: string, dataKey: string, actor: string, grant: Grant, today = nepalDate(new Date())): Promise<{ queued: number }> {
  const list = await listDues(db, grant, null, today);
  const due = list.students.filter((s) => s.overduePaisa > 0 && s.hasEmail);
  if (due.length === 0) return { queued: 0 };
  const emails = await db
    .prepare(`SELECT en.public_id, st.email FROM enrollments en JOIN students st ON st.id = en.student_id WHERE en.public_id IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify(due.map((s) => s.enrollmentId)))
    .all<{ public_id: string; email: string }>();
  const address = new Map(emails.results.map((r) => [r.public_id, r.email]));
  let queued = 0;
  for (let i = 0; i < due.length; i += 50) {
    const chunk = due.slice(i, i + 50);
    const statements = await Promise.all(
      chunk.map((s) =>
        // Only if not already queued today: a second press sends nothing new.
        queueEmailIf(
          db,
          dataKey,
          { template: "fee_overdue", to: address.get(s.enrollmentId)!, data: { name: s.studentName, sid: s.sid, overdue: formatNpr(s.overduePaisa) }, dedupeKey: `fee_overdue:${s.enrollmentId}:${today}` },
          "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM outbox_events WHERE dedupe_key = ?5)",
          `fee_overdue:${s.enrollmentId}:${today}`,
        ),
      ),
    );
    await recordAudit(db, key, { action: "fees.reminders.sent", entityType: "fees", actorPublicId: actor, summary: `Overdue reminders queued for ${chunk.length} students`, after: { today, enrollments: chunk.map((s) => s.enrollmentId) } }, statements);
    queued += chunk.length;
  }
  return { queued };
}

export interface FeesDashboard {
  /** Money taken in the last 30 days and the 30 before, net of reversals and refunds, in paisa. */
  collectedPaisa: number;
  previousPaisa: number;
  chargedPaisa: number;
  paidPaisa: number;
  duePaisa: number;
  overduePaisa: number;
  /** Students of the active year with anything overdue: the fee follow-ups. */
  followUps: number;
}

/**
 * The dashboard's fees (D-088), for the whole school: collections now against the window before, and the active
 * year's dues computed from the ledger exactly as the dues list does (oldest due first, never stored).
 */
export function feesDashboardPart(db: D1Database, windows: { since: string; before: string }, today = nepalDate(new Date())): DashboardPart<FeesDashboard> {
  return {
    statements: [
      db
        .prepare(
          `SELECT COALESCE(-SUM(CASE WHEN created_at >= ?1 THEN amount_paisa END), 0) AS collected,
                  COALESCE(-SUM(CASE WHEN created_at >= ?2 AND created_at < ?1 THEN amount_paisa END), 0) AS previous
             FROM ledger_entries WHERE kind IN ('payment', 'reversal', 'refund') AND created_at >= ?2`,
        )
        .bind(windows.since, windows.before),
      db.prepare(
        `SELECT en.public_id AS enrollment, le.public_id, le.kind, le.amount_paisa, le.due_on
           FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN academic_years ay ON ay.id = en.academic_year_id
          WHERE ay.status = 'active'`,
      ),
    ],
    read: ([money, entries]) => {
      const window = rowsOf<{ collected: number; previous: number }>(money)[0] ?? { collected: 0, previous: 0 };
      const byEnrollment = new Map<string, { public_id: string; kind: LedgerKind; amount_paisa: number; due_on: string | null }[]>();
      for (const e of rowsOf<{ enrollment: string; public_id: string; kind: LedgerKind; amount_paisa: number; due_on: string | null }>(entries)) {
        const list = byEnrollment.get(e.enrollment) ?? [];
        list.push(e);
        byEnrollment.set(e.enrollment, list);
      }
      const totals = { chargedPaisa: 0, paidPaisa: 0, duePaisa: 0, overduePaisa: 0, followUps: 0 };
      for (const lines of byEnrollment.values()) {
        const sum = (kinds: LedgerKind[]) => lines.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.amount_paisa, 0);
        const alloc = allocate(lines.map((l) => ({ id: l.public_id, kind: l.kind, amountPaisa: l.amount_paisa, dueOn: l.due_on })), today);
        totals.chargedPaisa += sum(["charge", "carried_dues"]);
        totals.paidPaisa += -sum(["payment"]) - sum(["reversal"]);
        totals.duePaisa += alloc.duePaisa;
        totals.overduePaisa += alloc.overduePaisa;
        if (alloc.overduePaisa > 0) totals.followUps++;
      }
      return { collectedPaisa: window.collected, previousPaisa: window.previous, ...totals };
    },
  };
}
