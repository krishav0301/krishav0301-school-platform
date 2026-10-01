/**
 * A pack describes one school completely as data: who they are, their sections, which optional
 * modules they use, their wording and their look (D-008). Packs live in `packs/<school>/pack.json`
 * outside the code. The core never imports a pack; a script or a test loads the JSON and hands it
 * to `parsePack` and `packOperations`.
 */
import { z } from "@hono/zod-openapi";

import { ThemeSchema, checkContrast, type ContrastFailure } from "../theme";
import { SiteContentSchema } from "./site";
import { isKnownModule, isMandatoryModule } from "./modules";
import { isKnownTerm } from "./terminology";

const SectionKey = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "lower-case letters, digits and underscores");

export const PackSchema = z.strictObject({
  packVersion: z.literal(1),
  school: z.strictObject({
    name: z.string().min(2).max(120),
    shortName: z.string().min(1).max(40),
    currency: z.string().regex(/^[A-Z]{3}$/).default("NPR"),
    timezone: z.string().min(3).max(60).default("Asia/Kathmandu"),
    region: z.string().min(2).max(30).default("nepal"),
    template: z.string().min(1).max(60).optional(),
  }),
  sections: z
    .array(z.strictObject({ key: SectionKey, name: z.string().min(1).max(60) }))
    .min(1)
    .max(6),
  /** Optional modules a school switches on or off. Unlisted ones stay on. */
  modules: z.record(z.string(), z.boolean()).default({}),
  /** Renamed words. Only known terms may be renamed. */
  terminology: z.record(z.string(), z.string().min(1).max(60)).default({}),
  /** The words of the six fixed public pages. Required: every school has a public site (D-008). */
  site: SiteContentSchema,
  theme: ThemeSchema,
});

export type Pack = z.infer<typeof PackSchema>;

export class InvalidPackError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid pack:\n- ${problems.join("\n- ")}`);
    this.name = "InvalidPackError";
  }
}

/** Checks a pack thoroughly, and returns it with defaults filled in. Throws `InvalidPackError`. */
export function parsePack(input: unknown): Pack {
  const parsed = PackSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidPackError(parsed.error.issues.map((i) => `${i.path.join(".") || "(pack)"}: ${i.message}`));
  }
  const pack = parsed.data;
  const problems: string[] = [];

  const keys = pack.sections.map((s) => s.key);
  if (new Set(keys).size !== keys.length) problems.push("sections: keys must be unique");

  const sectionKeys = new Set(keys);
  const programmeKeys = pack.site.programmes.map((p) => p.key);
  if (new Set(programmeKeys).size !== programmeKeys.length) problems.push("site.programmes: keys must be unique");
  pack.site.programmes.forEach((programme, index) => {
    if (!sectionKeys.has(programme.section)) problems.push(`site.programmes.${index}.section: "${programme.section}" is not one of the pack's sections`);
  });

  for (const [key, on] of Object.entries(pack.modules)) {
    if (!isKnownModule(key)) problems.push(`modules.${key}: not a module`);
    else if (!on && isMandatoryModule(key)) problems.push(`modules.${key}: cannot be switched off, it carries rules that must always hold`);
  }
  for (const key of Object.keys(pack.terminology)) {
    if (!isKnownTerm(key)) problems.push(`terminology.${key}: not a term that can be renamed`);
  }

  const failures: ContrastFailure[] = checkContrast(pack.theme);
  for (const f of failures) problems.push(`theme.${f.mode}: ${f.label} has contrast ${f.ratio}, needs ${f.minimum}`);

  if (problems.length > 0) throw new InvalidPackError(problems);
  return pack;
}

/** One SQL statement with its values, kept apart from the text so nothing is ever concatenated. */
export interface Operation {
  sql: string;
  params: (string | number | null)[];
}

/**
 * Everything needed to make a database match the pack. Safe to run again: applying the same pack
 * twice changes nothing. It only adds and updates. It never deletes, so a section removed from a
 * pack stays in the database (no hard deletes).
 */
export function packOperations(pack: Pack): Operation[] {
  const tokens = JSON.stringify(pack.theme);
  const ops: Operation[] = [];

  ops.push({
    sql: `INSERT INTO school (id, name, short_name, currency, timezone, template_key, region_pack)
          VALUES (1, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name,
            currency = excluded.currency, timezone = excluded.timezone,
            template_key = excluded.template_key, region_pack = excluded.region_pack`,
    params: [pack.school.name, pack.school.shortName, pack.school.currency, pack.school.timezone, pack.school.template ?? null, pack.school.region],
  });

  pack.sections.forEach((section, index) =>
    ops.push({
      sql: `INSERT INTO sections (key, name, ordering) VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET name = excluded.name, ordering = excluded.ordering`,
      params: [section.key, section.name, index],
    }),
  );

  for (const [key, on] of Object.entries(pack.modules)) {
    ops.push({
      sql: "INSERT INTO module_switches (key, enabled) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled",
      params: [key, on ? 1 : 0],
    });
  }

  for (const [key, text] of Object.entries(pack.terminology)) {
    ops.push({
      sql: "INSERT INTO terminology (key, text) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET text = excluded.text",
      params: [key, text],
    });
  }

  // The site's words: one row, replaced whole, and only when the text changed, so re-applying a pack
  // changes nothing (not even the timestamp). An update of one document, never a delete.
  ops.push({
    sql: `INSERT INTO site_content (id, content_json, updated_at)
          VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
          ON CONFLICT (id) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at
            WHERE content_json != excluded.content_json`,
    params: [JSON.stringify(pack.site)],
  });

  // Theme: add it only if no saved theme (active or not) already has these exact tokens, retire
  // the old active one, then activate the newest theme with these tokens. So re-applying a pack
  // finds and re-activates its theme instead of adding a duplicate.
  ops.push(
    {
      sql: `INSERT INTO themes (name, tokens_json, is_active)
            SELECT ?, ?, 0 WHERE NOT EXISTS (SELECT 1 FROM themes WHERE tokens_json = ?)`,
      params: [pack.theme.name, tokens, tokens],
    },
    { sql: "UPDATE themes SET is_active = 0 WHERE is_active = 1 AND tokens_json != ?", params: [tokens] },
    {
      sql: `UPDATE themes SET is_active = 1
             WHERE id = (SELECT MAX(id) FROM themes WHERE tokens_json = ?)
               AND NOT EXISTS (SELECT 1 FROM themes WHERE is_active = 1)`,
      params: [tokens],
    },
  );

  return ops;
}

/** Applies a pack to a D1 database in one all-or-nothing batch. */
export async function applyPack(db: D1Database, pack: Pack): Promise<void> {
  await db.batch(packOperations(pack).map((op) => db.prepare(op.sql).bind(...op.params)));
}
