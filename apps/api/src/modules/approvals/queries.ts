import { rowsOf, type DashboardPart } from "../../core/dashboard";
import { adToBsText, nepalDate } from "../../core/dates";
import { getApprovalHandler } from "./handler";
import type { ApprovalList, ApprovalReview, ApprovalSummary, MyApproval, MyApprovalList } from "./schema";

interface SummaryRow {
  public_id: string;
  kind: string;
  subject_public_id: string;
  summary: string;
  snapshot: string;
  requested_by_name: string;
  created_at: string;
  requester_role: string | null;
  mine: number;
}

/** The requester's main role, and whether it is the person reading (`?1`). Support is never named (CLAUDE.md section 5). */
const REQUESTER = `(SELECT ra.role FROM role_assignments ra WHERE ra.user_id = ru.id AND ra.is_active = 1
                    ORDER BY CASE ra.role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'accountant' THEN 2 WHEN 'coordinator' THEN 3 ELSE 4 END LIMIT 1) AS requester_role,
                  ru.public_id = ?1 AS mine`;

const toSummary = (r: SummaryRow): ApprovalSummary => {
  const role = r.requester_role === "coordinator" || r.requester_role === "accountant" || r.requester_role === "admin" || r.requester_role === "super_admin" ? r.requester_role : null;
  return {
    id: r.public_id,
    kind: r.kind as ApprovalSummary["kind"],
    subjectId: r.subject_public_id,
    summary: r.summary,
    snapshot: JSON.parse(r.snapshot),
    requestedBy: role === "super_admin" ? "Support" : r.requested_by_name,
    createdAt: r.created_at,
    requesterRole: role,
    mine: r.mine === 1,
    createdOnBs: adToBsText(nepalDate(new Date(r.created_at))),
  };
};

/**
 * The Admin's inbox: every pending request, oldest first, so the longest-waiting one is seen first. `viewer` marks the
 * reader's own requests, which they may never decide (D-102, admin FUT F-13).
 */
export async function listPending(db: D1Database, viewer: string): Promise<ApprovalList> {
  const { results } = await db
    .prepare(
      `SELECT ar.public_id, ar.kind, ar.subject_public_id, ar.summary, ar.snapshot, ru.full_name AS requested_by_name, ar.created_at, ${REQUESTER}
         FROM approval_requests ar JOIN users ru ON ru.id = ar.requested_by
        WHERE ar.status = 'pending'
        ORDER BY ar.created_at`,
    )
    .bind(viewer)
    .all<SummaryRow>();
  return { requests: results.map(toSummary) };
}

/**
 * One request for the review panel (D-102): who sent it and when, its status, and what it would change, read from the
 * subject as it stands now. A pending request whose subject changed since it was sent shows as `stale`: it can no
 * longer be approved, and the next decision on it records that (the read itself writes nothing).
 */
export async function reviewRequest(db: D1Database, viewer: string, requestPublicId: string): Promise<ApprovalReview | null> {
  const row = await db
    .prepare(
      `SELECT ar.public_id, ar.kind, ar.status, ar.subject_id, ar.subject_version, ar.subject_public_id, ar.summary, ar.snapshot, ar.decision_reason,
              ru.full_name AS requested_by_name, ar.created_at, ${REQUESTER}
         FROM approval_requests ar JOIN users ru ON ru.id = ar.requested_by
        WHERE ar.public_id = ?2`,
    )
    .bind(viewer, requestPublicId)
    .first<SummaryRow & { status: string; subject_id: number; subject_version: number; decision_reason: string | null }>();
  if (!row) return null;
  const handler = getApprovalHandler(row.kind);
  const [detail, version] = handler ? await Promise.all([handler.detail ? handler.detail(db, row.subject_id) : Promise.resolve(null), row.status === "pending" ? handler.currentVersion(db, row.subject_id) : Promise.resolve(row.subject_version)]) : [null, null];
  const stale = row.status === "pending" && version !== row.subject_version;
  return {
    request: toSummary(row),
    status: stale ? "stale" : (row.status as ApprovalReview["status"]),
    decisionReason: row.decision_reason,
    detail,
  };
}

/** The requester's own requests, any status, newest first, with the decline reason when there is one. */
export async function listMine(db: D1Database, requesterPublicId: string): Promise<MyApprovalList> {
  const { results } = await db
    .prepare(
      `SELECT ar.public_id, ar.kind, ar.status, ar.subject_public_id, ar.summary, ar.snapshot, ru.full_name AS requested_by_name, ar.created_at, ar.decision_reason, ${REQUESTER}
         FROM approval_requests ar JOIN users ru ON ru.id = ar.requested_by
        WHERE ru.public_id = ?1
        ORDER BY ar.created_at DESC`,
    )
    .bind(requesterPublicId)
    .all<SummaryRow & { status: string; decision_reason: string | null }>();
  return {
    requests: results.map(
      (r): MyApproval => ({
        ...toSummary(r),
        status: r.status as MyApproval["status"],
        decisionReason: r.decision_reason,
      }),
    ),
  };
}

/** The dashboard's pending approvals (D-088): how many wait, by kind. */
export function approvalsDashboardPart(db: D1Database): DashboardPart<{ kind: string; count: number }[]> {
  return {
    statements: [db.prepare("SELECT kind, COUNT(*) AS count FROM approval_requests WHERE status = 'pending' GROUP BY kind ORDER BY kind")],
    read: ([r]) => rowsOf<{ kind: string; count: number }>(r),
  };
}
