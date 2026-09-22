import type { ApprovalList, ApprovalSummary, MyApproval, MyApprovalList } from "./schema";

interface SummaryRow {
  public_id: string;
  kind: string;
  subject_public_id: string;
  summary: string;
  snapshot: string;
  requested_by_name: string;
  created_at: string;
}

const toSummary = (r: SummaryRow): ApprovalSummary => ({
  id: r.public_id,
  kind: r.kind as ApprovalSummary["kind"],
  subjectId: r.subject_public_id,
  summary: r.summary,
  snapshot: JSON.parse(r.snapshot),
  requestedBy: r.requested_by_name,
  createdAt: r.created_at,
});

/** The Admin's inbox: every pending request, oldest first, so the longest-waiting one is seen first. */
export async function listPending(db: D1Database): Promise<ApprovalList> {
  const { results } = await db
    .prepare(
      `SELECT ar.public_id, ar.kind, ar.subject_public_id, ar.summary, ar.snapshot, ru.full_name AS requested_by_name, ar.created_at
         FROM approval_requests ar JOIN users ru ON ru.id = ar.requested_by
        WHERE ar.status = 'pending'
        ORDER BY ar.created_at`,
    )
    .all<SummaryRow>();
  return { requests: results.map(toSummary) };
}

/** The requester's own requests, any status, newest first, with the decline reason when there is one. */
export async function listMine(db: D1Database, requesterPublicId: string): Promise<MyApprovalList> {
  const { results } = await db
    .prepare(
      `SELECT ar.public_id, ar.kind, ar.status, ar.subject_public_id, ar.summary, ar.snapshot, ru.full_name AS requested_by_name, ar.created_at, ar.decision_reason
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
