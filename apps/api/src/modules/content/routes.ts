import { z } from "@hono/zod-openapi";

import { nepalMinute } from "../../core/dates";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { getAdminContent, listAdminContent, listPublicContent } from "./queries";
import {
  AdminContentItemSchema,
  AdminContentSchema,
  ContentChangesSchema,
  ContentGroupSchema,
  ContentKindSchema,
  ContentStateSchema,
  CreateContentSchema,
  PublicContentSchema,
} from "./schema";
import { archiveContent, createContent, publishContent, unpublishContent, updateContent } from "./service";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("ContentError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("ContentInvalid");
const IdParam = z.object({ id: z.string().regex(/^[0-9a-f]{32}$/) });

/**
 * How long a browser may reuse the public answer. A change shows within about a minute. There is no
 * instant purge: the free workers.dev address has no shared cache to purge, and a purge across the
 * network needs a custom domain and an API token. OPEN: purge on publish once a school has its own
 * domain (D-039).
 */
export const PUBLIC_CONTENT_CACHE = "public, max-age=30, stale-while-revalidate=30";

export function registerContent(app: App): void {
  // --- The public site ---------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/site/content",
      operationId: "site_content",
      tags: ["site"],
      description:
        "The notices, holidays, routines, vacancies and posts the public may read today, by Nepal's clock: live items from their publish day to the end of their hide-after day. Urgent first, then newest. The same for every visitor.",
      access: { action: "site.view" },
      request: { query: z.object({ kind: ContentKindSchema.optional() }) },
      responses: { 200: { description: "What is on the site today", content: json(PublicContentSchema) } },
    },
    async (c) => {
      const { kind } = c.req.valid("query");
      const content = await listPublicContent(c.env.DB, nepalMinute(new Date()), kind ? { kind } : {});
      c.header("Cache-Control", PUBLIC_CONTENT_CACHE);
      return c.json(content, 200);
    },
  );

  // --- The editing routes (D-061) -------------------------------------------------------------------
  // Reading, creating and editing use `content.draft` (Co-ordinator, Admin, Super Admin): the service
  // itself keeps a live item the publisher's alone (`inspectForEdit`). Publishing and taking down stay
  // `content.publish` (Admin, Super Admin only): a Co-ordinator's only way there is an approval.

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/content",
      operationId: "list_content",
      tags: ["content"],
      description:
        "One page of the items, most recently touched first, WITHOUT the text (fetch one item for that), filtered by kind, state or group, urgency and words in the title, text or author's name, all in the database. With how many match, the four figures for the top of the screen, the public website's address and last publish, and today's Bikram Sambat date and Nepal time for a new item. `state` says where each item stands now.",
      access: { action: "content.draft" },
      request: {
        query: z.object({
          kind: ContentKindSchema.optional(),
          state: ContentStateSchema.optional(),
          group: ContentGroupSchema.optional(),
          q: z.string().max(100).optional(),
          urgent: z.enum(["true", "false"]).optional(),
          page: z.coerce.number().int().min(1).max(10_000).optional(),
          pageSize: z.coerce.number().int().min(1).max(50).optional(),
          /** The same as `pageSize` (kept for callers from before D-098). */
          limit: z.coerce.number().int().min(1).max(50).optional(),
        }),
      },
      responses: { 200: { description: "The items", content: json(AdminContentSchema) } },
    },
    async (c) => {
      const { kind, state, group, q, urgent, page, pageSize, limit } = c.req.valid("query");
      const size = pageSize ?? limit;
      const { lastPublishedAt, ...content } = await listAdminContent(c.env.DB, nepalMinute(new Date()), {
        ...(kind && { kind }),
        ...(state && { state }),
        ...(group && { group }),
        ...(q && { q }),
        ...(urgent && { urgent: urgent === "true" }),
        ...(page && { page }),
        ...(size && { pageSize: size }),
      });
      // The address the public reaches; "live" only on the real deployment, so a test site never claims to be the school's website.
      const site = { address: c.env.SITE_ORIGIN ?? null, live: c.env.ENVIRONMENT === "production", lastPublishedAt };
      c.header("Cache-Control", "no-store");
      return c.json({ ...content, site }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/content/{id}",
      operationId: "get_content",
      tags: ["content"],
      description: "One item with its text and contact, for the edit form.",
      access: { action: "content.draft" },
      request: { params: IdParam },
      responses: {
        200: { description: "The item", content: json(AdminContentItemSchema) },
        404: { description: "No such item", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const item = await getAdminContent(c.env.DB, c.req.valid("param").id, nepalMinute(new Date()));
      c.header("Cache-Control", "no-store");
      return item ? c.json(item, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/content",
      operationId: "create_content",
      tags: ["content"],
      description: "Saves a new item as a draft. It is not public until it is published.",
      access: { action: "content.draft" },
      request: { body: { required: true, content: json(CreateContentSchema) } },
      responses: {
        201: { description: "Saved as a draft", content: json(z.object({ id: z.string() })) },
        403: { description: "Not allowed (for example, switched off since signing in)", content: json(ErrorSchema) },
        422: { description: "The content breaks a rule", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      const result = await createContent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      if (result.ok) return c.json({ id: result.publicId }, 201);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      return c.json({ error: "forbidden" }, 403);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/content/{id}",
      operationId: "update_content",
      tags: ["content"],
      description:
        "Changes some of an item's words or dates. Send only what changes. The kind and the status cannot be changed here. A live item's change is public at once.",
      access: { action: "content.draft" },
      request: { params: IdParam, body: { required: true, content: json(ContentChangesSchema) } },
      responses: {
        200: { description: "Saved", content: json(z.object({ ok: z.literal(true) })) },
        403: { description: "Not allowed (for example, switched off since signing in)", content: json(ErrorSchema) },
        404: { description: "No such item", content: json(ErrorSchema) },
        422: { description: "The result would break a rule; nothing changed", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      const result = await updateContent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
      return c.json({ error: "forbidden" }, 403);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/content/{id}/publish",
      operationId: "publish_content",
      tags: ["content"],
      description:
        "Puts a draft on the public site, from its publish day and time: `state` says whether it shows now or is scheduled. Two people doing it at once: one succeeds, the other gets 409. An archived item is moved to the drafts first (409 `archived`).",
      access: { action: "content.publish" },
      request: { params: IdParam },
      responses: {
        200: { description: "Published", content: json(z.object({ ok: z.literal(true), state: ContentStateSchema })) },
        403: { description: "Not allowed (for example, switched off since signing in)", content: json(ErrorSchema) },
        404: { description: "No such item", content: json(ErrorSchema) },
        409: { description: "Already live, or archived", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const result = await publishContent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      if (result.ok) return c.json({ ok: true as const, state: result.state }, 200);
      if (result.reason === "already_live" || result.reason === "archived") return c.json({ error: result.reason }, 409);
      if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
      return c.json({ error: "forbidden" }, 403);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/content/{id}/unpublish",
      operationId: "unpublish_content",
      tags: ["content"],
      description: "Takes an item off the public site, or out of the archive. It goes back to a draft and can be published again.",
      access: { action: "content.publish" },
      request: { params: IdParam },
      responses: {
        200: { description: "Taken down", content: json(z.object({ ok: z.literal(true) })) },
        403: { description: "Not allowed (for example, switched off since signing in)", content: json(ErrorSchema) },
        404: { description: "No such item", content: json(ErrorSchema) },
        409: { description: "It is neither live nor archived", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const result = await unpublishContent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "not_live") return c.json({ error: "not_live" }, 409);
      if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
      return c.json({ error: "forbidden" }, 403);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/content/{id}/archive",
      operationId: "archive_content",
      tags: ["content"],
      description:
        "Archives a draft or a live item (D-098): it is off the website at once and kept as a record, never deleted. Unpublish moves it back to the drafts. An item waiting for approval cannot be archived (409 `waiting`).",
      access: { action: "content.publish" },
      request: { params: IdParam },
      responses: {
        200: { description: "Archived", content: json(z.object({ ok: z.literal(true) })) },
        403: { description: "Not allowed (for example, switched off since signing in)", content: json(ErrorSchema) },
        404: { description: "No such item", content: json(ErrorSchema) },
        409: { description: "Already archived, or waiting for approval", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const result = await archiveContent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "already_archived" || result.reason === "waiting") return c.json({ error: result.reason }, 409);
      if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
      return c.json({ error: "forbidden" }, 403);
    },
  );
}
