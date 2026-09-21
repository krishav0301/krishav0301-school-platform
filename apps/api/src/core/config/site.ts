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

export const SiteContentSchema = z.strictObject({
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

/**
 * The stored site content, or null before a pack that has it is applied. One statement. A stored row that
 * no longer parses (a later release changed the shape) is ignored rather than breaking every public page.
 */
export async function loadSiteContent(db: D1Database): Promise<SiteContent | null> {
  const row = await db.prepare("SELECT content_json FROM site_content WHERE id = 1").first<{ content_json: string }>();
  if (!row) return null;
  const parsed = SiteContentSchema.safeParse(JSON.parse(row.content_json));
  return parsed.success ? parsed.data : null;
}
