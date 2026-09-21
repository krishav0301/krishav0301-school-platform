import { loadConfig, loadSiteContent } from "../../core/config";
import type { Bindings } from "../../core/types";
import { escapeHtml } from "./html";
import { FILLED_PAGES, pageSummary } from "./pages";
import { say } from "./strings";

/**
 * The three small files that tell search engines and AI tools how to read a site: `robots.txt` (where they
 * may go), `sitemap.xml` (what pages there are) and `llms.txt` (a plain introduction for AI tools). The
 * Worker writes them for each school, because each has its own address and its own name (D-046).
 *
 * The rule that matters most: only a PRODUCTION site invites crawlers. Staging, development and test sites
 * say "keep out" everywhere, so a test copy can never appear in search results.
 *
 * Every address here must be in `run_worker_first` in wrangler.jsonc, like the filled pages; a CI check
 * compares the lists.
 */
export const CRAWLER_FILES = ["/robots.txt", "/sitemap.xml", "/llms.txt"] as const;

export const isCrawlerFile = (pathname: string): boolean => (CRAWLER_FILES as readonly string[]).includes(pathname);

/** These change rarely, so a browser or a crawler may keep them for an hour. */
export const CRAWLER_FILE_CACHE = "public, max-age=3600";

/** Only an exact "production" invites crawlers; anything else, including a typo, keeps them out. */
export const isProduction = (env: Pick<Bindings, "ENVIRONMENT">): boolean => env.ENVIRONMENT === "production";

/** A value that must sit on one line of a plain-text file: line breaks and runs of spaces become one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const xmlEscape = escapeHtml;

function robotsTxt(origin: string, indexable: boolean): string {
  if (!indexable) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Allow: /",
    // Not for search or AI tools: the API, the signed-in portal, the sign-in and reset pages, the component gallery.
    "Disallow: /api/",
    "Disallow: /portal",
    "Disallow: /sign-in",
    "Disallow: /reset-password",
    "Disallow: /design",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

function sitemapXml(origin: string): string {
  // No <lastmod>: a day we do not know is left out rather than guessed.
  const urls = FILLED_PAGES.map((path) => `  <url><loc>${xmlEscape(`${origin}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function llmsTxt(env: Bindings, origin: string): Promise<string | null> {
  const config = await loadConfig(env.DB);
  if (!config) return null;
  // The school's own words, when it has them: its summary opens the file, and how to reach it closes it.
  const site = await loadSiteContent(env.DB);

  const name = oneLine(config.school.name);
  const sections = config.sections.map((s) => oneLine(s.name));
  const links = FILLED_PAGES.map((path) => {
    const page = pageSummary(path, name);
    return `- [${oneLine(page.name)}](${origin}${path}): ${oneLine(page.summary)}`;
  });
  return [
    `# ${name}`,
    "",
    `> ${site ? oneLine(site.home.summary) : sections.length > 0 ? `${name}: ${sections.join(", ")}.` : `${name}.`}`,
    "",
    `## ${say("llms.pages")}`,
    "",
    ...links,
    ...(site
      ? [
          "",
          `## ${say("llms.contact")}`,
          "",
          `- ${say("site.address")}: ${oneLine(site.contact.address)}`,
          `- ${say("site.phone")}: ${site.contact.phones.map(oneLine).join(", ")}`,
          ...(site.contact.email ? [`- ${say("site.email")}: ${oneLine(site.contact.email)}`] : []),
          ...(site.contact.hours ? [`- ${say("site.hours")}: ${oneLine(site.contact.hours)}`] : []),
        ]
      : []),
    "",
  ].join("\n");
}

const TYPES: Record<(typeof CRAWLER_FILES)[number], string> = {
  "/robots.txt": "text/plain; charset=utf-8",
  "/sitemap.xml": "application/xml; charset=utf-8",
  "/llms.txt": "text/plain; charset=utf-8",
};

/** Answers a GET or HEAD for one of the three files. */
export async function renderCrawlerFile(request: Request, env: Bindings): Promise<Response> {
  const path = new URL(request.url).pathname as (typeof CRAWLER_FILES)[number];
  const origin = (env.SITE_ORIGIN ?? new URL(request.url).origin).replace(/\/+$/, "");

  let body: string | null;
  if (path === "/robots.txt") body = robotsTxt(origin, isProduction(env));
  else if (path === "/sitemap.xml") body = sitemapXml(origin);
  else body = await llmsTxt(env, origin);

  if (body === null) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: { "Content-Type": TYPES[path], "Cache-Control": CRAWLER_FILE_CACHE },
  });
}
