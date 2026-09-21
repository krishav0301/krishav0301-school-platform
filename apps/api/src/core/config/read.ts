import { ThemeSchema, type Theme } from "../theme";
import { resolveModules } from "./modules";
import { parseSiteContent, type SiteContent } from "./site";
import { resolveTerms, type TermKey } from "./terminology";

/** What the web app needs to draw itself for this school. Public, and the same for every visitor. */
export interface PublicConfig {
  school: { name: string; shortName: string; currency: string; timezone: string; region: string; template: string | null };
  sections: { key: string; name: string }[];
  modules: Record<string, boolean>;
  terms: Record<TermKey, string>;
  theme: Theme | null;
}

/** The five reads that make up the configuration. */
const configStatements = (db: D1Database): D1PreparedStatement[] => [
  db.prepare("SELECT name, short_name, currency, timezone, region_pack, template_key FROM school WHERE id = 1"),
  db.prepare("SELECT key, name FROM sections ORDER BY ordering, id"),
  db.prepare("SELECT key, enabled FROM module_switches"),
  db.prepare("SELECT key, text FROM terminology"),
  db.prepare("SELECT tokens_json FROM themes WHERE is_active = 1"),
];

function buildConfig(results: D1Result[]): PublicConfig | null {
  const [school, sections, switches, terms, theme] = results;

  const row = school!.results[0] as
    | { name: string; short_name: string; currency: string; timezone: string; region_pack: string; template_key: string | null }
    | undefined;
  if (!row) return null;

  const switchMap = Object.fromEntries((switches!.results as unknown as { key: string; enabled: number }[]).map((s) => [s.key, s.enabled === 1]));
  const termMap = Object.fromEntries((terms!.results as unknown as { key: string; text: string }[]).map((t) => [t.key, t.text]));

  let parsedTheme: Theme | null = null;
  const tokens = (theme!.results[0] as { tokens_json: string } | undefined)?.tokens_json;
  if (tokens) {
    // A stored theme that no longer parses is ignored rather than breaking every page.
    const parsed = ThemeSchema.safeParse(JSON.parse(tokens));
    parsedTheme = parsed.success ? parsed.data : null;
  }

  return {
    school: { name: row.name, shortName: row.short_name, currency: row.currency, timezone: row.timezone, region: row.region_pack, template: row.template_key },
    sections: sections!.results as unknown as { key: string; name: string }[],
    modules: resolveModules(switchMap),
    terms: resolveTerms(termMap),
    theme: parsedTheme,
  };
}

/**
 * The school's configuration, or null if it has not been provisioned. All five reads go in one
 * batch, so this is a single database round trip.
 */
export async function loadConfig(db: D1Database): Promise<PublicConfig | null> {
  return buildConfig(await db.batch(configStatements(db)));
}

/**
 * The configuration and the words of the fixed public pages, in the same single batch: a public page needs both,
 * and each round trip costs about 200 ms from Nepal (D-052). `site` is null before the school has its words.
 */
export async function loadConfigAndSite(db: D1Database): Promise<{ config: PublicConfig | null; site: SiteContent | null }> {
  const results = await db.batch([...configStatements(db), db.prepare("SELECT content_json FROM site_content WHERE id = 1")]);
  const siteRow = results[5]!.results[0] as { content_json: string } | undefined;
  return { config: buildConfig(results.slice(0, 5)), site: siteRow ? parseSiteContent(siteRow.content_json) : null };
}
