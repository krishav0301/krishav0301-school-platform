import { z } from "@hono/zod-openapi";

import { nepalDate } from "../../core/dates";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { listAdminContent, listPublicContent } from "./queries";
import {
  AdminContentSchema,
  ContentChangesSchema,
  ContentKindSchema,
  ContentStateSchema,
  CreateContentSchema,
  PublicContentSchema,
} from "./schema";
import { createContent, publishContent, unpublishContent, updateContent } from "./service";

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
      const content = await listPublicContent(c.env.DB, nepalDate(new Date()), kind ? { kind } : {});
      c.header("Cache-Control", PUBLIC_CONTENT_CACHE);
      return c.json(content, 200);
    },
  );

  // --- The Admin's editing routes ------------------------------------------------------------------
  // Phase 2: only the Admin and the Super Admin, so all use `content.publish`. When Co-ordinator
  // drafts arrive (Phase 3), creating and editing move to `content.draft`.

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/content",
      operationId: "list_content",
      tags: ["content"],
      description: "Every item in every state, most recently touched first, at most 200. `state` says where each stands today.",
      access: { action: "content.publish" },
      request: { query: z.object({ kind: ContentKindSchema.optional(), state: ContentStateSchema.optional() }) },
      responses: { 200: { description: "The items", content: json(AdminContentSchema) } },
    },
    async (c) => {
      const { kind, state } = c.req.valid("query");
      const content = await listAdminContent(c.env.DB, nepalDate(new Date()), { ...(kind && { kind }), ...(state && { state }) });
      c.header("Cache-Control", "no-store");
      return c.json(content, 200);
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
      access: { action: "content.publish" },
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
      access: { action: "content.publish" },
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
      description: "Puts a draft on the public site, from its publish day. Two people doing it at once: one succeeds, the other gets 409.",
      access: { action: "content.publish" },
      request: { params: IdParam },
      responses: {
        200: { description: "Published", content: json(z.object({ ok: z.literal(true) })) },
        403: { description: "Not allowed (for example, switched off since signing in)", content: json(ErrorSchema) },
        404: { description: "No such item", content: json(ErrorSchema) },
        409: { description: "Already live", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const result = await publishContent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "already_live") return c.json({ error: "already_live" }, 409);
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
      description: "Takes an item off the public site. It goes back to a draft and can be published again.",
      access: { action: "content.publish" },
      request: { params: IdParam },
      responses: {
        200: { description: "Taken down", content: json(z.object({ ok: z.literal(true) })) },
        403: { description: "Not allowed (for example, switched off since signing in)", content: json(ErrorSchema) },
        404: { description: "No such item", content: json(ErrorSchema) },
        409: { description: "It is not live", content: json(ErrorSchema) },
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
}
