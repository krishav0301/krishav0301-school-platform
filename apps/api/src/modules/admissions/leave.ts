import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { requestApproval, type ApprovalHandler } from "../approvals/service";
import { closeFeeAccountStatement, formatNpr } from "../fees";
import { coordinatorForSection } from "./guard";

/**
 * A student leaves (D-172, slice 5). The Co-ordinator asks, with a reason; the Principal approves through the approvals
 * engine. Approving is one batch: the student is marked Left, their enrollment leaves the class, and their fee account is
 * closed for everyone (what is unpaid stays owed; nothing reopens it). Left no longer needs zero dues: the Co-ordinator
 * settles it with the family before asking, and the Principal decides knowing what is owed.
 */

export type LeaveResult = { ok: true; publicId: string } | { ok: false; reason: "not_found" | "conflict" };

const now = () => new Date().toISOString();

/** The section id of an enrollment, by its public id bound at `?n`. */
const enrollmentSection = (n: number): string =>
  `(SELECT pv.section_id FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id WHERE en.public_id = ?${n})`;

/** The Co-ordinator asks for a student to be marked Left, and the request goes to the Principal. */
export async function requestLeave(db: D1Database, key: string, actor: string, enrollmentId: string, reason: string): Promise<LeaveResult> {
  const publicId = newPublicId();
  try {
    const { applied } = await recordAudit(
      db,
      key,
      { action: "students.leave.requested", entityType: "student_leave_request", entityPublicId: publicId, actorPublicId: actor, summary: "Request to mark a student Left", after: { enrollmentId } },
      [
        db
          .prepare(
            `INSERT INTO student_leave_requests (public_id, enrollment_id, reason, requested_by_user_id, created_at)
             SELECT ?1, en.id, ?3, u.id, ?4 FROM enrollments en JOIN students st ON st.id = en.student_id, users u
              WHERE en.public_id = ?2 AND u.public_id = ?5 AND en.status = 'active' AND st.status = 'active' AND ${coordinatorForSection(5, enrollmentSection(2))}`,
          )
          .bind(publicId, enrollmentId, reason, now(), actor),
      ],
      { onlyIfLastChanged: true },
    );
    if (!applied) return { ok: false, reason: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return { ok: false, reason: "conflict" };
    throw error;
  }
  const sent = await requestApproval(db, key, actor, { kind: "student_leave", subjectId: publicId });
  if (sent.ok) return { ok: true, publicId };
  // The draft must not hold the student's one open request: close it (D-108's rule for a send that fails).
  await recordAudit(
    db,
    key,
    { action: "students.leave.closed", entityType: "student_leave_request", entityPublicId: publicId, actorPublicId: actor, summary: "Request closed: it could not be sent for approval" },
    [db.prepare("UPDATE student_leave_requests SET status = 'closed' WHERE public_id = ?1 AND status = 'draft'").bind(publicId)],
    { onlyIfLastChanged: true },
  );
  return { ok: false, reason: sent.reason === "conflict" ? "conflict" : "not_found" };
}

interface LeaveRow {
  public_id: string;
  reason: string;
  student: string;
  sid: string;
  class_name: string | null;
  owed: number;
}

const readLeave = (db: D1Database, id: number) =>
  db
    .prepare(
      `SELECT r.public_id, r.reason, st.first_name || ' ' || st.last_name AS student, st.sid,
              pv.name || ' · ' || lv.name || CASE WHEN cl.label IS NULL OR cl.label = '' THEN '' ELSE ' ' || cl.label END AS class_name,
              (SELECT COALESCE(SUM(le.amount_paisa), 0) FROM ledger_entries le WHERE le.enrollment_id = r.enrollment_id) AS owed
         FROM student_leave_requests r JOIN enrollments en ON en.id = r.enrollment_id JOIN students st ON st.id = en.student_id
         LEFT JOIN classes cl ON cl.id = en.class_id LEFT JOIN levels lv ON lv.id = cl.level_id LEFT JOIN programmes pv ON pv.id = lv.programme_id
        WHERE r.id = ?1`,
    )
    .bind(id)
    .first<LeaveRow>();

/** The `student_leave` approval kind. The Co-ordinator's snapshot carries no amounts; the Principal's review shows what is owed. */
export const studentLeaveApprovalHandler: ApprovalHandler = {
  async resolveId(db, publicId) {
    return (await db.prepare("SELECT id FROM student_leave_requests WHERE public_id = ?1").bind(publicId).first<{ id: number }>())?.id ?? null;
  },
  async describe(db, id) {
    const row = await readLeave(db, id);
    if (!row) return null;
    return {
      snapshot: { student: row.student, sid: row.sid, className: row.class_name, reason: row.reason },
      summary: `${row.student} (${row.sid}) to be marked Left: ${row.reason}`,
      subjectPublicId: row.public_id,
    };
  },
  async detail(db, id) {
    const row = await readLeave(db, id);
    if (!row) return null;
    return { kind: "student_leave" as const, student: row.student, sid: row.sid, className: row.class_name, reason: row.reason, owedPaisa: row.owed };
  },
  async currentVersion(db, id) {
    return (await db.prepare("SELECT 1 AS n FROM student_leave_requests WHERE id = ?1").bind(id).first<{ n: number }>())?.n ?? null;
  },
  // The fee account must be settled first (the PM, 2026-10-17): nothing owed and no credit. The Principal can give a discount for
  // what is owed, and the Accountant pays back any credit, then approve. The batch below checks it again.
  async blocker(db, id) {
    const row = await db
      .prepare("SELECT COALESCE(SUM(le.amount_paisa), 0) AS balance FROM student_leave_requests r JOIN ledger_entries le ON le.enrollment_id = r.enrollment_id WHERE r.id = ?1")
      .bind(id)
      .first<{ balance: number }>();
    const balance = row?.balance ?? 0;
    if (balance > 0) return `The fee account must be settled before the student is marked Left: NPR ${formatNpr(balance)} is still owed. Give a discount for that amount on the student's fee page, or have it paid, then approve.`;
    if (balance < 0) return `The fee account must be settled before the student is marked Left: NPR ${formatNpr(-balance)} is in credit. The Accountant pays it back first, then approve.`;
    return null;
  },
  onRequested: (db, id) => [db.prepare("UPDATE student_leave_requests SET status = 'pending' WHERE id = ?1 AND status = 'draft'").bind(id)],
  // Each statement runs only if the one before it changed a row (the engine's own decide statement follows the last): the
  // student is marked Left, the enrollment leaves the class, the fee account closes, and the request is marked approved.
  onApproved: async (db, id, context) => {
    // The enrollment is read from the request here; the statements below still check the request is pending.
    const request = await db.prepare("SELECT enrollment_id FROM student_leave_requests WHERE id = ?1").bind(id).first<{ enrollment_id: number }>();
    return [
      db
        .prepare(
          `UPDATE students SET status = 'left'
            WHERE id = (SELECT en.student_id FROM student_leave_requests r JOIN enrollments en ON en.id = r.enrollment_id WHERE r.id = ?1 AND r.status = 'pending'
                 AND (SELECT COALESCE(SUM(le.amount_paisa), 0) FROM ledger_entries le WHERE le.enrollment_id = r.enrollment_id) = 0)
              AND status = 'active'`,
        )
        .bind(id),
      db
        .prepare(
          `UPDATE enrollments SET status = 'left'
            WHERE id = (SELECT r.enrollment_id FROM student_leave_requests r WHERE r.id = ?1 AND r.status = 'pending') AND status = 'active' AND changes() > 0`,
        )
        .bind(id),
      closeFeeAccountStatement(db, { enrollmentId: request?.enrollment_id ?? 0, leaveRequestId: id, approverPublicId: context.actorPublicId, at: now() }),
      db.prepare("UPDATE student_leave_requests SET status = 'approved' WHERE id = ?1 AND status = 'pending' AND changes() > 0").bind(id),
    ];
  },
  onResolved: (db, id) => [db.prepare("UPDATE student_leave_requests SET status = 'closed' WHERE id = ?1 AND status IN ('draft', 'pending')").bind(id)],
};
