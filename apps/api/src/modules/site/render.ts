import { loadConfig, loadSiteContent, type SiteContent } from "../../core/config";
import type { Bindings } from "../../core/types";
import { escapeHtml, jsonLdScript } from "./html";
import { isProduction } from "./crawler-files";
import { builderFor, isFilledPage, normalizePath } from "./pages";

/** How long a browser may keep a filled page. The content can change at any time, so it is short. */
export const FILLED_PAGE_CACHE = "public, max-age=60";

/**
 * Answers a request for a public page (D-046): the Next-built static page, with what is true for this
 * school written into it. A crawler that does not run JavaScript then finds real words: a title, a
 * description, a canonical address, structured data, and a plain block of the page's content at the top of
 * the body. That block is removed by an inline script before the app starts, so visitors who run
 * JavaScript see exactly the app and nothing more, and visitors who do not still get a readable page.
 * Before the school is set up, or for anything that is not a page, the static file is returned untouched.
 */
export async function renderPublicPage(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  // A browser that holds an older copy asks "has it changed?" with validators of THAT copy. The static files
  // would answer "no" (304, no body), and there would be nothing to fill in. Ask for the whole file every time.
  const assetHeaders = new Headers(request.headers);
  for (const name of ["If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "If-Range", "Range"]) assetHeaders.delete(name);
  const asset = await env.ASSETS!.fetch(new Request(request.url, { method: "GET", headers: assetHeaders }));
  if (asset.status !== 200 || !(asset.headers.get("Content-Type") ?? "").includes("text/html") || !isFilledPage(url.pathname)) return asset;

  const config = await loadConfig(env.DB);
  if (!config) return asset;

  const path = normalizePath(url.pathname);
  const origin = (env.SITE_ORIGIN ?? url.origin).replace(/\/+$/, "");
  let site: Promise<SiteContent | null> | undefined;
  const parts = await builderFor(url.pathname)({
    db: env.DB,
    school: config.school,
    sections: config.sections,
    origin,
    path,
    // Read only by the pages that need the words, and once.
    site: () => (site ??= loadSiteContent(env.DB)),
  });
  // Nothing true to say yet (the school has no site words): the static page is served as it is.
  if (!parts) return asset;

  const canonical = `${origin}${path}`;
  const organisation = { "@context": "https://schema.org", "@type": "EducationalOrganization", name: config.school.name, url: origin };

  const head =
    `<title>${escapeHtml(parts.title)}</title>` +
    `<meta name="description" content="${escapeHtml(parts.description)}"/>` +
    `<link rel="canonical" href="${escapeHtml(canonical)}"/>` +
    [organisation, ...parts.structuredData].map(jsonLdScript).join("");
  const body = `<div id="server-copy">${parts.bodyHtml}</div><script>document.getElementById("server-copy").remove()</script>`;

  const rewritten = new HTMLRewriter()
    // What the static page already says is replaced, so there is exactly one of each.
    .on("title", { element: (el) => void el.remove() })
    .on('meta[name="description"]', { element: (el) => void el.remove() })
    .on('link[rel="canonical"]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(head, { html: true }) })
    .on("body", { element: (el) => void el.prepend(body, { html: true }) })
    .transform(asset);

  const headers = new Headers(rewritten.headers);
  headers.delete("ETag");
  headers.delete("Content-Length");
  headers.set("Cache-Control", FILLED_PAGE_CACHE);
  // A site that is not production (staging, development) must never reach search results.
  if (!isProduction(env)) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(request.method === "HEAD" ? null : rewritten.body, { status: rewritten.status, headers });
}
