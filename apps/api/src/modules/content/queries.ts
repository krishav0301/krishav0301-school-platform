import type { ContentKind, PublicContent } from "./schema";

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
    })),
  };
}
