import { z } from "@hono/zod-openapi";

import { nepalDate } from "../../core/dates";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { listPublicContent } from "./queries";
import { ContentKindSchema, PublicContentSchema } from "./schema";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

/**
 * How long a browser may reuse the public answer. A change shows within about a minute. There is no
 * instant purge: the free workers.dev address has no shared cache to purge, and a purge across the
 * network needs a custom domain and an API token. OPEN: purge on publish once a school has its own
 * domain (D-039).
 */
export const PUBLIC_CONTENT_CACHE = "public, max-age=30, stale-while-revalidate=30";

export function registerContent(app: App): void {
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
}
