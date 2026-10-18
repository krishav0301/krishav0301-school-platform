import type { SiteContent } from "@/site/model";

type View = { status: string; site?: SiteContent };

/** Which one-page layout a school's words carry, once they are here; `"none"` while they are not, or when the school has neither. */
function pick(view: View): "scroll" | "immersive" | "none" {
  if (view.status !== "ready" || !view.site) return "none";
  if (view.site.layout === "scroll" && view.site.scroll) return "scroll";
  if (view.site.layout === "immersive" && view.site.immersive) return "immersive";
  return "none";
}

/**
 * What the front page draws right now (PM, 2026-10-13: nothing else may flash before the real page; PM, 2026-10-18, D-177: a
 * school without a one-page layout has only a Sign in button).
 * `"waiting"`: an empty page, while the school is not known yet, or while a one-page school's words load. `"scroll"` and
 * `"immersive"`: the school's one-page layout (D-167, D-178). `"signin"`: every other school, one Sign in button in the
 * middle of the page; it needs no words from the school, so it is drawn at once, even before the school's settings are here
 * when the Worker has said so. `"retry"`: a one-page school whose words could not be loaded, with a retry button.
 * `"message"`: the usual frame around the school's status when it is not set up or cannot be reached.
 *
 * This lives outside `site/scroll/` on purpose: that folder is a live school's, frozen (D-170).
 */
export function frontStage(
  configStatus: "loading" | "ready" | "unprovisioned" | "unreachable",
  publicLayout: "classic" | "scroll" | "immersive" | undefined,
  view: View,
  hint?: "classic" | "scroll" | "immersive",
): "waiting" | "scroll" | "immersive" | "message" | "signin" | "retry" {
  if (configStatus === "loading") return hint === "classic" ? "signin" : "waiting";
  if (configStatus !== "ready") return "message";
  const chosen = pick(view);
  if (chosen !== "none") return chosen;
  if (publicLayout === "scroll" || publicLayout === "immersive") return view.status === "loading" ? "waiting" : "retry";
  return "signin";
}

/**
 * Where the apply page sends a visitor: a school with a one-page layout has its form on the front page, so it is sent there
 * (D-167, D-178); every other school has no form. Null while the school's words are not here yet, or when there is none.
 */
export function applyRedirect(view: View): string | null {
  return pick(view) === "none" ? null : "/#admission";
}
