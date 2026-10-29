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

/**
 * The grade-point marks card and the mark ledger (the PM, 2026-10-28, the first school). The scale lists the letters
 * highest first: each starts at a whole percent, carries its grade point in hundredths (4.00 is 400) and its remark;
 * the last starts at 0, so every mark gets a letter. Divisions are listed highest first too; a result below the last is
 * given none.
 */
export const GradeSheetSchema = z
  .strictObject({
    address: z.string().min(1).max(120),
    contact: z.string().min(1).max(160).optional(),
    /** The crest printed at the top, as a file under `/site/` (for example `myschool/crest.webp`). */
    crest: z
      .string()
      .regex(/^[a-z0-9-]+\/[a-z0-9._-]+\.(?:webp|png|jpg|svg)$/, "A file in a folder under /site/")
      .optional(),
    scale: z
      .array(z.strictObject({ grade: z.string().min(1).max(4), from: z.number().int().min(0).max(100), pointHundredths: z.number().int().min(0).max(1000), remark: z.string().min(1).max(40) }))
      .min(2)
      .max(12),
    divisions: z.array(z.strictObject({ name: z.string().min(1).max(40), from: z.number().int().min(1).max(100) })).max(6).default([]),
    /** The marks card's paper: `plain` (the page's own surface) or `accent` (the theme's soft accent colour, the school's yellow). */
    paper: z.enum(["plain", "accent"]).default("plain"),
    /**
     * Where a band starts. `from`: a mark of exactly 90 is in the band that starts at 90 (the printed table's plain reading).
     * `above`: a band starts just above its number, so exactly 90 is still in the band below (how the first school's own cards
     * come out: 90 is an A, 80 a B+, 70 a B).
     */
    boundary: z.enum(["from", "above"]).default("from"),
    /** `dense`: tied students share a rank and the next rank follows (1, 2, 2, 3); `competition`: it skips (1, 2, 2, 4). */
    rankStyle: z.enum(["dense", "competition"]).default("competition"),
  })
  .superRefine((g, ctx) => {
    const down = (list: { from: number }[]) => list.every((x, i) => i === 0 || x.from < list[i - 1]!.from);
    if (!down(g.scale)) ctx.addIssue({ code: "custom", path: ["scale"], message: "List the grades highest first, each starting lower than the one above" });
    if (g.scale[g.scale.length - 1]!.from !== 0) ctx.addIssue({ code: "custom", path: ["scale"], message: "The last grade must start at 0, so every mark gets a grade" });
    if (new Set(g.scale.map((b) => b.grade.toLowerCase())).size !== g.scale.length) ctx.addIssue({ code: "custom", path: ["scale"], message: "A grade is listed twice" });
    if (!down(g.divisions)) ctx.addIssue({ code: "custom", path: ["divisions"], message: "List the divisions highest first, each starting lower than the one above" });
  });
export type GradeSheetConfig = z.infer<typeof GradeSheetSchema>;

export const PackSchema = z.strictObject({
  packVersion: z.literal(1),
  school: z.strictObject({
    name: z.string().min(2).max(120),
    shortName: z.string().min(1).max(40),
    currency: z.string().regex(/^[A-Z]{3}$/).default("NPR"),
    timezone: z.string().min(3).max(60).default("Asia/Kathmandu"),
    region: z.string().min(2).max(30).default("nepal"),
    template: z.string().min(1).max(60).optional(),
    /** Whether the school's Admin must use an authenticator app (D-138). On unless the school says otherwise; Support always does. */
    adminTwoFactor: z.boolean().default(true),
    /** Whether a student keeps the 4-digit password given at admission instead of changing it (D-145). Off unless the school says so. */
    studentKeepsPin: z.boolean().default(false),
    /** Whether each subject has its own pass marks, for theory and practical, instead of the exam pattern's two percentages. Off unless the school says so. */
    passMarksPerSubject: z.boolean().default(false),
    /** Whether a public application must confirm an email link before it reaches the Co-ordinator (D-063). A school may turn it off (D-168): the backend then makes the email. */
    publicApplyNeedsLink: z.boolean().default(true),
    /** The grade-point marks card and the mark ledger. Absent: the school keeps the marks card as it is. */
    gradeSheet: GradeSheetSchema.optional(),
  }),
  /**
   * Sections the pack adds. A school's own pack lists none (D-095): the Admin makes them on the Programs screen. Demo
   * and test packs may still list some, so a pack can describe a whole school as data.
   */
  sections: z
    .array(z.strictObject({ key: SectionKey, name: z.string().min(1).max(60) }))
    .max(20)
    .default([]),
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
  if (pack.site.layout === "scroll" && !pack.site.scroll) problems.push("site.scroll: required when site.layout is scroll");
  if (pack.site.layout !== "scroll" && pack.site.scroll) problems.push("site.scroll: only a scroll layout may have scroll words");
  // No picture shows twice on the page (PM, 2026-10-13): the hero, the cards and the strip all name different files.
  const pictureFiles = [...(pack.site.scroll?.hero.images ?? []), ...(pack.site.scroll?.gallery ?? []), ...(pack.site.scroll?.cards.flatMap((card) => (card.image ? [card.image] : [])) ?? [])].map((image) => image.file);
  if (new Set(pictureFiles).size !== pictureFiles.length) problems.push("site.scroll: a picture file is named more than once (hero, cards and gallery)");
  const immersive = pack.site.immersive;
  if (pack.site.layout === "immersive" && !immersive) problems.push("site.immersive: required when site.layout is immersive");
  if (pack.site.layout !== "immersive" && immersive) problems.push("site.immersive: only an immersive layout may have immersive words");
  if (immersive) {
    const pictures = [
      ...(immersive.hero.image ? [immersive.hero.image] : []),
      ...(immersive.facilities.images ?? []),
      ...Object.values(immersive.programmes.images ?? {}),
    ];
    if (pictures.length > 0 && !immersive.photosFolder) problems.push("site.immersive.photosFolder: required when the page has a picture");
    const files = pictures.map((picture) => picture.file);
    if (new Set(files).size !== files.length) problems.push("site.immersive: a picture file is named more than once");
    // The scholarships card sits after the programmes and may have a picture too, under the key `scholarships`.
    const known = new Set([...pack.site.programmes.map((p) => p.key), "scholarships"]);
    for (const programmeKey of Object.keys(immersive.programmes.images ?? {})) {
      if (!known.has(programmeKey)) problems.push(`site.immersive.programmes.images.${programmeKey}: not a programme of this pack`);
    }
    const facilityNames = new Set(pack.site.facilities.items.map((item) => item.name));
    for (const image of immersive.facilities.images ?? []) {
      if (!facilityNames.has(image.name)) problems.push(`site.immersive.facilities.images: "${image.name}" is not a facility of this pack`);
    }
  }
  const cardTitles = pack.site.scroll?.cards.map((card) => card.title) ?? [];
  if (new Set(cardTitles).size !== cardTitles.length) problems.push("site.scroll.cards: titles must be unique");

  const programmeKeys = pack.site.programmes.map((p) => p.key);
  if (new Set(programmeKeys).size !== programmeKeys.length) problems.push("site.programmes: keys must be unique");
  // A pack that lists sections must name one of them on each public programme. A pack with none leaves the public
  // page to group by whatever sections the Admin makes (D-095).
  if (sectionKeys.size > 0) {
    pack.site.programmes.forEach((programme, index) => {
      if (!sectionKeys.has(programme.section)) problems.push(`site.programmes.${index}.section: "${programme.section}" is not one of the pack's sections`);
    });
  }

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
    sql: `INSERT INTO school (id, name, short_name, currency, timezone, template_key, region_pack, admin_two_factor, student_keeps_pin, pass_marks_per_subject, public_apply_verifies_email, grade_sheet_json)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name,
            currency = excluded.currency, timezone = excluded.timezone,
            template_key = excluded.template_key, region_pack = excluded.region_pack, admin_two_factor = excluded.admin_two_factor, student_keeps_pin = excluded.student_keeps_pin,
            pass_marks_per_subject = excluded.pass_marks_per_subject, public_apply_verifies_email = excluded.public_apply_verifies_email,
            grade_sheet_json = excluded.grade_sheet_json`,
    params: [pack.school.name, pack.school.shortName, pack.school.currency, pack.school.timezone, pack.school.template ?? null, pack.school.region, pack.school.adminTwoFactor ? 1 : 0, pack.school.studentKeepsPin ? 1 : 0, pack.school.passMarksPerSubject ? 1 : 0, pack.school.publicApplyNeedsLink ? 1 : 0, pack.school.gradeSheet ? JSON.stringify(pack.school.gradeSheet) : null],
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
