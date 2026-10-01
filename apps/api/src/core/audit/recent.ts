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
          `SELECT ae.id, ae.at, ae.action, ae.entity_type AS entityType, ae.entity_public_id AS entityId, ae.summary, u.full_name AS actorName,
                  EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = ae.actor_user_id AND ra.role = 'super_admin') AS actorIsSupport
             FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_user_id
            WHERE ae.action IN (SELECT value FROM json_each(?1))
            ORDER BY ae.id DESC LIMIT ?2`,
        )
        .bind(JSON.stringify(ACTIVITY_ACTIONS), limit),
    ],
    read: ([r]) => rowsOf<ActivityRow>(r),
  };
}
