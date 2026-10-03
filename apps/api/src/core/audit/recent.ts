import { rowsOf, type DashboardPart } from "../dashboard";

/**
 * The events the Admin's "Recent activity" shows (D-088): what happened in the school, not every setup click.
 * Sign-ins live in their own view, and nothing here is a secret: the summary is what the audit log already says.
 */
export const ACTIVITY_ACTIONS = [
  "content.published",
  "admissions.approved",
  "admissions.walkin.registered",
  "fees.payment.cash",
  "fees.payment.voucher",
  "fees.payment.online",
  "fees.refund.recorded",
  "results.published",
  "results.recheck.changed",
  "accounts.staff.created",
  "academics.programme.created",
  "approvals.request.approved",
  "approvals.request.declined",
] as const;

/**
 * An admission names the student and their student ID, read from the student record: the
 * entry is written in the same batch that numbers the student, before the ID is known (admin FUT F-04). Earlier
 * entries, which carried an internal id, read the same way.
 */
export const STUDENT_JOIN = "LEFT JOIN students st ON ae.entity_type = 'student' AND st.public_id = ae.entity_public_id";
export const READABLE_SUMMARY = `CASE WHEN ae.action = 'admissions.approved' AND st.id IS NOT NULL
  THEN st.first_name || ' ' || st.last_name || ' admitted (' || st.sid || ')' ELSE ae.summary END`;

export interface ActivityRow {
  id: number;
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actorName: string | null;
  /** The build team's own actions are shown as "Support", never by name (CLAUDE.md section 5). */
  actorIsSupport: number;
}

export function recentActivityPart(db: D1Database, limit = 10): DashboardPart<ActivityRow[]> {
  return {
    statements: [
      db
        .prepare(
          `SELECT ae.id, ae.at, ae.action, ae.entity_type AS entityType, ae.entity_public_id AS entityId, ${READABLE_SUMMARY} AS summary, u.full_name AS actorName,
                  EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = ae.actor_user_id AND ra.role = 'super_admin') AS actorIsSupport
             FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_user_id ${STUDENT_JOIN}
            WHERE ae.action IN (SELECT value FROM json_each(?1))
            ORDER BY ae.id DESC LIMIT ?2`,
        )
        .bind(JSON.stringify(ACTIVITY_ACTIONS), limit),
    ],
    read: ([r]) => rowsOf<ActivityRow>(r),
  };
}
