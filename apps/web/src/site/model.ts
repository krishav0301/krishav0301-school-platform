import type { components } from "@/api/schema";

/** The words of the fixed public pages, as the API sends them (`GET /api/site/pages`). */
export type SiteContent = NonNullable<components["schemas"]["SitePages"]["site"]>;
export type Programme = SiteContent["programmes"][number];
