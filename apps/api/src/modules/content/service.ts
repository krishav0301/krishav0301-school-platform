import { recordAudit } from "../../core/audit";
import { adToBsText, nepalMinute } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { registerApprovalHandler, type ApprovalHandler } from "../approvals/service";
import { stateOf } from "./queries";
import { ContentInputSchema, type ContentChanges, type ContentInput, type ContentKind, type ContentState } from "./schema";

/**
 * All writes to website content. A Co-ordinator may draft and edit (D-061; sent for approval, never
 * published directly); only an Admin or the Super Admin may publish, take down, or touch a live item.
 *
 * The person is re-checked INSIDE each write, from the database, never from the sign-in token: the
 * token can outlive a deactivation by up to 30 minutes (D-021, D-024), and publishing is one of the
 * actions that must not. Each change and its audit entry are one batch, and the entry is written
 * only if the change happened (`onlyIfLastChanged`), so a lost race or a failed re-check leaves no
 * false entry. Nothing is deleted.
 */

export type WriteFailure = { ok: false; reason: "not_allowed" | "not_found" };
export type Invalid = { ok: false; reason: "invalid"; message: string };

const KIND_LABEL: Record<ContentKind, string> = {
  notice: "Notice",
  holiday: "Holiday",
  routine: "Routine",
  vacancy: "Vacancy",
  post: "News",
  event: "Event",
  information: "Information",
};

/** True for an active person who holds an active Admin or Super Admin assignment. `?N` is the person's public id. */
const isPublisher = (n: number) =>
  `EXISTS (SELECT 1 FROM users pu WHERE pu.public_id = ?${n} AND pu.is_active = 1
             AND EXISTS (SELECT 1 FROM role_assignments pra WHERE pra.user_id = pu.id AND pra.is_active = 1 AND pra.role IN ('admin', 'super_admin')))`;

/**
 * True for an active Co-ordinator, Admin or Super Admin (D-061): who may draft or edit content. Content
 * is whole-school, so drafting needs no section. Publishing and taking down stay `isPublisher`-only
 * (D-039): the Admin keeps publishing directly, and approval only gates the Co-ordinator's own path there.
 */
const mayDraft = (n: number) =>
  `EXISTS (SELECT 1 FROM users du WHERE du.public_id = ?${n} AND du.is_active = 1
             AND EXISTS (SELECT 1 FROM role_assignments dra WHERE dra.user_id = du.id AND dra.is_active = 1 AND dra.role IN ('coordinator', 'admin', 'super_admin')))`;

interface ItemRow {
  kind: ContentKind;
  title: string;
  body: string;
  contact: string | null;
  is_urgent: number;
  status: "draft" | "waiting" | "live" | "archived";
  publish_on: string;
  publish_time: string;
  hide_after: string | null;
  holiday_from: string | null;
  holiday_to: string | null;
}

const toInput = (row: ItemRow): ContentInput => ({
  kind: row.kind,
  title: row.title,
  body: row.body,
  contact: row.contact,
  urgent: row.is_urgent === 1,
  publishOn: row.publish_on,
  publishTime: row.publish_time,
  hideAfter: row.hide_after,
  holidayFrom: row.holiday_from,
  holidayTo: row.holiday_to,
});

/** One round trip: is the person allowed (by the given guard), and what is the item now? */
async function inspect(db: D1Database, publicId: string, actorPublicId: string, guard: (n: number) => string = isPublisher) {
  const [allowed, item] = await db.batch([
    db.prepare(`SELECT ${guard(1)} AS ok`).bind(actorPublicId),
    db
      .prepare("SELECT kind, title, body, contact, is_urgent, status, publish_on, publish_time, hide_after, holiday_from, holiday_to FROM content_items WHERE public_id = ?1")
      .bind(publicId),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    item: (item!.results[0] as unknown as ItemRow | undefined) ?? null,
  };
}

/**
 * One round trip: may this person edit this item, given both what they are and what the item is now?
 * A publisher may edit anything; a drafting Co-ordinator may edit a draft or a waiting item, but a live (or
 * archived, once-live) item stays the publisher's alone (D-039 keeps the Admin publishing directly, and an unreviewed edit to
 * something already public would undo the point of gating the way there).
 */
async function inspectForEdit(db: D1Database, publicId: string, actorPublicId: string) {
  const [publisher, drafter, item] = await db.batch([
    db.prepare(`SELECT ${isPublisher(1)} AS ok`).bind(actorPublicId),
    db.prepare(`SELECT ${mayDraft(1)} AS ok`).bind(actorPublicId),
    db
      .prepare("SELECT kind, title, body, contact, is_urgent, status, publish_on, publish_time, hide_after, holiday_from, holiday_to FROM content_items WHERE public_id = ?1")
      .bind(publicId),
  ]);
  const isPublisherActor = (publisher!.results[0] as { ok: number } | undefined)?.ok === 1;
  const isDrafterActor = (drafter!.results[0] as { ok: number } | undefined)?.ok === 1;
  const row = (item!.results[0] as unknown as ItemRow | undefined) ?? null;
  const allowed = isPublisherActor || (isDrafterActor && row !== null && (row.status === "draft" || row.status === "waiting"));
  return { allowed, item: row };
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
             (public_id, kind, title, body, contact, is_urgent, status, publish_on, hide_after, created_by, created_at, updated_at, holiday_from, holiday_to, publish_time)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, u.id, ?9, ?9, ?11, ?12, ?13
             FROM users u WHERE u.public_id = ?10 AND ${mayDraft(10)}`,
        )
        .bind(publicId, c.kind, c.title, c.body, c.contact, c.urgent ? 1 : 0, c.publishOn, c.hideAfter, at, actorPublicId, c.holidayFrom, c.holidayTo, c.publishTime),
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
  const { allowed, item } = await inspectForEdit(db, publicId, actorPublicId);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!item) return { ok: false, reason: "not_found" };

  // Only these fields can change: the kind is fixed, and the status moves only by publishing and taking down.
  const { title, body, contact, urgent, publishOn, publishTime, hideAfter, holidayFrom, holidayTo } = changes;
  const before = toInput(item);
  const merged = {
    ...before,
    ...(title !== undefined && { title }),
    ...(body !== undefined && { body }),
    ...(contact !== undefined && { contact }),
    ...(urgent !== undefined && { urgent }),
    ...(publishOn !== undefined && { publishOn }),
    ...(publishTime !== undefined && { publishTime }),
    ...(hideAfter !== undefined && { hideAfter }),
    ...(holidayFrom !== undefined && { holidayFrom }),
    ...(holidayTo !== undefined && { holidayTo }),
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
              SET title = ?2, body = ?3, contact = ?4, is_urgent = ?5, publish_on = ?6, hide_after = ?7, updated_at = ?8,
                  holiday_from = ?10, holiday_to = ?11, publish_time = ?12, version = version + 1
            WHERE public_id = ?1 AND (${isPublisher(9)} OR (${mayDraft(9)} AND status IN ('draft', 'waiting')))`,
        )
        .bind(publicId, after.title, after.body, after.contact, after.urgent ? 1 : 0, after.publishOn, after.hideAfter, now.toISOString(), actorPublicId, after.holidayFrom, after.holidayTo, after.publishTime),
    ],
    { onlyIfLastChanged: true },
  );

  return applied ? { ok: true } : { ok: false, reason: "not_allowed" };
}

export type PublishResult = { ok: true; state: ContentState } | WriteFailure | { ok: false; reason: "already_live" | "archived" };

/**
 * Puts a draft on the public site. It shows from its publish day and time: if that is still to come, the
 * answer's `state` is "scheduled" and it appears then by itself (D-098). Two people doing it at once: one
 * wins, the other is told it is already live. An archived item goes back to the drafts first.
 */
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
  if (first.item.status === "archived") return { ok: false, reason: "archived" };

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
      after: { status: "live", publishOn: first.item.publish_on, publishTime: first.item.publish_time, hideAfter: first.item.hide_after },
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
  if (applied) return { ok: true, state: stateOf("live", first.item.publish_on, first.item.publish_time, first.item.hide_after, nepalMinute(now)) };

  // Nothing changed: someone else got there first, or the person was switched off a moment ago.
  const second = await inspect(db, publicId, actorPublicId);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  return second.item?.status === "live" ? { ok: false, reason: "already_live" } : { ok: false, reason: "not_found" };
}

export type UnpublishResult = { ok: true } | WriteFailure | { ok: false; reason: "not_live" };

/** Takes an item off the public site, or out of the archive: either way it goes back to a draft and can be published again. */
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
  const from = first.item.status;
  if (from !== "live" && from !== "archived") return { ok: false, reason: "not_live" };

  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "content.unpublished",
      entityType: "content_item",
      entityPublicId: publicId,
      actorPublicId,
      summary: `${KIND_LABEL[first.item.kind]} "${first.item.title}" ${from === "live" ? "taken off the site" : "moved from the archive to the drafts"}`,
      before: { status: from },
      after: { status: "draft" },
    },
    [
      db
        .prepare(
          `UPDATE content_items SET status = 'draft', archived_at = NULL, archived_by = NULL, updated_at = ?2, version = version + 1
            WHERE public_id = ?1 AND status = ?4 AND ${isPublisher(3)}`,
        )
        .bind(publicId, now.toISOString(), actorPublicId, from),
    ],
    { onlyIfLastChanged: true },
  );
  if (applied) return { ok: true };

  const second = await inspect(db, publicId, actorPublicId);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  return second.item ? { ok: false, reason: "not_live" } : { ok: false, reason: "not_found" };
}

export type ArchiveResult = { ok: true } | WriteFailure | { ok: false; reason: "already_archived" | "waiting" };

/**
 * Archives an item (D-098): it leaves the website at once, or never reaches it, and is kept as a record.
 * Nothing is deleted. A draft or a live item may be archived; an item waiting for approval is the
 * approval's to settle first. "Move to drafts" (`unpublishContent`) brings it back.
 */
export async function archiveContent(
  db: D1Database,
  auditKey: string,
  actorPublicId: string,
  publicId: string,
  now: Date = new Date(),
): Promise<ArchiveResult> {
  const first = await inspect(db, publicId, actorPublicId);
  if (!first.allowed) return { ok: false, reason: "not_allowed" };
  if (!first.item) return { ok: false, reason: "not_found" };
  if (first.item.status === "archived") return { ok: false, reason: "already_archived" };
  if (first.item.status === "waiting") return { ok: false, reason: "waiting" };

  const at = now.toISOString();
  const from = first.item.status;
  const { applied } = await recordAudit(
    db,
    auditKey,
    {
      action: "content.archived",
      entityType: "content_item",
      entityPublicId: publicId,
      actorPublicId,
      summary: `${KIND_LABEL[first.item.kind]} "${first.item.title}" archived`,
      before: { status: from },
      after: { status: "archived" },
    },
    [
      db
        .prepare(
          `UPDATE content_items
              SET status = 'archived', archived_at = ?2, archived_by = (SELECT id FROM users WHERE public_id = ?3), updated_at = ?2, version = version + 1
            WHERE public_id = ?1 AND status = ?4 AND ${isPublisher(3)}`,
        )
        .bind(publicId, at, actorPublicId, from),
    ],
    { onlyIfLastChanged: true },
  );
  if (applied) return { ok: true };

  const second = await inspect(db, publicId, actorPublicId);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  if (!second.item) return { ok: false, reason: "not_found" };
  return second.item.status === "waiting" ? { ok: false, reason: "waiting" } : { ok: false, reason: "already_archived" };
}

// --- The approval handler (D-061) ---------------------------------------------------------------------

interface HandlerRow {
  public_id: string;
  kind: ContentKind;
  title: string;
  version: number;
}

/**
 * How `content` plugs into the generic approvals engine. `onRequested`/`onApproved`/`onResolved` each
 * change only `status`, conditioned on the item's own current status: the two tables' statuses move in
 * lockstep by construction (a pending request exists exactly while its content item is `waiting`), so
 * neither statement needs to reference the other's table.
 */
export const contentApprovalHandler: ApprovalHandler = {
  async resolveId(db, publicId) {
    const row = await db.prepare("SELECT id FROM content_items WHERE public_id = ?1").bind(publicId).first<{ id: number }>();
    return row?.id ?? null;
  },
  async describe(db, id) {
    const row = await db.prepare("SELECT public_id, kind, title, version FROM content_items WHERE id = ?1").bind(id).first<HandlerRow>();
    if (!row) return null;
    return { snapshot: { title: row.title, kind: row.kind }, summary: `${KIND_LABEL[row.kind]} "${row.title}"`, subjectPublicId: row.public_id };
  },
  /** What the Principal reads before deciding (D-102): the item's kind, title and the start of its text, and its dates. */
  async detail(db, id) {
    const row = await db
      .prepare("SELECT kind, title, substr(body, 1, 1501) AS body, publish_on, holiday_from, holiday_to FROM content_items WHERE id = ?1")
      .bind(id)
      .first<{ kind: string; title: string; body: string; publish_on: string; holiday_from: string | null; holiday_to: string | null }>();
    if (!row) return null;
    const bs = (ad: string | null) => (ad ? adToBsText(ad.slice(0, 10)) : null);
    return {
      kind: "website_content" as const,
      contentKind: row.kind,
      title: row.title,
      bodyPreview: row.body.slice(0, 1500),
      bodyTruncated: row.body.length > 1500,
      publishOnBs: bs(row.publish_on),
      holidayFromBs: bs(row.holiday_from),
      holidayToBs: bs(row.holiday_to),
    };
  },
  async currentVersion(db, id) {
    const row = await db.prepare("SELECT version FROM content_items WHERE id = ?1").bind(id).first<{ version: number }>();
    return row?.version ?? null;
  },
  onRequested: (db, id) => [db.prepare("UPDATE content_items SET status = 'waiting' WHERE id = ?1 AND status = 'draft'").bind(id)],
  onApproved: (db, id) =>
    // The approver is the Admin who decided, not attributed here as `published_by`: this is a small,
    // deliberate gap (D-061), since direct publish already has its own attribution and the design does
    // not ask for a second one.
    [db.prepare("UPDATE content_items SET status = 'live', published_at = ?2 WHERE id = ?1 AND status = 'waiting'").bind(id, new Date().toISOString())],
  onResolved: (db, id) => [db.prepare("UPDATE content_items SET status = 'draft' WHERE id = ?1 AND status = 'waiting'").bind(id)],
};

export function registerContentApprovalHandler(): void {
  registerApprovalHandler("website_content", contentApprovalHandler);
}
