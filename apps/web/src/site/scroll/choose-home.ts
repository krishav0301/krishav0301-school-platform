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

/**
 * Where the old apply page sends a visitor: a school with the one-page layout has its form on the front page, so it is
 * sent there (D-167); every other school keeps its apply page. Null while the school's words are not here yet.
 */
export function applyRedirectFor(view: { status: string; site?: SiteContent }): string | null {
  return chooseHome(view) === "scroll" ? "/#admission" : null;
}

/**
 * What the front page draws right now (PM, 2026-10-13: the old page must never flash before the new one).
 * `"waiting"`: an empty page, while the school is not known yet, or while a one-page school's words load, so nothing
 * of the classic frame (shell, menu, band, skeleton) is ever drawn for a school that does not use it. `"scroll"`: the
 * one-page layout. `"message"`: the usual frame around the school's status: loading shape, not set up, or cannot be reached.
 * `"classic"`: every other case, the usual frame with its own loading shape and retry.
 */
export function homeStage(
  configStatus: "loading" | "ready" | "unprovisioned" | "unreachable",
  publicLayout: "classic" | "scroll" | undefined,
  view: { status: string; site?: SiteContent },
  hint?: "classic" | "scroll",
): "waiting" | "scroll" | "message" | "classic" {
  // The Worker stamps the layout on the page it serves: a classic school keeps its usual frame (with its loading shape) from the first moment.
  if (configStatus === "loading") return hint === "classic" ? "message" : "waiting";
  if (configStatus !== "ready") return "message";
  if (chooseHome(view) === "scroll") return "scroll";
  return publicLayout === "scroll" && view.status === "loading" ? "waiting" : "classic";
}

/** The layout the Worker stamped on the page it served (`data-public-layout`), or nothing when there was no Worker or it said something else. */
export function readLayoutHint(doc: { documentElement: { dataset: DOMStringMap | Record<string, string | undefined> } }): "classic" | "scroll" | undefined {
  const value = doc.documentElement.dataset.publicLayout;
  return value === "scroll" || value === "classic" ? value : undefined;
}
