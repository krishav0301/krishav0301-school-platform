import { rowsOf, type DashboardPart } from "../../core/dashboard";
import { adToBsText } from "../../core/dates";
import { STATES_OF_GROUP, type AdminContentItem, type AdminContentSummary, type ContentGroup, type ContentKind, type ContentState, type PublicContent } from "./schema";

/** The most items one answer carries. A school posts a handful a week; this is a ceiling, not a page size. */
export const PUBLIC_CONTENT_LIMIT = 200;

interface Row {
  public_id: string;
  kind: ContentKind;
  title: string;
  body: string;
  contact: string | null;
  is_urgent: number;
  publish_on: string;
  hide_after: string | null;
  holiday_from: string | null;
  holiday_to: string | null;
}

/** A holiday's own days (D-094), AD and in Bikram Sambat; all null for any other kind. */
const holidayDates = (r: Pick<Row, "holiday_from" | "holiday_to">) => ({
  holidayFrom: r.holiday_from,
  holidayTo: r.holiday_to,
  holidayFromBs: r.holiday_from === null ? null : adToBsText(r.holiday_from),
  holidayToBs: r.holiday_to === null ? null : adToBsText(r.holiday_to),
});

/**
 * The moment to judge visibility at: "YYYY-MM-DD HH:MM" by Nepal's clock. A bare day means the end of that
 * day, so "what shows on this day" keeps its meaning for callers that only know the day.
 */
export function momentOf(at: string): { minute: string; day: string } {
  return at.length === 10 ? { minute: `${at} 23:59`, day: at } : { minute: at, day: at.slice(0, 10) };
}

/**
 * What the public may see at `at` (Nepal time, "YYYY-MM-DD HH:MM", or a bare day for the end of it): live
 * items from their publish day and time to the end of their hide-after day. Urgent first, then newest.
 * Worked out in the query on every request, so scheduled items appear, and finished ones go, with no job
 * having to run (D-039, D-098). One database round trip.
 */
export async function listPublicContent(
  db: D1Database,
  at: string,
  filter: { kind?: ContentKind } = {},
): Promise<PublicContent> {
  const { minute, day } = momentOf(at);
  const { results } = await db
    .prepare(
      `SELECT public_id, kind, title, body, contact, is_urgent, publish_on, hide_after, holiday_from, holiday_to
         FROM content_items
        WHERE status = 'live'
          AND publish_on <= ?4
          AND publish_on || ' ' || publish_time <= ?1
          AND (hide_after IS NULL OR hide_after >= ?4)
          AND (?2 IS NULL OR kind = ?2)
        ORDER BY is_urgent DESC, publish_on DESC, publish_time DESC, id DESC
        LIMIT ?3`,
    )
    .bind(minute, filter.kind ?? null, PUBLIC_CONTENT_LIMIT, day)
    .all<Row>();

  return {
    items: results.map((r) => ({
      id: r.public_id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      contact: r.contact,
      urgent: r.is_urgent === 1,
      publishedOn: r.publish_on,
      hideAfter: r.hide_after,
      publishedOnBs: adToBsText(r.publish_on),
      hideAfterBs: r.hide_after === null ? null : adToBsText(r.hide_after),
      ...holidayDates(r),
    })),
  };
}

/** The most items one page of the Admin list carries. */
export const ADMIN_CONTENT_LIMIT = 50;
/** A page of the Admin list when none is asked for. */
export const ADMIN_PAGE_SIZE = 10;

interface AdminRow extends Row {
  status: "draft" | "waiting" | "live" | "archived";
  publish_time: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
  author_name: string | null;
  author_is_support: number;
}

/** Where an item stands at `at` (see `momentOf`). Only a live item can be scheduled, showing or expired. */
export function stateOf(status: AdminRow["status"], publishOn: string, publishTime: string, hideAfter: string | null, at: string): ContentState {
  if (status !== "live") return status;
  const { minute, day } = momentOf(at);
  if (`${publishOn} ${publishTime}` > minute) return "scheduled";
  if (hideAfter !== null && hideAfter < day) return "expired";
  return "showing";
}

/** The same as `stateOf`, in SQL, for filtering and counting. `?M` is the minute and `?D` the day. */
const STATE_SQL = (m: number, d: number) => `CASE
                 WHEN c.status <> 'live' THEN c.status
                 WHEN c.publish_on || ' ' || c.publish_time > ?${m} THEN 'scheduled'
                 WHEN c.hide_after IS NOT NULL AND c.hide_after < ?${d} THEN 'expired'
                 ELSE 'showing' END`;

type AdminSummaryRow = Omit<AdminRow, "body" | "contact"> & { excerpt?: string };

const summaryOf = (r: AdminSummaryRow, at: string): AdminContentSummary => ({
  id: r.public_id,
  kind: r.kind,
  title: r.title,
  urgent: r.is_urgent === 1,
  status: r.status,
  state: stateOf(r.status, r.publish_on, r.publish_time, r.hide_after, at),
  publishOn: r.publish_on,
  publishTime: r.publish_time,
  hideAfter: r.hide_after,
  publishOnBs: adToBsText(r.publish_on),
  hideAfterBs: r.hide_after === null ? null : adToBsText(r.hide_after),
  ...holidayDates(r),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  publishedAt: r.published_at,
  archivedAt: r.archived_at,
  authorName: r.author_is_support === 1 ? null : r.author_name,
  excerpt: r.excerpt ?? "",
});

/** The build team is never shown or found by name (CLAUDE.md section 5). */
const SUPPORT_SQL = `EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = c.created_by AND ra.role = 'super_admin')`;
const AUTHOR_SQL = `u.full_name AS author_name, ${SUPPORT_SQL} AS author_is_support`;

/** "%text%" for LIKE, with the wildcards in the text itself made literal (escape character "\\"). */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export interface AdminContentFilter {
  kind?: ContentKind;
  state?: ContentState;
  group?: ContentGroup;
  /** Words to find in the title, the text or the author's name. */
  q?: string;
  urgent?: boolean;
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface AdminContentPage {
  items: AdminContentSummary[];
  total: number;
  page: number;
  pageSize: number;
  counts: { published: number; drafts: number; scheduled: number; urgent: number };
  lastPublishedAt: string | null;
  todayBs: string | null;
  nowTime: string;
}

/**
 * One page of the Admin list, most recently touched first, WITHOUT the text (that comes with one item, see
 * `getAdminContent`), with how many match in all, the four figures at the top of the screen, and when anything
 * was last published. Filtering, search and paging happen in the database, so the list stays small however
 * much is posted (D-098). `state` is worked out here so the screen never compares days. One round trip.
 */
export async function listAdminContent(db: D1Database, at: string, filter: AdminContentFilter = {}): Promise<AdminContentPage> {
  const { minute, day } = momentOf(at);
  const pageSize = Math.max(1, Math.min(filter.pageSize ?? ADMIN_PAGE_SIZE, ADMIN_CONTENT_LIMIT));
  const page = Math.max(1, filter.page ?? 1);
  const q = filter.q?.trim() ? likePattern(filter.q.trim()) : null;
  const states = filter.group ? JSON.stringify(STATES_OF_GROUP[filter.group]) : null;
  // ?1 kind, ?2 state, ?3 minute, ?4 day, ?5 states of the group, ?6 search, ?7 urgent
  const where = `WHERE (?1 IS NULL OR c.kind = ?1)
          AND (?2 IS NULL OR ${STATE_SQL(3, 4)} = ?2)
          AND (?5 IS NULL OR ${STATE_SQL(3, 4)} IN (SELECT value FROM json_each(?5)))
          AND (?6 IS NULL OR c.title LIKE ?6 ESCAPE '\\' OR c.body LIKE ?6 ESCAPE '\\' OR (u.full_name LIKE ?6 ESCAPE '\\' AND NOT ${SUPPORT_SQL}))
          AND (?7 IS NULL OR c.is_urgent = ?7)`;
  const binds = [filter.kind ?? null, filter.state ?? null, minute, day, states, q, filter.urgent === undefined ? null : filter.urgent ? 1 : 0];

  const [list, count, figures] = await db.batch([
    db
      .prepare(
        `SELECT c.public_id, c.kind, c.title, substr(c.body, 1, 200) AS excerpt, c.is_urgent, c.status, c.publish_on, c.publish_time, c.hide_after, c.holiday_from, c.holiday_to,
                c.created_at, c.updated_at, c.published_at, c.archived_at, ${AUTHOR_SQL}
           FROM content_items c JOIN users u ON u.id = c.created_by
          ${where}
          ORDER BY c.updated_at DESC, c.id DESC
          LIMIT ?8 OFFSET ?9`,
      )
      .bind(...binds, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM content_items c JOIN users u ON u.id = c.created_by ${where}`).bind(...binds),
    db
      .prepare(
        `SELECT COALESCE(SUM(s = 'showing'), 0) AS published, COALESCE(SUM(s IN ('draft', 'waiting')), 0) AS drafts,
                COALESCE(SUM(s = 'scheduled'), 0) AS scheduled, COALESCE(SUM(urgent = 1 AND s IN ('showing', 'scheduled')), 0) AS urgent,
                (SELECT MAX(published_at) FROM content_items) AS lastPublishedAt
           FROM (SELECT ${STATE_SQL(1, 2)} AS s, c.is_urgent AS urgent FROM content_items c)`,
      )
      .bind(minute, day),
  ]);

  const f = (figures!.results[0] ?? {}) as { published?: number; drafts?: number; scheduled?: number; urgent?: number; lastPublishedAt?: string | null };
  return {
    items: (list!.results as unknown as AdminSummaryRow[]).map((r) => summaryOf(r, at)),
    total: (count!.results[0] as { total: number } | undefined)?.total ?? 0,
    page,
    pageSize,
    counts: { published: f.published ?? 0, drafts: f.drafts ?? 0, scheduled: f.scheduled ?? 0, urgent: f.urgent ?? 0 },
    lastPublishedAt: f.lastPublishedAt ?? null,
    todayBs: adToBsText(day),
    nowTime: minute.slice(11, 16),
  };
}

/** One item with its text, for the edit form. Null if there is no such item. One database round trip. */
export async function getAdminContent(db: D1Database, publicId: string, at: string): Promise<AdminContentItem | null> {
  const row = await db
    .prepare(
      `SELECT c.public_id, c.kind, c.title, c.body, c.contact, c.is_urgent, c.status, c.publish_on, c.publish_time, c.hide_after, c.holiday_from, c.holiday_to,
              c.created_at, c.updated_at, c.published_at, c.archived_at, ${AUTHOR_SQL}
         FROM content_items c JOIN users u ON u.id = c.created_by WHERE c.public_id = ?1`,
    )
    .bind(publicId)
    .first<AdminRow>();
  if (!row) return null;
  const { excerpt: _excerpt, ...summary } = summaryOf(row, at);
  return { ...summary, body: row.body, contact: row.contact };
}

/** The dashboard's website figures (D-088): drafts, items waiting for approval, items live, and the last publish. */
export function contentDashboardPart(db: D1Database): DashboardPart<{ drafts: number; waiting: number; live: number; lastPublishedAt: string | null }> {
  return {
    statements: [
      db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS drafts, COALESCE(SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END), 0) AS waiting,
                COALESCE(SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END), 0) AS live, MAX(published_at) AS lastPublishedAt
           FROM content_items`,
      ),
    ],
    read: ([r]) => rowsOf<{ drafts: number; waiting: number; live: number; lastPublishedAt: string | null }>(r)[0] ?? { drafts: 0, waiting: 0, live: 0, lastPublishedAt: null },
  };
}
