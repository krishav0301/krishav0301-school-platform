import { recordAudit } from "../../core/audit";
import { newPublicId } from "../../core/ids";
import { ContentInputSchema, type ContentChanges, type ContentInput, type ContentKind } from "./schema";

/**
 * All writes to website content. Only an Admin or the Super Admin may write (D-039); Co-ordinator
 * drafts and approval arrive in Phase 3.
 *
 * The person is re-checked INSIDE each write, from the database, never from the sign-in token: the
 * token can outlive a deactivation by up to 30 minutes (D-021, D-024), and publishing is one of the
 * actions that must not. Each change and its audit entry are one batch, and the entry is written
 * only if the change happened (`onlyIfLastChanged`), so a lost race or a failed re-check leaves no
 * false entry. Nothing is deleted.
 */

export type WriteFailure = { ok: false; reason: "not_allowed" | "not_found" };
export type Invalid = { ok: false; reason: "invalid"; message: string };

const KIND_LABEL: Record<ContentKind, string> = { notice: "Notice", holiday: "Holiday", routine: "Routine", vacancy: "Vacancy", post: "Post" };

/** True for an active person who holds an active Admin or Super Admin assignment. `?N` is the person's public id. */
const isPublisher = (n: number) =>
  `EXISTS (SELECT 1 FROM users pu WHERE pu.public_id = ?${n} AND pu.is_active = 1
             AND EXISTS (SELECT 1 FROM role_assignments pra WHERE pra.user_id = pu.id AND pra.is_active = 1 AND pra.role IN ('admin', 'super_admin')))`;

interface ItemRow {
  kind: ContentKind;
  title: string;
  body: string;
  contact: string | null;
  is_urgent: number;
  status: "draft" | "waiting" | "live";
  publish_on: string;
  hide_after: string | null;
}

const toInput = (row: ItemRow): ContentInput => ({
  kind: row.kind,
  title: row.title,
  body: row.body,
  contact: row.contact,
  urgent: row.is_urgent === 1,
  publishOn: row.publish_on,
  hideAfter: row.hide_after,
});

/** One round trip: is the person allowed, and what is the item now? */
async function inspect(db: D1Database, publicId: string, actorPublicId: string) {
  const [allowed, item] = await db.batch([
    db.prepare(`SELECT ${isPublisher(1)} AS ok`).bind(actorPublicId),
    db
      .prepare("SELECT kind, title, body, contact, is_urgent, status, publish_on, hide_after FROM content_items WHERE public_id = ?1")
      .bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    item: (item!.results[0] as unknown as ItemRow | undefined) ?? null,
  };
}

const firstMessage = (error: { issues: { message: string }[] }) => error.issues[0]?.message ?? "That is not valid";

export type CreateResult = { ok: true; publicId: string } | WriteFailure | Invalid;

/** Saves a new item as a draft. */
export async function createContent(
  db: D1Database,
  auditKey: string,
  actorPublicId: string,
  input: ContentInput,
  now: Date = new Date(),
): Promise<CreateResult> {
  const parsed = ContentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const c = parsed.data;

  const publicId = newPublicId();
  const at = now.toISOString();
  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "content.created",
      entityType: "content_item",
      entityPublicId: publicId,
      actorPublicId,
      summary: `${KIND_LABEL[c.kind]} "${c.title}" saved as a draft`,
      after: c,
    },
    [
      db
        .prepare(
          `INSERT INTO content_items
             (public_id, kind, title, body, contact, is_urgent, status, publish_on, hide_after, created_by, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, u.id, ?9, ?9
             FROM users u WHERE u.public_id = ?10 AND ${isPublisher(10)}`,
        )
        .bind(publicId, c.kind, c.title, c.body, c.contact, c.urgent ? 1 : 0, c.publishOn, c.hideAfter, at, actorPublicId),
    ],
    { onlyIfLastChanged: true },
  );

  return applied ? { ok: true, publicId } : { ok: false, reason: "not_allowed" };
}

export type UpdateResult = { ok: true } | WriteFailure | Invalid;

/** Changes some of an item's words or dates. What is sent is merged with what is there, and the whole is checked again. */
export async function updateContent(
  db: D1Database,
  auditKey: string,
  actorPublicId: string,
  publicId: string,
  changes: ContentChanges,
  now: Date = new Date(),
): Promise<UpdateResult> {
  const { allowed, item } = await inspect(db, publicId, actorPublicId);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!item) return { ok: false, reason: "not_found" };

  // Only these fields can change: the kind is fixed, and the status moves only by publishing and taking down.
  const { title, body, contact, urgent, publishOn, hideAfter } = changes;
  const before = toInput(item);
  const merged = {
    ...before,
    ...(title !== undefined && { title }),
    ...(body !== undefined && { body }),
    ...(contact !== undefined && { contact }),
    ...(urgent !== undefined && { urgent }),
    ...(publishOn !== undefined && { publishOn }),
    ...(hideAfter !== undefined && { hideAfter }),
  };
  const parsed = ContentInputSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const after = parsed.data;
  if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true }; // nothing to change, nothing to record

  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "content.updated",
      entityType: "content_item",
      entityPublicId: publicId,
      actorPublicId,
      summary: `${KIND_LABEL[after.kind]} "${after.title}" edited`,
      before,
      after,
    },
    [
      db
        .prepare(
          `UPDATE content_items
              SET title = ?2, body = ?3, contact = ?4, is_urgent = ?5, publish_on = ?6, hide_after = ?7, updated_at = ?8, version = version + 1
            WHERE public_id = ?1 AND ${isPublisher(9)}`,
        )
        .bind(publicId, after.title, after.body, after.contact, after.urgent ? 1 : 0, after.publishOn, after.hideAfter, now.toISOString(), actorPublicId),
    ],
    { onlyIfLastChanged: true },
  );

  return applied ? { ok: true } : { ok: false, reason: "not_allowed" };
}

export type PublishResult = { ok: true } | WriteFailure | { ok: false; reason: "already_live" };

/** Puts a draft on the public site. Two people doing it at once: one wins, the other is told it is already live. */
export async function publishContent(
  db: D1Database,
  auditKey: string,
  actorPublicId: string,
  publicId: string,
  now: Date = new Date(),
): Promise<PublishResult> {
  const first = await inspect(db, publicId, actorPublicId);
  if (!first.allowed) return { ok: false, reason: "not_allowed" };
  if (!first.item) return { ok: false, reason: "not_found" };
  if (first.item.status === "live") return { ok: false, reason: "already_live" };

  const at = now.toISOString();
  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "content.published",
      entityType: "content_item",
      entityPublicId: publicId,
      actorPublicId,
      summary: `${KIND_LABEL[first.item.kind]} "${first.item.title}" published`,
      before: { status: first.item.status },
      after: { status: "live", publishOn: first.item.publish_on, hideAfter: first.item.hide_after },
    },
    [
      db
        .prepare(
          `UPDATE content_items
              SET status = 'live', published_at = ?2, published_by = (SELECT id FROM users WHERE public_id = ?3), updated_at = ?2
            WHERE public_id = ?1 AND status IN ('draft', 'waiting') AND ${isPublisher(3)}`,
        )
        .bind(publicId, at, actorPublicId),
    ],
    { onlyIfLastChanged: true },
  );
  if (applied) return { ok: true };

  // Nothing changed: someone else got there first, or the person was switched off a moment ago.
  const second = await inspect(db, publicId, actorPublicId);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  return second.item?.status === "live" ? { ok: false, reason: "already_live" } : { ok: false, reason: "not_found" };
}

export type UnpublishResult = { ok: true } | WriteFailure | { ok: false; reason: "not_live" };

/** Takes an item off the public site. It goes back to a draft and can be published again. */
export async function unpublishContent(
  db: D1Database,
  auditKey: string,
  actorPublicId: string,
  publicId: string,
  now: Date = new Date(),
): Promise<UnpublishResult> {
  const first = await inspect(db, publicId, actorPublicId);
  if (!first.allowed) return { ok: false, reason: "not_allowed" };
  if (!first.item) return { ok: false, reason: "not_found" };
  if (first.item.status !== "live") return { ok: false, reason: "not_live" };

  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "content.unpublished",
      entityType: "content_item",
      entityPublicId: publicId,
      actorPublicId,
      summary: `${KIND_LABEL[first.item.kind]} "${first.item.title}" taken off the site`,
      before: { status: "live" },
      after: { status: "draft" },
    },
    [
      db
        .prepare(`UPDATE content_items SET status = 'draft', updated_at = ?2 WHERE public_id = ?1 AND status = 'live' AND ${isPublisher(3)}`)
        .bind(publicId, now.toISOString(), actorPublicId),
    ],
    { onlyIfLastChanged: true },
  );
  if (applied) return { ok: true };

  const second = await inspect(db, publicId, actorPublicId);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  return second.item ? { ok: false, reason: "not_live" } : { ok: false, reason: "not_found" };
}
