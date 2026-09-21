import { z } from "@hono/zod-openapi";

import { SiteContentSchema } from "../../core/config";

/** What the public site pages read: the school's fixed-page words, or null before they are provisioned. */
export const SitePagesSchema = z.object({ site: SiteContentSchema.nullable() }).openapi("SitePages");
