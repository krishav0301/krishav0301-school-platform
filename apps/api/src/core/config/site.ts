import { z } from "@hono/zod-openapi";

/**
 * The words of a school's six fixed public pages (Home, Programmes, Admission, Scholarships, Facilities,
 * Contact). They are part of the school's pack (D-008), stored as one JSON row by `applyPack`, and read by
 * the public pages. The Admin does not edit them in Phase 2 (D-039): a change is a change to the pack.
 * Every text is trimmed and capped, and unknown keys are refused.
 */
const Text = (max: number) => z.string().trim().min(1).max(max);
const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "lower-case letters, digits and hyphens");
const EMAIL = /^[^\s@<>"?;&]+@[^\s@<>"?;&]+\.[^\s@<>"?;&]+$/;

const HeroFile = z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}\.webp$/, "a plain lower-case .webp file name");
const FACEBOOK = /^https:\/\/(www\.)?facebook\.com\/[A-Za-z0-9._\-/?=&%]{1,200}$/;

/** The folder under `apps/web/public/site/` that holds the school's photos and crest. */
const PhotosFolder = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "a plain lower-case folder name");

/** The words of the one-page scrolling public site (D-167): a school whose pack says `layout: "scroll"` has them. */
export const ScrollContentSchema = z.strictObject({
  photosFolder: PhotosFolder,
  hero: z.strictObject({
    images: z.array(z.strictObject({ file: HeroFile, alt: Text(160) })).min(1).max(6),
    tagline: Text(160).optional(),
  }),
  /** Photos for the strip under the intro; without them the strip shows the hero photos. */
  gallery: z.array(z.strictObject({ file: HeroFile, alt: Text(160) })).min(1).max(12).optional(),
  /** A line shown large at the top of the school band; the intro is the smaller line beneath it. */
  quote: Text(200).optional(),
  intro: Text(900),
  batches: z.array(z.strictObject({ title: Text(80), note: Text(200).optional() })).min(1).max(20),
  about: z.strictObject({
    story: Text(1500).optional(),
    facebook: z.string().regex(FACEBOOK, "a facebook.com link").optional(),
    mapQuery: Text(200).optional(),
  }),
});
export type ScrollContent = z.infer<typeof ScrollContentSchema>;

export const SiteContentSchema = z.strictObject({
  /** `classic` is the six fixed pages; `scroll` is one long page (D-167). Classic unless the pack says otherwise. */
  layout: z.enum(["classic", "scroll"]).default("classic"),
  scroll: ScrollContentSchema.optional(),
  home: z.strictObject({ headline: Text(120), summary: Text(400) }),
  programmes: z
    .array(
      z.strictObject({
        key: Slug,
        name: Text(120),
        /** A section key of the same pack; `parsePack` checks it exists. */
        section: Text(31),
        affiliation: Text(80),
        duration: Text(60),
        summary: Text(500),
        options: z.array(Text(80)).max(12).default([]),
      }),
    )
    .min(1)
    .max(20),
  admission: z.strictObject({
    intro: Text(600),
    steps: z.array(z.strictObject({ title: Text(120), body: Text(800) })).min(1).max(12),
  }),
  scholarships: z.strictObject({
    intro: Text(600),
    items: z.array(z.strictObject({ title: Text(120), body: Text(800) })).min(1).max(12),
  }),
  facilities: z.strictObject({
    intro: Text(600),
    items: z.array(z.strictObject({ name: Text(80), body: Text(300).optional() })).min(1).max(30),
  }),
  contact: z.strictObject({
    address: Text(300),
    phones: z.array(Text(40)).min(1).max(6),
    email: Text(120).regex(EMAIL, "an email address").optional(),
    hours: Text(200).optional(),
  }),
});

export type SiteContent = z.infer<typeof SiteContentSchema>;

/** The stored text as site content, or null if it no longer parses (a later release changed the shape). */
export function parseSiteContent(json: string): SiteContent | null {
  const parsed = SiteContentSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

/**
 * The stored site content, or null before a pack that has it is applied. One statement. A stored row that
 * no longer parses is ignored rather than breaking every public page.
 */
export async function loadSiteContent(db: D1Database): Promise<SiteContent | null> {
  const row = await db.prepare("SELECT content_json FROM site_content WHERE id = 1").first<{ content_json: string }>();
  return row ? parseSiteContent(row.content_json) : null;
}
