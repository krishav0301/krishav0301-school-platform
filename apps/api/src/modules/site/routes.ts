import { loadSiteContent } from "../../core/config";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { SitePagesSchema } from "./schema";

/** How long a browser may reuse the answer. The words change only when a pack is applied, so a minute is plenty. */
export const SITE_PAGES_CACHE = "public, max-age=60";

export function registerSite(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/site/pages",
      operationId: "site_pages",
      tags: ["site"],
      description:
        "The words of the school's six fixed public pages (home, programmes, admission, scholarships, facilities, contact), from its pack. `site` is null before the school has been provisioned with them. The same for every visitor.",
      access: { action: "site.view" },
      responses: { 200: { description: "The fixed pages' words, or null", content: { "application/json": { schema: SitePagesSchema } } } },
    },
    async (c) => {
      const site = await loadSiteContent(c.env.DB);
      c.header("Cache-Control", SITE_PAGES_CACHE);
      return c.json({ site }, 200);
    },
  );
}
