import { adToBsText, nepalDate, nepalTime } from "../dates";
import { READABLE_SUMMARY, STUDENT_JOIN } from "./recent";

/**
 * The Admin's Audit trail and Sign-ins views (CLAUDE.md section 6, D-102, admin FUT F-11): every audit entry, newest
 * first, and every sign-in attempt, in pages. Read only: nothing here writes, and no one may edit or delete an entry
 * (`audit.edit` is granted to no role). The build team's own actions and sign-ins show as "Support", never by name or
 * email (CLAUDE.md section 5). Each page is one round trip: the rows and the count in one batch.
 */

export const AUDIT_PAGE_SIZE = 25;

/** The areas of the school an entry belongs to, by the first part of its action ("fees.payment.cash" is Fees). */
export const AUDIT_AREAS = {
  people: ["accounts.", "account."],
  structure: ["academics.", "setup."],
  admissions: ["admissions.", "students."],
  daily: ["attendance.", "activity.", "notes.", "assignments."],
  fees: ["fees."],
  results: ["results.", "marks."],
  approvals: ["approvals."],
  website: ["content.", "site.", "branding.", "config."],
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;

export interface AuditTrailRow {
  id: number;
  onBs: string | null;
  time: string;
  at: string;
  action: string;
  entityType: string;
  summary: string;
  reason: string | null;
  /** The person's name; "Support" stands for the build team, and null for the system itself. */
  actor: string | null;
}

export interface SignInRow {
  id: number;
  onBs: string | null;
  time: string;
  at: string;
  /** The person's name when the email belongs to someone; "Support" for the build team. */
  name: string | null;
  /** The email tried: hidden for the build team's own sign-ins. */
  email: string;
  success: boolean;
  /** Why it failed (bad_password, unknown_user, inactive, locked, two_factor_failed, ...), or a note on a success. */
  reason: string | null;
  ip: string | null;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

const IS_SUPPORT = (userColumn: string) => `EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = ${userColumn} AND ra.role = 'super_admin')`;
const like = (q: string | undefined) => (q && q.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);
const when = (at: string) => {
  const instant = new Date(at);
  return { onBs: adToBsText(nepalDate(instant)), time: nepalTime(instant) };
};

/** The first text after every text that starts with `prefix`: "fees." gives "fees/". With it a prefix is an index range. */
const pastPrefix = (prefix: string) => prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);

/**
 * One page of the audit trail, newest first, optionally of one area and matching a search of the summary or the person.
 *
 * Cost (D-108): the log only ever grows, so nothing here reads all of it unless a search asks to. An area is a few index
 * ranges over the action (`audit_events_action`), not a LIKE. The page count without a filter is the newest id: the
 * log is insert-only (triggers forbid update and delete), so its ids run from 1 without a gap. A search of words has to
 * look at every entry; that is the one read that grows with the log.
 */
export async function auditTrail(db: D1Database, options: { page?: number; area?: AuditArea; q?: string }): Promise<Paged<AuditTrailRow>> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const prefixes: readonly string[] = options.area ? AUDIT_AREAS[options.area] : [];
  const search = like(options.q);
  // ?1 the search, ?2 and ?3 the page; an area's ranges follow from ?4, two values each.
  const area = (from: number) => (prefixes.length > 0 ? `(${prefixes.map((_, i) => `(ae.action >= ?${from + 2 * i} AND ae.action < ?${from + 1 + 2 * i})`).join(" OR ")})` : "1");
  const ranges = prefixes.flatMap((p) => [p, pastPrefix(p)]);
  const matches = `(?1 IS NULL OR ${READABLE_SUMMARY} LIKE ?1 ESCAPE '\\' OR (u.full_name LIKE ?1 ESCAPE '\\' AND NOT ${IS_SUPPORT("ae.actor_user_id")}))`;
  const count = search
    ? db.prepare(`SELECT COUNT(*) AS n FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_user_id ${STUDENT_JOIN} WHERE ${area(2)} AND ${matches}`).bind(search, ...ranges)
    : prefixes.length > 0
      ? db.prepare(`SELECT COUNT(*) AS n FROM audit_events ae WHERE ${area(1)}`).bind(...ranges)
      : db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM audit_events");
  const [rows, total] = await db.batch([
    db
      .prepare(
        `SELECT ae.id, ae.at, ae.action, ae.entity_type AS entityType, ${READABLE_SUMMARY} AS summary, ae.reason,
                CASE WHEN ae.actor_user_id IS NULL THEN NULL WHEN ${IS_SUPPORT("ae.actor_user_id")} THEN 'Support' ELSE u.full_name END AS actor
           FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_user_id ${STUDENT_JOIN}
          WHERE ${area(4)} AND ${matches}
          ORDER BY ae.id DESC LIMIT ?2 OFFSET ?3`,
      )
      .bind(search, AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE, ...ranges),
    count,
  ]);
  type Row = Omit<AuditTrailRow, "onBs" | "time">;
  return {
    rows: (rows!.results as unknown as Row[]).map((r) => ({ ...r, ...when(r.at) })),
    total: (total!.results[0] as { n: number }).n,
    page,
    pageSize: AUDIT_PAGE_SIZE,
  };
}

/**
 * One page of sign-in attempts, newest first, optionally only the failed ones, or those matching a search of the email or
 * name. Like the audit trail (D-108): insert-only, so the count of all is the newest id, and of the failed ones an index
 * of failures alone (`sign_in_events_failed`); only a search reads every attempt.
 */
export async function signInLog(db: D1Database, options: { page?: number; failedOnly?: boolean; q?: string }): Promise<Paged<SignInRow>> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const search = like(options.q);
  const failedOnly = options.failedOnly ? 1 : 0;
  const where = `(?1 = 0 OR se.success = 0)
     AND (?2 IS NULL OR ((se.email_tried LIKE ?2 ESCAPE '\\' OR u.full_name LIKE ?2 ESCAPE '\\') AND NOT ${IS_SUPPORT("u.id")}))`;
  const PERSON = `LEFT JOIN users u ON u.id = COALESCE(se.user_id, (SELECT x.id FROM users x WHERE x.email = se.email_tried))`;
  const count = search
    ? db.prepare(`SELECT COUNT(*) AS n FROM sign_in_events se ${PERSON} WHERE ${where}`).bind(failedOnly, search)
    : failedOnly
      ? db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE success = 0")
      : db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM sign_in_events");
  const [rows, total] = await db.batch([
    db
      .prepare(
        `SELECT se.id, se.at, se.success, se.reason, se.ip,
                CASE WHEN ${IS_SUPPORT("u.id")} THEN 'Support' ELSE u.full_name END AS name,
                CASE WHEN ${IS_SUPPORT("u.id")} THEN 'Support' ELSE se.email_tried END AS email
           FROM sign_in_events se ${PERSON}
          WHERE ${where}
          ORDER BY se.id DESC LIMIT ?3 OFFSET ?4`,
      )
      .bind(failedOnly, search, AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE),
    count,
  ]);
  type Row = Omit<SignInRow, "onBs" | "time" | "success"> & { success: number };
  return {
    rows: (rows!.results as unknown as Row[]).map((r) => ({ ...r, success: r.success === 1, ...when(r.at) })),
    total: (total!.results[0] as { n: number }).n,
    page,
    pageSize: AUDIT_PAGE_SIZE,
  };
}
