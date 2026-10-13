import { loadSiteContent } from "../../core/config";
import type { Bindings } from "../../core/types";

/**
 * The addresses of files that belong to one school but have the same address in every school's build: today only the
 * tab icon. Like the crawler files, each must also be in `run_worker_first` in wrangler.jsonc (a CI check compares them).
 */
export const SCHOOL_FILES = ["/favicon.ico"] as const;

export const isSchoolFile = (pathname: string): boolean => (SCHOOL_FILES as readonly string[]).includes(pathname);

/** A school's icon changes very rarely, so a browser may keep it for a day. */
const ICON_CACHE = "public, max-age=86400";

/**
 * The icon in the browser tab (PM, 2026-10-13). One build serves every school, so the address `/favicon.ico` cannot hold
 * one school's picture in the files: the Worker answers it. A school with the one-page layout (D-167) has its own,
 * `favicon.png` in its photos folder; every other school, and a school whose file is missing, gets the app's default icon.
 * It never fails: an unreadable database or a missing file just means the default.
 */
export async function renderFavicon(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const fetchAsset = (path: string) => env.ASSETS!.fetch(new Request(new URL(path, url).toString(), { method }));

  try {
    const site = await loadSiteContent(env.DB);
    if (site?.layout === "scroll" && site.scroll) {
      const own = await fetchAsset(`/site/${site.scroll.photosFolder}/favicon.png`);
      if (own.status === 200) return new Response(method === "HEAD" ? null : own.body, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": ICON_CACHE } });
    }
  } catch {
    // Not set up yet, or the database could not be read: the default icon is the right answer.
  }
  return fetchAsset("/favicon.ico");
}
