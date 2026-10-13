import type { Programme, SiteContent } from "@/site/model";

type PackSite = Omit<SiteContent, "programmes" | "layout"> & { layout?: SiteContent["layout"]; programmes: (Omit<Programme, "options"> & { options?: string[] })[] };

/**
 * A pack's `site` block as the public API would send it. The API fills in its defaults (a programme with no
 * `options` has an empty list, a pack with no `layout` is classic); this does the same, so web tests can use the pack
 * files without importing the API's runtime code (it needs Cloudflare types the web project does not have). The pack
 * format itself is checked by the API's tests.
 */
export function siteFrom(pack: { site: PackSite }): SiteContent {
  return { ...pack.site, layout: pack.site.layout ?? "classic", programmes: pack.site.programmes.map((p) => ({ ...p, options: p.options ?? [] })) };
}
