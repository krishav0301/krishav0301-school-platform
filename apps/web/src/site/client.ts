import type { ApiClient } from "@/api/client";

import type { SiteContent } from "./model";

export type SiteResult = { ok: true; site: SiteContent | null } | { ok: false };

/** The words of the fixed public pages. No sign-in. `site` is null before the school has them. Never throws: a dropped connection is `ok: false`. */
export async function loadSite(api: ApiClient): Promise<SiteResult> {
  try {
    const { data } = await api.GET("/api/site/pages");
    return data ? { ok: true, site: data.site } : { ok: false };
  } catch {
    return { ok: false };
  }
}
