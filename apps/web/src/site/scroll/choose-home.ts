import type { SiteContent } from "@/site/model";

/** A site whose pack chose the scroll layout, with its words. */
export type ScrollSite = SiteContent & { scroll: NonNullable<SiteContent["scroll"]> };

/**
 * Which front page a school gets: `"scroll"` once its words are loaded and say so, `"classic"` otherwise, and
 * `"loading"` before they are here. Kept apart from the page itself so a classic school's front page never has to
 * download the scroll page's code.
 */
export function chooseHome(view: { status: string; site?: SiteContent }): "scroll" | "classic" | "loading" {
  if (view.status !== "ready" || !view.site) return "loading";
  return view.site.layout === "scroll" && view.site.scroll ? "scroll" : "classic";
}
