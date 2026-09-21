import { adToBsText } from "../../core/dates";
import type { AdminContentItem, AdminContentSummary, ContentKind, ContentState, PublicContent } from "./schema";

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
}

/**
 * What the public may see on `today` (an AD day by Nepal's clock): live items from their publish
 * day to the end of their hide-after day. Urgent first, then newest. One database round trip.
 */
export async function listPublicContent(
  db: D1Database,
  today: string,
  filter: { kind?: ContentKind } = {},
): Promise<PublicContent> {
  const { results } = await db
    .prepare(
      `SELECT public_id, kind, title, body, contact, is_urgent, publish_on, hide_after
         FROM content_items
        WHERE status = 'live'
          AND publish_on <= ?1
          AND (hide_after IS NULL OR hide_after >= ?1)
          AND (?2 IS NULL OR kind = ?2)
        ORDER BY is_urgent DESC, publish_on DESC, id DESC
        LIMIT ?3`,
    )
    .bind(today, filter.kind ?? null, PUBLIC_CONTENT_LIMIT)
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
    })),
  };
}

/** The most items the Admin list carries. Newest touched first, so what matters is always inside it. */
export const ADMIN_CONTENT_LIMIT = 200;

interface AdminRow extends Row {
  status: "draft" | "waiting" | "live";
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

/** Where an item stands on `today`. Only a live item can be scheduled, showing or expired. */
export function stateOf(status: AdminRow["status"], publishOn: string, hideAfter: string | null, today: string): ContentState {
  if (status !== "live") return status;
  if (publishOn > today) return "scheduled";
  if (hideAfter !== null && hideAfter < today) return "expired";
  return "showing";
}

type AdminSummaryRow = Omit<AdminRow, "body" | "contact">;

const summaryOf = (r: AdminSummaryRow, today: string): AdminContentSummary => ({
  id: r.public_id,
  kind: r.kind,
  title: r.title,
  urgent: r.is_urgent === 1,
  status: r.status,
  state: stateOf(r.status, r.publish_on, r.hide_after, today),
  publishOn: r.publish_on,
  hideAfter: r.hide_after,
  publishOnBs: adToBsText(r.publish_on),
  hideAfterBs: r.hide_after === null ? null : adToBsText(r.hide_after),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  publishedAt: r.published_at,
});

/**
 * Every item in every state, for the Admin list: most recently touched first, WITHOUT the text (a
 * list of 200 long notices would be megabytes on a phone; the text comes with one item, see
 * `getAdminContent`). One database round trip. `state` is worked out here so the screen never
 * compares days itself. `limit` is at most 200.
 */
export async function listAdminContent(
  db: D1Database,
  today: string,
  filter: { kind?: ContentKind; state?: ContentState; limit?: number } = {},
): Promise<{ items: AdminContentSummary[]; todayBs: string | null }> {
  const { results } = await db
    .prepare(
      `SELECT public_id, kind, title, is_urgent, status, publish_on, hide_after, created_at, updated_at, published_at
         FROM content_items
        WHERE (?1 IS NULL OR kind = ?1)
          AND (?2 IS NULL OR CASE
                 WHEN status <> 'live' THEN status
                 WHEN publish_on > ?3 THEN 'scheduled'
                 WHEN hide_after IS NOT NULL AND hide_after < ?3 THEN 'expired'
                 ELSE 'showing' END = ?2)
        ORDER BY updated_at DESC, id DESC
        LIMIT ?4`,
    )
    .bind(filter.kind ?? null, filter.state ?? null, today, Math.min(filter.limit ?? ADMIN_CONTENT_LIMIT, ADMIN_CONTENT_LIMIT))
    .all<AdminSummaryRow>();

  return { items: results.map((r) => summaryOf(r, today)), todayBs: adToBsText(today) };
}

/** One item with its text, for the edit form. Null if there is no such item. One database round trip. */
export async function getAdminContent(db: D1Database, publicId: string, today: string): Promise<AdminContentItem | null> {
  const row = await db
    .prepare(
      `SELECT public_id, kind, title, body, contact, is_urgent, status, publish_on, hide_after, created_at, updated_at, published_at
         FROM content_items WHERE public_id = ?1`,
    )
    .bind(publicId)
    .first<AdminRow>();
  return row ? { ...summaryOf(row, today), body: row.body, contact: row.contact } : null;
}
