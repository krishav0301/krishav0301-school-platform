# Public Pages (Phase 2, slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Royal Softech's public site gets six fixed pages (Home, Programmes, Admission, Scholarships, Facilities, Contact) whose words come from the school's pack.

**Architecture:** A required `site` block in `pack.json` is validated by Zod, stored as one JSON row (`site_content`) by `npm run provision`, and read two ways: the Worker writes it into the crawler copy of each page, and the web pages fetch it from `GET /api/site/pages` (anonymous `site.view` action). The header gets a two-row layout with a Menu button below 48 rem.

**Tech Stack:** Cloudflare Worker + Hono + `@hono/zod-openapi` (Zod 4), D1, Vitest in the Workers pool (API), Next.js 16 static export + `openapi-fetch` + Vitest with `renderToStaticMarkup` (web).

**Spec:** `docs/superpowers/specs/2026-09-21-public-pages-design.md`. Read it first. Also read `CLAUDE.md` and `docs/DECISIONS.md` (it wins over older text).

## Global Constraints

- Words never live in components: web words go in `apps/web/src/i18n/messages.ts`; words the crawler copy shares go in `apps/api/src/modules/site/strings.ts` with the same text (a web test checks). School-specific words come only from the pack.
- No hardcoded colours or fonts (tokens only); animate only `transform` and `opacity`; controls at least 44 px (`--control-height`); one prominent (primary) button per view.
- The strings in `strings.ts` must not contain "we", "our" or "us" (a test checks).
- No school is named in `apps/api/src` or `apps/web/src` (`scripts/check-boundaries.mjs`). Royal's words live only in `packs/royal-softech/pack.json`.
- Every value written into public HTML goes through `escapeHtml`; structured data goes through `jsonLdScript`.
- One database round trip per read; a Worker page costs the config batch plus one site read.
- Packs only add and update, never delete. Re-applying a pack changes nothing.
- The web app has no DOM test library. Test markup with `renderToStaticMarkup`; do not add a dependency.
- Windows: stop `wrangler dev` and `next dev` before `npm run build` in `apps/web`. Use Edit and Write for file changes, not `sed`. Existing files may use CRLF, so anchor edits on single lines.
- Commit after each task on branch `slice-3-public-pages`. End each commit message with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Do not push without the PM's say-so.
- Content in `packs/royal-softech/pack.json` is unconfirmed third-party text (`docs/client-profile.md`): mark it `OPEN:` in `packs/README.md`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/core/config/site.ts` (new) | `SiteContentSchema`, `SiteContent`, `loadSiteContent(db)` |
| `apps/api/migrations/0008_site_content.sql` (new) | the one-row `site_content` table |
| `apps/api/src/core/config/pack.ts` | `site` in `PackSchema`, cross-checks, the upsert operation |
| `apps/api/src/modules/site/schema.ts` (new) | `SitePagesSchema` for the route |
| `apps/api/src/modules/site/routes.ts` (new) | `GET /api/site/pages` |
| `apps/api/src/modules/site/page-types.ts` (new) | `PageContext`, `PageParts`, `Builder` |
| `apps/api/src/modules/site/site-pages.ts` (new) | crawler builders for the six pages |
| `apps/api/src/modules/site/pages.ts`, `render.ts`, `strings.ts` | registration, lazy site read, words |
| `apps/web/src/site/` (new) | `model.ts`, `client.ts`, `SiteFrame.tsx`, one view per page, `site.module.css` |
| `apps/web/src/shell/PublicHeader.tsx`, `SiteFooterNav` in `PublicShell.tsx` (new/changed) | header, Menu, footer |
| `apps/web/src/app/{programmes,admission,scholarships,facilities,contact}/page.tsx` (new) | routes |

---

### Task 1: The `site` block, its storage and reader (slice 3a)

**Files:**
- Create: `apps/api/src/core/config/site.ts`, `apps/api/migrations/0008_site_content.sql`, `apps/api/test/site-content.test.ts`
- Modify: `apps/api/src/core/config/pack.ts`, `apps/api/src/core/config/index.ts`, `apps/api/test/packs.test.ts`, `packs/royal-softech/pack.json`, `packs/sample-basic-school/pack.json`, `packs/README.md`

**Interfaces:**
- Produces: `SiteContentSchema` (Zod, output type `SiteContent`), `loadSiteContent(db: D1Database): Promise<SiteContent | null>`, `Pack["site"]`, all exported from `apps/api/src/core/config/index.ts`.
- `SiteContent` shape: `{ home: { headline; summary }, programmes: { key; name; section; affiliation; duration; summary; options: string[] }[], admission: { intro; steps: { title; body }[] }, scholarships: { intro; items: { title; body }[] }, facilities: { intro; items: { name; body?: string }[] }, contact: { address; phones: string[]; email?; hours? } }`.

- [ ] **Step 1: Write the failing pack tests**

In `apps/api/test/packs.test.ts`, change the import on line 5 to also bring in `loadSiteContent`:

```ts
import { InvalidPackError, applyPack, loadConfig, loadSiteContent, packOperations, parsePack, renderSql, type Pack } from "../src/core/config";
```

Add this block at the very end of the file:

```ts
// ---------------------------------------------------------------------------------------------
// The site block: the words of the six fixed public pages (Phase 2, slice 3)
// ---------------------------------------------------------------------------------------------
describe("the site block", () => {
  const cases: [string, (p: any) => void, RegExp][] = [
    ["no site block", (p) => delete p.site, /site: /],
    ["an unknown field in the site block", (p) => (p.site.blog = {}), /blog|unrecognized/i],
    ["a programme in a section the pack does not have", (p) => (p.site.programmes[0].section = "nursery"), /site\.programmes\.0\.section: .*nursery/],
    ["two programmes with the same key", (p) => (p.site.programmes[1].key = p.site.programmes[0].key), /site\.programmes: keys must be unique/],
    ["a programme key that is not a slug", (p) => (p.site.programmes[0].key = "BBS Degree!"), /site\.programmes\.0\.key/],
    ["no admission steps", (p) => (p.site.admission.steps = []), /site\.admission\.steps/],
    ["no phone number", (p) => (p.site.contact.phones = []), /site\.contact\.phones/],
    ["an over-long headline", (p) => (p.site.home.headline = "x".repeat(121)), /site\.home\.headline/],
    ["a blank summary", (p) => (p.site.home.summary = "   "), /site\.home\.summary/],
    ["a bad email address", (p) => (p.site.contact.email = "not an email"), /site\.contact\.email/],
  ];
  it.each(cases)("refuses %s", (_label, mutate, message) => {
    const bad = clone(royalJson) as any;
    mutate(bad);
    expect(() => parsePack(bad)).toThrow(InvalidPackError);
    expect(() => parsePack(bad)).toThrow(message);
  });

  it("carries Royal's nine programmes (OPEN: unconfirmed third-party list, docs/client-profile.md) and the sample school's own, sharing no wording", () => {
    const royal = parsePack(royalJson).site;
    const sample = parsePack(sampleJson).site;
    expect(royal.programmes).toHaveLength(9);
    expect(sample.programmes.length).toBeGreaterThan(0);
    const words = JSON.stringify(sample);
    for (const royalWord of ["Royal", "Lahan", "Siraha", "NEB", "Purbanchal", "Tribhuvan"]) expect(words, royalWord).not.toContain(royalWord);
  });

  it("fills in an empty options list", () => {
    const pack = parsePack(royalJson);
    expect(pack.site.programmes.find((p) => p.key === "bbs")!.options).toEqual([]);
  });

  it("is stored by applying the pack and reads back exactly as written, for both schools", async () => {
    for (const [json, db] of [[royalJson, env.DB], [sampleJson, env.SCRATCH_DB]] as const) {
      const pack = parsePack(json);
      await applyPack(db, pack);
      expect(await loadSiteContent(db), pack.school.name).toEqual(pack.site);
    }
  });

  it("re-applying the same pack leaves the row, and its timestamp, untouched; changed text updates both", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.DB, pack);
    await env.DB.prepare("UPDATE site_content SET updated_at = '2000-01-01T00:00:00Z'").run();

    await applyPack(env.DB, pack);
    const same = await env.DB.prepare("SELECT content_json, updated_at FROM site_content").first<{ content_json: string; updated_at: string }>();
    expect(same!.updated_at).toBe("2000-01-01T00:00:00Z");
    expect(JSON.parse(same!.content_json)).toEqual(pack.site);

    const edited = parsePack({ ...clone(royalJson), site: { ...clone(royalJson).site, home: { headline: "A new headline", summary: "A new summary." } } });
    await applyPack(env.DB, edited);
    const changed = await env.DB.prepare("SELECT updated_at FROM site_content").first<{ updated_at: string }>();
    expect(changed!.updated_at).not.toBe("2000-01-01T00:00:00Z");
    expect((await loadSiteContent(env.DB))!.home.headline).toBe("A new headline");
    expect(await count(env.DB, "SELECT COUNT(*) AS n FROM site_content")).toBe(1);
    await applyPack(env.DB, pack);
  });

  it("stores text with line breaks and quotes safely, through bound parameters and through rendered SQL", async () => {
    const base = clone(sampleJson) as any;
    base.site.home = { headline: "Line one\nLine two", summary: "It's a \"test\"; DROP TABLE users;--" };
    const pack = parsePack(base);
    await applyPack(env.SCRATCH_DB, pack);
    expect((await loadSiteContent(env.SCRATCH_DB))!.home).toEqual(pack.site.home);

    base.site.home.headline = "Second\nheadline";
    const sql = renderSql(packOperations(parsePack(base)));
    expect(sql).not.toContain("Second\nheadline"); // the line break is a JSON escape, so it is still one SQL line per statement
    await env.SCRATCH_DB.exec(sql);
    expect((await loadSiteContent(env.SCRATCH_DB))!.home.headline).toBe("Second\nheadline");
    expect(await count(env.SCRATCH_DB, "SELECT COUNT(*) AS n FROM users")).toBeGreaterThanOrEqual(0);
  });
});
```

Also, inside the existing "applying it a second and third time changes nothing" test, add one more entry to the `snapshot` array so the site row is part of "nothing changes":

```ts
        await getDb().prepare("SELECT content_json, updated_at FROM site_content").first(),
```

(Place it after the `terminology` count line.)

- [ ] **Step 2: Write the failing reader test**

Create `apps/api/test/site-content.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { applyPack, loadSiteContent, parsePack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";

describe("loadSiteContent", () => {
  it("is null before any pack has been applied", async () => {
    expect(await loadSiteContent(env.SCRATCH_DB)).toBeNull();
  });

  it("returns the stored block once a pack is applied", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.SCRATCH_DB, pack);
    expect(await loadSiteContent(env.SCRATCH_DB)).toEqual(pack.site);
  });

  it("ignores a stored row that no longer parses, instead of breaking every page (like a stored theme)", async () => {
    await env.SCRATCH_DB.prepare("UPDATE site_content SET content_json = '{\"home\":1}'").run();
    expect(await loadSiteContent(env.SCRATCH_DB)).toBeNull();
  });

  it("the table holds one row only, whatever the code does", async () => {
    await expect(env.SCRATCH_DB.prepare("INSERT INTO site_content (id, content_json, updated_at) VALUES (2, '{}', 'x')").run()).rejects.toThrow();
  });

  it("the table refuses text that is not JSON", async () => {
    await expect(env.SCRATCH_DB.prepare("UPDATE site_content SET content_json = 'not json'").run()).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd apps/api && npx vitest run test/packs.test.ts test/site-content.test.ts`
Expected: FAIL. The imports `loadSiteContent` and `site` do not exist, and `packs.test.ts` fails to compile or reports `site: ` problems.

- [ ] **Step 4: Write the schema and reader**

Create `apps/api/src/core/config/site.ts`:

```ts
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
```

- [ ] **Step 5: Write the migration**

Create `apps/api/migrations/0008_site_content.sql`:

```sql
-- The words of the six fixed public pages (Phase 2, slice 3). One row: the school's `site` block from its
-- pack, as JSON. `npm run provision` writes it and only changes the row when the text changed, so
-- `updated_at` says when the words last changed. Nothing here is deleted. Additive: safe to migrate before
-- the code that reads it is deployed.

CREATE TABLE site_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 6: Wire the block into the pack**

In `apps/api/src/core/config/pack.ts`:

1. Add the import under the theme import: `import { SiteContentSchema } from "./site";`
2. In `PackSchema`, add before `theme: ThemeSchema,`:

```ts
  /** The words of the six fixed public pages. Required: every school has a public site (D-008). */
  site: SiteContentSchema,
```

3. In `parsePack`, after the `sections` uniqueness check (`if (new Set(keys).size !== keys.length) ...`), add:

```ts
  const sectionKeys = new Set(keys);
  const programmeKeys = pack.site.programmes.map((p) => p.key);
  if (new Set(programmeKeys).size !== programmeKeys.length) problems.push("site.programmes: keys must be unique");
  pack.site.programmes.forEach((programme, index) => {
    if (!sectionKeys.has(programme.section)) problems.push(`site.programmes.${index}.section: "${programme.section}" is not one of the pack's sections`);
  });
```

4. In `packOperations`, after the terminology loop and before the theme comment, add:

```ts
  // The site's words: one row, replaced whole, and only when the text changed, so re-applying a pack
  // changes nothing (not even the timestamp). An update of one document, never a delete.
  ops.push({
    sql: `INSERT INTO site_content (id, content_json, updated_at)
          VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
          ON CONFLICT (id) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at
            WHERE content_json != excluded.content_json`,
    params: [JSON.stringify(pack.site)],
  });
```

In `apps/api/src/core/config/index.ts` add: `export { SiteContentSchema, loadSiteContent, type SiteContent } from "./site";`

- [ ] **Step 7: Add Royal's site block**

In `packs/royal-softech/pack.json`, replace the single line `  "terminology": {},` with:

```json
  "terminology": {},
  "site": {
    "home": {
      "headline": "Royal Softech College: +2 and Bachelor's education in Lahan",
      "summary": "Accessible, practice-based education in management, science and the +2 streams. It builds subject knowledge, confidence and employability, with a sense of social responsibility."
    },
    "programmes": [
      { "key": "plus2-science", "name": "+2 Science", "section": "plus2", "affiliation": "National Examinations Board (NEB)", "duration": "2 years (Grade 11 and 12)", "summary": "Grade 11 and 12 in Science under NEB, with a choice of subject options.", "options": ["Biology", "Mathematics", "Computer Science"] },
      { "key": "plus2-management", "name": "+2 Management", "section": "plus2", "affiliation": "National Examinations Board (NEB)", "duration": "2 years (Grade 11 and 12)", "summary": "Grade 11 and 12 in Management under NEB." },
      { "key": "plus2-hotel-management", "name": "+2 Hotel Management", "section": "plus2", "affiliation": "National Examinations Board (NEB)", "duration": "2 years (Grade 11 and 12)", "summary": "Grade 11 and 12 in Hotel Management under NEB." },
      { "key": "plus2-law", "name": "+2 Law", "section": "plus2", "affiliation": "National Examinations Board (NEB)", "duration": "2 years (Grade 11 and 12)", "summary": "Grade 11 and 12 in Law under NEB." },
      { "key": "plus2-humanities", "name": "+2 Humanities", "section": "plus2", "affiliation": "National Examinations Board (NEB)", "duration": "2 years (Grade 11 and 12)", "summary": "Grade 11 and 12 in Humanities under NEB." },
      { "key": "plus2-computer-science", "name": "+2 Computer Science", "section": "plus2", "affiliation": "National Examinations Board (NEB)", "duration": "2 years (Grade 11 and 12)", "summary": "Grade 11 and 12 in Computer Science under NEB." },
      { "key": "bbs", "name": "Bachelor of Business Studies (BBS)", "section": "bachelors", "affiliation": "Purbanchal University (PU)", "duration": "4 years", "summary": "A four-year business degree with a banking and finance focus, under Purbanchal University." },
      { "key": "bed-it", "name": "Bachelor of Education in IT (B.Ed. IT)", "section": "bachelors", "affiliation": "Purbanchal University (PU)", "duration": "4 years", "summary": "A four-year education degree in information technology, under Purbanchal University." },
      { "key": "bsc", "name": "Bachelor of Science (BSc)", "section": "bachelors", "affiliation": "Tribhuvan University (TU)", "duration": "4 years", "summary": "A four-year science degree under Tribhuvan University, with a choice of specialisation.", "options": ["Microbiology", "Zoology", "Botany", "Chemistry", "Physics"] }
    ],
    "admission": {
      "intro": "Admission follows six steps. Requirements follow the rules of the board or university for each programme.",
      "steps": [
        { "title": "Counselling and enquiry", "body": "Visit the college office or admission desk to ask about programmes and get counselling." },
        { "title": "Eligibility", "body": "For +2: SEE or equivalent with the required GPA and subject prerequisites. For a bachelor's programme: +2 or equivalent in a relevant stream, following university rules." },
        { "title": "Application", "body": "Submit the application with your transcripts, character certificate, recent photographs and a copy of your citizenship." },
        { "title": "Selection", "body": "Selection is merit-based under the board or university rules. Some programmes may add an interview or orientation counselling." },
        { "title": "Scholarships", "body": "Merit-based and need-based scholarships are available. The Scholarships page says who can apply." },
        { "title": "Enrolment", "body": "Complete the fee formalities and attend an orientation session to finalise subject choices and class schedules." }
      ]
    },
    "scholarships": {
      "intro": "Scholarships are merit-based and need-based, and are confirmed after the college verifies the details.",
      "items": [
        { "title": "Merit-based", "body": "Awarded on academic merit." },
        { "title": "Need-based", "body": "Awarded to students who need financial support." },
        { "title": "Dalit students", "body": "Up to 50% for Dalit students, after verification." },
        { "title": "Economically weaker, Janajati and other marginalised students", "body": "Scholarships are also aimed at these students." }
      ]
    },
    "facilities": {
      "intro": "What the college offers its students.",
      "items": [
        { "name": "Classrooms" },
        { "name": "Library" },
        { "name": "Computer lab" },
        { "name": "Science lab" },
        { "name": "Multimedia room" },
        { "name": "Internet" },
        { "name": "Conference hall" },
        { "name": "Cafeteria" },
        { "name": "Sports", "body": "Football, basketball, volleyball and track events." },
        { "name": "Counselling" },
        { "name": "Journal" },
        { "name": "Tours" },
        { "name": "Extra-curricular activities" }
      ]
    },
    "contact": {
      "address": "Lahan Municipality-3, Siraha, Madhesh Province. On the East-West highway.",
      "phones": ["+977-9801561718", "+977-9802061718", "+977-9801560097", "+977-33-560097"]
    }
  },
```

- [ ] **Step 8: Add the sample school's site block**

In `packs/sample-basic-school/pack.json`, replace the single line `  "theme": {` with:

```json
  "site": {
    "home": {
      "headline": "Sample Basic School: Nursery to Grade 10",
      "summary": "A sample school used to test the platform. Every name, number and address on this site is made up."
    },
    "programmes": [
      { "key": "early-years", "name": "Nursery and KG", "section": "school", "affiliation": "Sample Education Board", "duration": "2 years", "summary": "Play-based learning for the youngest children." },
      { "key": "primary", "name": "Grades 1 to 5", "section": "school", "affiliation": "Sample Education Board", "duration": "5 years", "summary": "Reading, writing, number work and first science." },
      { "key": "lower-secondary", "name": "Grades 6 to 8", "section": "school", "affiliation": "Sample Education Board", "duration": "3 years", "summary": "A wider set of subjects with regular class tests." },
      { "key": "secondary", "name": "Grades 9 and 10", "section": "school", "affiliation": "Sample Education Board", "duration": "2 years", "summary": "Preparation for the final examination." }
    ],
    "admission": {
      "intro": "Admission has three steps.",
      "steps": [
        { "title": "Enquiry", "body": "Ask the school office about places in the grade you need." },
        { "title": "Application", "body": "Submit the form with the child's birth certificate and last report." },
        { "title": "Enrolment", "body": "Pay the first month's fee and meet the class teacher." }
      ]
    },
    "scholarships": {
      "intro": "The sample school has one made-up scholarship.",
      "items": [{ "title": "Sample support", "body": "For a child whose family needs help with fees." }]
    },
    "facilities": {
      "intro": "What the sample school has.",
      "items": [{ "name": "Playground" }, { "name": "Library" }]
    },
    "contact": {
      "address": "12 Example Road, Sample Town",
      "phones": ["+977-00-0000000"],
      "email": "office@sample-school.example"
    }
  },
  "theme": {
```

- [ ] **Step 9: Note the `OPEN:` in the packs README**

In `packs/README.md`, add a row to the Fields table (after the `theme` row): `| `site` | the words of the six fixed public pages: home, programmes, admission, scholarships, facilities, contact |`. Then append at the end of the file:

```markdown

## Site content (Phase 2, slice 3)

`site` is required. It is stored by `npm run provision` as one row and replaced whole when the text changes.

`OPEN:` Royal Softech's `site` block is unconfirmed third-party text (`docs/client-profile.md`, read from directory listings on 2026-09-20): the nine programmes, the admission steps, the scholarship policy (including "up to 50% for Dalit students"), the facilities and the four phone numbers. The college must confirm all of it before the site is made indexable. JSON cannot hold a comment, so the marker is here.

Whether applying a pack should remove content it no longer lists is an open question (D-026). Sections stay; the site row is replaced whole.
```

- [ ] **Step 10: Run the tests to see them pass**

Run: `cd apps/api && npx vitest run test/packs.test.ts test/site-content.test.ts test/sql-render.test.ts`
Expected: PASS.

- [ ] **Step 11: Break it on purpose**

Temporarily remove the line `WHERE content_json != excluded.content_json` from the upsert in `pack.ts` and run `npx vitest run test/packs.test.ts`. Expected: the "re-applying the same pack leaves the row, and its timestamp, untouched" test FAILS. Restore the line and re-run: PASS.

- [ ] **Step 12: Run the whole API suite, then commit**

Run: `cd apps/api && npm run typecheck && npm test`
Expected: PASS. If a test outside this task fails because a pack now lacks `site` (for example one that builds a pack by hand), add a `site` block to its fixture by spreading `royalJson.site`.

```bash
git add apps/api packs
git commit -m "Slice 3a: the site block in the pack, its storage and reader" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /api/site/pages` (slice 3a)

**Files:**
- Create: `apps/api/src/modules/site/schema.ts`, `apps/api/src/modules/site/routes.ts`, `apps/api/test/site-routes.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/openapi.json` (generated), `apps/web/src/api/schema.d.ts` (generated)

**Interfaces:**
- Consumes: `loadSiteContent`, `SiteContentSchema` from `apps/api/src/core/config` (Task 1).
- Produces: `registerSite(app: App): void`, `SITE_PAGES_CACHE = "public, max-age=60"`, the OpenAPI schema `SitePages` = `{ site: SiteContent | null }`, operation id `site_pages`. The web client calls `api.GET("/api/site/pages")` and reads `data.site`.

- [ ] **Step 1: Write the failing route test**

Create `apps/api/test/site-routes.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { SiteContentSchema, applyPack, parsePack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const app = createApp();
const call = (path: string, over: Record<string, unknown> = {}, init: RequestInit = {}) =>
  app.request(`https://school.example${path}`, { headers: { "Sec-Fetch-Site": "same-origin" }, ...init }, { ...env, ...over });

describe("GET /api/site/pages", () => {
  it("says there is nothing yet before a pack with a site block is applied", async () => {
    const response = await call("/api/site/pages", { DB: env.SCRATCH_DB });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ site: null });
  });

  it("anyone may read it with no sign-in, and gets the school's own words", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.DB, pack);
    const response = await call("/api/site/pages");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ site: pack.site });
  });

  it("returns valid site content", async () => {
    const body = (await (await call("/api/site/pages")).json()) as { site: unknown };
    expect(SiteContentSchema.safeParse(body.site).success).toBe(true);
  });

  it("is a short public cache, so a change to the pack shows within about a minute", async () => {
    expect((await call("/api/site/pages")).headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("a second school gets its own words and none of the first school's", async () => {
    const pack = parsePack(sampleJson);
    await applyPack(env.SCRATCH_DB, pack);
    const text = await (await call("/api/site/pages", { DB: env.SCRATCH_DB })).text();
    expect(JSON.parse(text)).toEqual({ site: pack.site });
    for (const word of ["Royal", "Lahan", "Siraha"]) expect(text, word).not.toContain(word);
  });

  it("reads a stored row that no longer parses as not ready", async () => {
    await env.SCRATCH_DB.prepare("UPDATE site_content SET content_json = '{\"home\":1}'").run();
    expect(await (await call("/api/site/pages", { DB: env.SCRATCH_DB })).json()).toEqual({ site: null });
  });

  it("is read only: nothing can be written through it", async () => {
    const response = await call("/api/site/pages", {}, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/api && npx vitest run test/site-routes.test.ts`
Expected: FAIL (404 for `/api/site/pages`).

- [ ] **Step 3: Write the schema and route**

Create `apps/api/src/modules/site/schema.ts`:

```ts
import { z } from "@hono/zod-openapi";

import { SiteContentSchema } from "../../core/config";

/** What the public site pages read: the school's fixed-page words, or null before they are provisioned. */
export const SitePagesSchema = z.object({ site: SiteContentSchema.nullable() }).openapi("SitePages");
```

Create `apps/api/src/modules/site/routes.ts`:

```ts
import { loadSiteContent } from "../../core/config";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { SitePagesSchema } from "./schema";

/** How long a browser may reuse the answer. The words change only when a pack is applied, so a minute is plenty. */
export const SITE_PAGES_CACHE = "public, max-age=60";

export function registerSite(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/site/pages",
      operationId: "site_pages",
      tags: ["site"],
      description:
        "The words of the school's six fixed public pages (home, programmes, admission, scholarships, facilities, contact), from its pack. `site` is null before the school has been provisioned with them. The same for every visitor.",
      access: { action: "site.view" },
      responses: { 200: { description: "The fixed pages' words, or null", content: { "application/json": { schema: SitePagesSchema } } } },
    },
    async (c) => {
      const site = await loadSiteContent(c.env.DB);
      c.header("Cache-Control", SITE_PAGES_CACHE);
      return c.json({ site }, 200);
    },
  );
}
```

In `apps/api/src/app.ts` add `import { registerSite } from "./modules/site/routes";` after the health import, and `registerSite(app);` after `registerDates(app);`.

- [ ] **Step 4: Run the route test to see it pass**

Run: `cd apps/api && npx vitest run test/site-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the contract and the web types**

```bash
cd apps/api && npm run gen:openapi
cd ../web && npm run gen:api
```

Run: `grep -n "SitePages" apps/web/src/api/schema.d.ts | head` (from the repo root).
Expected: `SitePages` appears under `components.schemas` and a `"/api/site/pages"` path exists.

- [ ] **Step 6: Run the API checks the CI runs**

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
npm run gen:permissions && git diff --exit-code ../../docs/permission-matrix.md
node ../../scripts/check-boundaries.mjs
```

Expected: all pass, and no diff in the permission document. (`site.view` already exists, so the matrix does not change.)

- [ ] **Step 7: Commit**

```bash
git add apps/api apps/web/src/api/schema.d.ts docs
git commit -m "Slice 3a: GET /api/site/pages, the fixed pages' words for the public" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The Worker fills in the six pages for crawlers (slice 3b)

**Files:**
- Create: `apps/api/src/modules/site/page-types.ts`, `apps/api/src/modules/site/site-pages.ts`, `apps/web/src/shell/site-links.ts`, `apps/web/test/site-links.test.ts`
- Modify: `apps/api/src/modules/site/pages.ts`, `render.ts`, `strings.ts`, `apps/api/wrangler.jsonc`, `apps/api/wrangler.local.jsonc` (git-ignored), `apps/api/test/site-render.test.ts`, `apps/api/test/crawler-files.test.ts`, `apps/web/src/i18n/messages.ts`, `apps/web/test/site-strings.test.ts`

**Interfaces:**
- Consumes: `SiteContent`, `loadSiteContent` (Task 1).
- Produces: `PageContext.site: () => Promise<SiteContent | null>` (read once, on first call); `Builder = (ctx) => Promise<PageParts | null>` where `null` means "serve the static page untouched"; exported builders `home, programmes, admission, scholarships, facilities, contact` from `site-pages.ts`; `groupProgrammes(sections, programmes)`; shared string keys `site.programmes.title`, `site.admission.title`, `site.scholarships.title`, `site.facilities.title`, `site.contact.title` (in `STRINGS` and the web catalog with equal text); web `SITE_LINKS: readonly { href: string; labelKey: MessageKey }[]` in `apps/web/src/shell/site-links.ts`.
- Only the five page titles are shared with the web catalog, because the Worker's `<title>` must equal the one the app sets (`formatTitle`, `usePageTitle`). The other crawler words are `CRAWLER_ONLY`.

- [ ] **Step 1: Write the failing crawler tests**

In `apps/api/test/site-render.test.ts`:

1. Add the import `import { escapeHtml } from "../src/modules/site/html";` and, after the line `const key = env.AUDIT_HMAC_KEY;`, add `const royalSite = parsePack(royalJson).site;`
2. In the test "puts the real words in a plain block at the top of the body..." replace the h1 line `expect(copy).toMatch(/<h1>Welcome to Royal Softech College<\/h1>/);` with:
   `expect(copy).toContain(`<h1>${escapeHtml(royalSite.home.headline)}</h1>`);`
3. In "the home page gets a title, a description and a canonical address..." replace the description line (`expect(html).toMatch(/<meta name="description" ...`) with:
   `expect(html).toContain(`<meta name="description" content="${escapeHtml(royalSite.home.summary)}"/>`);`
4. In the first test of "which addresses are filled in", make the list `["/", "/notices", "/programmes", "/admission", "/scholarships", "/facilities", "/contact"]`.

Add this block at the end of the file:

```ts
describe("the six fixed pages", () => {
  const SIX = ["/", "/programmes", "/admission", "/scholarships", "/facilities", "/contact"];
  const LINKS = ["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"];
  const fixed: [string, string, string[]][] = [
    ["/programmes", "Programmes", ["+2 Science", "Bachelor of Business Studies (BBS)", "Purbanchal University (PU)", "Biology, Mathematics, Computer Science", "Microbiology, Zoology, Botany, Chemistry, Physics"]],
    ["/admission", "Admission", ["Counselling and enquiry", "Enrolment"]],
    ["/scholarships", "Scholarships", ["Merit-based", "Up to 50% for Dalit students, after verification."]],
    ["/facilities", "Facilities", ["Library", "Football, basketball, volleyball and track events."]],
    ["/contact", "Contact", ["Lahan Municipality-3", "+977-9801561718", "+977-33-560097"]],
  ];

  beforeAll(async () => {
    await applyPack(db, parsePack(royalJson));
  });

  it.each(fixed)("%s has its title, canonical address, heading, links to every page and its own words", async (path, heading, words) => {
    const { html } = await page(path, { origin: "https://royal.example" });
    expect(html).toContain(`<title>${heading} | Royal Softech College</title>`);
    expect(html).toContain(`rel="canonical" href="https://royal.example${path}"`);
    const copy = copyOf(html);
    expect(copy).toContain(`<h1>${heading}</h1>`);
    for (const link of LINKS) expect(copy, link).toContain(`<a href="${link}">`);
    for (const text of words) expect(copy, text).toContain(text);
  });

  it("Home leads with its headline and the way to apply, then groups the programmes by section, then the steps and the contact", async () => {
    const copy = copyOf((await page("/")).html);
    expect(copy).toContain(`<h1>${escapeHtml(royalSite.home.headline)}</h1>`);
    expect(copy).toContain('<a href="/admission">How to apply</a>');
    expect(copy.indexOf("<h3>+2</h3>")).toBeLessThan(copy.indexOf("<h3>Bachelor&#39;s</h3>"));
    expect(copy).toContain('<a href="/programmes#bbs">');
    for (const step of royalSite.admission.steps) expect(copy).toContain(`<li>${escapeHtml(step.title)}</li>`);
    expect(copy).toContain("Phone: +977-9801561718");
    expect(copy.indexOf("How to apply</h2>")).toBeLessThan(copy.indexOf("<h2>Contact</h2>"));
  });

  it("describes the pages in structured data, from what the pack says and nothing more", async () => {
    const programmesLd = jsonLd((await page("/programmes", { origin: "https://royal.example" })).html).find((b) => b["@type"] === "ItemList")!;
    const items = programmesLd.itemListElement as { name: string; url: string; position: number }[];
    expect(items).toHaveLength(9);
    expect(items[0]).toMatchObject({ position: 1, name: "+2 Science", url: "https://royal.example/programmes#plus2-science" });

    const howTo = jsonLd((await page("/admission")).html).find((b) => b["@type"] === "HowTo")!;
    expect(howTo.name).toBe("How to apply to Royal Softech College");
    expect((howTo.step as unknown[]).length).toBe(6);

    const contactLd = jsonLd((await page("/contact")).html).find((b) => b["@type"] === "ContactPage")!;
    expect(contactLd.mainEntity).toMatchObject({ "@type": "EducationalOrganization", telephone: royalSite.contact.phones });

    const facilitiesLd = jsonLd((await page("/facilities")).html).find((b) => b["@type"] === "ItemList")!;
    expect((facilitiesLd.itemListElement as unknown[]).length).toBe(13);
    for (const path of SIX) for (const block of jsonLd((await page(path)).html)) expect(block["@context"]).toBe("https://schema.org");
  });

  it("escapes hostile text from the pack on every page, in the block and in structured data", async () => {
    const bad = structuredClone(royalJson) as any;
    const script = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    bad.site.home.headline = script;
    bad.site.programmes[0].name = script;
    bad.site.programmes[0].summary = script;
    bad.site.admission.steps[0].title = script;
    bad.site.scholarships.items[0].body = script;
    bad.site.facilities.items[0].name = script;
    bad.site.contact.address = script;
    await applyPack(db, parsePack(bad));
    for (const path of SIX) {
      const { html } = await page(path);
      expect(html, path).not.toContain('<script>alert("x")');
      expect(html, path).not.toContain("<img src=x");
      for (const block of jsonLd(html)) expect(block, path).toBeTruthy(); // every block still parses
    }
    expect(copyOf((await page("/contact")).html)).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    await applyPack(db, parsePack(royalJson));
  });

  it("another school gets its own words on every page, and none of the first school's", async () => {
    await applyPack(db, parsePack(sampleJson));
    for (const path of SIX) {
      const { html } = await page(path);
      for (const word of ["Royal", "Lahan", "Siraha", "Purbanchal", "Tribhuvan", "NEB"]) expect(html, `${path} ${word}`).not.toContain(word);
    }
    expect(copyOf((await page("/")).html)).toContain("Sample Basic School: Nursery to Grade 10");
    await applyPack(db, parsePack(royalJson));
  });

  it("serves the static page untouched when the school has no site words yet (before provisioning with them)", async () => {
    await db.prepare("DELETE FROM site_content").run();
    for (const path of SIX) expect((await page(path)).html, path).toBe(SHELL);
    // The notice board does not depend on them.
    expect(copyOf((await page("/notices")).html)).toContain("<h1>Notices and updates</h1>");
    await applyPack(db, parsePack(royalJson));
  });

  it("reads the database twice for a fixed page: the configuration batch, then one statement for the words", async () => {
    let statements = 0;
    let batches = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") return (sql: string) => { statements++; return target.prepare(sql); };
        if (prop === "batch") return async (list: D1PreparedStatement[]) => { batches++; return target.batch(list); };
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;
    await renderPublicPage(new Request("https://school.example/programmes"), { ...env, DB: counting, ASSETS: assets().binding });
    expect(batches).toBe(1);
    expect(statements).toBe(6); // five in the configuration batch, one for the words
  });
});
```

In `apps/api/test/crawler-files.test.ts`, add inside `describe("sitemap.xml", ...)`:

```ts
  it("lists the six fixed pages and the notice board", async () => {
    const { text } = await ask("/sitemap.xml", production);
    for (const path of ["/", "/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"]) expect(text, path).toContain(`<loc>https://royal.example${path}</loc>`);
  });
```

and inside `describe("llms.txt", ...)`:

```ts
  it("introduces every fixed page with its own line", async () => {
    const { text } = await ask("/llms.txt", production);
    expect(text).toContain("- [Programmes](https://royal.example/programmes): The programmes offered by Royal Softech College, with their levels, affiliations and durations.");
    expect(text).toContain("- [Admission](https://royal.example/admission): How to apply to Royal Softech College: the admission steps, from enquiry to enrolment.");
    for (const path of ["/scholarships", "/facilities", "/contact"]) expect(text, path).toContain(`](https://royal.example${path}): `);
  });
```

- [ ] **Step 2: Write the failing web tests**

Create `apps/web/test/site-links.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { t } from "@/i18n/messages";
import { SITE_LINKS } from "@/shell/site-links";
import { FILLED_PAGES } from "../../api/src/modules/site";

describe("the links to the public pages", () => {
  it("are the pages the Worker fills in, except Home (the school's name is that link), in reading order", () => {
    expect(SITE_LINKS.map((l) => l.href)).toEqual(["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"]);
    expect(SITE_LINKS.map((l) => l.href).sort()).toEqual(FILLED_PAGES.filter((p) => p !== "/").sort());
  });

  it("each has a label from the catalog", () => {
    expect(SITE_LINKS.map((l) => t(l.labelKey))).toEqual(["Programmes", "Admission", "Scholarships", "Facilities", "Contact", "Notices and updates"]);
  });
});
```

In `apps/web/test/site-strings.test.ts`, extend the key list in "covers what a crawler needs to read" with `"site.programmes.title", "site.admission.title", "site.scholarships.title", "site.facilities.title", "site.contact.title"`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd apps/api && npx vitest run test/site-render.test.ts test/crawler-files.test.ts`
Expected: FAIL (the new pages are not filled in; Home still says "Welcome to").

Run: `cd apps/web && npx vitest run test/site-links.test.ts test/site-strings.test.ts`
Expected: FAIL (`@/shell/site-links` does not exist).

- [ ] **Step 4: Write the shared types**

Create `apps/api/src/modules/site/page-types.ts`:

```ts
import type { SiteContent } from "../../core/config";

/** What a page builder is given. Nothing here is trusted as markup: every value is escaped where it is written. */
export interface PageContext {
  db: D1Database;
  school: { name: string; shortName: string };
  sections: { key: string; name: string }[];
  origin: string;
  path: string;
  /** The words of the fixed pages, read from the database the first time it is called. Null before the school has them. */
  site: () => Promise<SiteContent | null>;
}

/** What a page adds to its static shell. */
export interface PageParts {
  title: string;
  description: string;
  /** Structured data blocks, besides the organisation every page gets. */
  structuredData: Record<string, unknown>[];
  /** The plain HTML for the top of the body. Built only from escaped values. */
  bodyHtml: string;
}

/** Returns null when there is nothing true to say yet: the static page is then served untouched. */
export type Builder = (ctx: PageContext) => Promise<PageParts | null>;
```

- [ ] **Step 5: Write the words**

In `apps/api/src/modules/site/strings.ts`, add to `STRINGS` (after `"content.kind.post"`):

```ts
  "site.programmes.title": "Programmes",
  "site.admission.title": "Admission",
  "site.scholarships.title": "Scholarships",
  "site.facilities.title": "Facilities",
  "site.contact.title": "Contact",
```

Add to `CRAWLER_ONLY`, and change the existing `"llms.homeSummary"` to `"The home page of {school}: its programmes, how to apply and how to get in touch."`:

```ts
  "site.programmes.description": "The programmes offered by {school}, with their levels, affiliations and durations.",
  "site.admission.description": "How to apply to {school}: the admission steps, from enquiry to enrolment.",
  "site.scholarships.description": "Scholarships offered by {school} and who can apply.",
  "site.facilities.description": "The facilities at {school}.",
  "site.contact.description": "The address and phone numbers of {school}.",
  "site.admission.howTo": "How to apply to {school}",
  "site.home.apply": "How to apply",
  "site.home.seeProgrammes": "See every programme",
  "site.home.seeAdmission": "Read the full admission process",
  "site.home.seeContact": "See all contact details",
  "site.affiliation": "Affiliation",
  "site.duration": "Duration",
  "site.options": "Options",
  "site.address": "Address",
  "site.phone": "Phone",
  "site.email": "Email",
  "site.hours": "Office hours",
```

In `apps/web/src/i18n/messages.ts`, add before the closing `} as const;`:

```ts

  // Public site pages (Phase 2, slice 3). The titles are shared with the Worker's copy for crawlers
  // (`modules/site/strings.ts`), so the tab title the app sets is the one the Worker wrote.
  "site.programmes.title": "Programmes",
  "site.admission.title": "Admission",
  "site.scholarships.title": "Scholarships",
  "site.facilities.title": "Facilities",
  "site.contact.title": "Contact",
```

Create `apps/web/src/shell/site-links.ts`:

```ts
import type { MessageKey } from "@/i18n/messages";

/**
 * The public pages the header and footer link to, in reading order. Home is left out: the school's name is
 * the link to it. A test checks this list against the pages the Worker fills in, so a new public page is
 * not forgotten here.
 */
export const SITE_LINKS: readonly { href: string; labelKey: MessageKey }[] = [
  { href: "/programmes", labelKey: "site.programmes.title" },
  { href: "/admission", labelKey: "site.admission.title" },
  { href: "/scholarships", labelKey: "site.scholarships.title" },
  { href: "/facilities", labelKey: "site.facilities.title" },
  { href: "/contact", labelKey: "site.contact.title" },
  { href: "/notices", labelKey: "notices.title" },
];
```

- [ ] **Step 6: Write the builders**

Create `apps/api/src/modules/site/site-pages.ts`:

```ts
import type { SiteContent } from "../../core/config";
import { escapeHtml } from "./html";
import type { Builder, PageContext } from "./page-types";
import { say } from "./strings";

/** The crawler copy of the six fixed pages (D-046). Every value from the pack is escaped where it is written. */
const e = escapeHtml;
type Key = Parameters<typeof say>[0];
type Programme = SiteContent["programmes"][number];

const LINKS: [string, Key][] = [
  ["/programmes", "site.programmes.title"],
  ["/admission", "site.admission.title"],
  ["/scholarships", "site.scholarships.title"],
  ["/facilities", "site.facilities.title"],
  ["/contact", "site.contact.title"],
  ["/notices", "notices.title"],
];
const nav = (): string => `<nav>${LINKS.map(([href, key]) => `<a href="${href}">${e(say(key))}</a>`).join(" ")}</nav>`;

const titled = (ctx: PageContext, title: Key, description: Key) => ({
  title: `${say(title)} | ${ctx.school.name}`,
  description: say(description, { school: ctx.school.name }),
});

const LD = "https://schema.org";

/** The programmes under each section's name, in the section's order. One whose section is unknown goes last, with no heading. */
export function groupProgrammes(sections: { key: string; name: string }[], programmes: Programme[]): { name: string | null; items: Programme[] }[] {
  const groups = sections.map((s) => ({ name: s.name as string | null, items: programmes.filter((p) => p.section === s.key) })).filter((g) => g.items.length > 0);
  const known = new Set(sections.map((s) => s.key));
  const rest = programmes.filter((p) => !known.has(p.section));
  return rest.length > 0 ? [...groups, { name: null, items: rest }] : groups;
}

const facts = (p: Programme): string =>
  `<p>${e(say("site.affiliation"))}: ${e(p.affiliation)}. ${e(say("site.duration"))}: ${e(p.duration)}.</p>` +
  (p.options.length > 0 ? `<p>${e(say("site.options"))}: ${e(p.options.join(", "))}.</p>` : "");

export const home: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const groups = groupProgrammes(ctx.sections, site.programmes);
  return {
    title: ctx.school.name,
    description: site.home.summary,
    structuredData: [],
    bodyHtml:
      `<h1>${e(site.home.headline)}</h1><p>${e(site.home.summary)}</p>` +
      `<p><a href="/admission">${e(say("site.home.apply"))}</a> <a href="/notices">${e(say("home.notices"))}</a></p>` +
      `<h2>${e(say("site.programmes.title"))}</h2>` +
      groups
        .map((g) => (g.name ? `<h3>${e(g.name)}</h3>` : "") + `<ul>${g.items.map((p) => `<li><a href="/programmes#${e(p.key)}">${e(p.name)}</a>: ${e(p.affiliation)}, ${e(p.duration)}</li>`).join("")}</ul>`)
        .join("") +
      `<p><a href="/programmes">${e(say("site.home.seeProgrammes"))}</a></p>` +
      `<h2>${e(say("site.home.apply"))}</h2><ol>${site.admission.steps.map((s) => `<li>${e(s.title)}</li>`).join("")}</ol>` +
      `<p><a href="/admission">${e(say("site.home.seeAdmission"))}</a></p>` +
      `<h2>${e(say("site.contact.title"))}</h2><p>${e(site.contact.address)}</p><p>${e(say("site.phone"))}: ${e(site.contact.phones[0]!)}</p>` +
      `<p><a href="/contact">${e(say("site.home.seeContact"))}</a></p>` +
      nav(),
  };
};

export const programmes: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const groups = groupProgrammes(ctx.sections, site.programmes);
  return {
    ...titled(ctx, "site.programmes.title", "site.programmes.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "ItemList",
        name: say("site.programmes.title"),
        url: `${ctx.origin}/programmes`,
        itemListElement: site.programmes.map((p, index) => ({ "@type": "ListItem", position: index + 1, name: p.name, url: `${ctx.origin}/programmes#${p.key}` })),
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.programmes.title"))}</h1>` +
      groups
        .map((g) => (g.name ? `<h2>${e(g.name)}</h2>` : "") + g.items.map((p) => `<article id="${e(p.key)}"><h3>${e(p.name)}</h3><p>${e(p.summary)}</p>${facts(p)}</article>`).join(""))
        .join("") +
      nav(),
  };
};

export const admission: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const { intro, steps } = site.admission;
  return {
    ...titled(ctx, "site.admission.title", "site.admission.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "HowTo",
        name: say("site.admission.howTo", { school: ctx.school.name }),
        step: steps.map((s, index) => ({ "@type": "HowToStep", position: index + 1, name: s.title, text: s.body })),
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.admission.title"))}</h1><p>${e(intro)}</p>` +
      `<ol>${steps.map((s) => `<li><h2>${e(s.title)}</h2><p>${e(s.body)}</p></li>`).join("")}</ol>` +
      nav(),
  };
};

export const scholarships: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const { intro, items } = site.scholarships;
  return {
    ...titled(ctx, "site.scholarships.title", "site.scholarships.description"),
    structuredData: [],
    bodyHtml:
      `<h1>${e(say("site.scholarships.title"))}</h1><p>${e(intro)}</p>` +
      `<ul>${items.map((i) => `<li><h2>${e(i.title)}</h2><p>${e(i.body)}</p></li>`).join("")}</ul>` +
      nav(),
  };
};

export const facilities: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const { intro, items } = site.facilities;
  return {
    ...titled(ctx, "site.facilities.title", "site.facilities.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "ItemList",
        name: say("site.facilities.title"),
        url: `${ctx.origin}/facilities`,
        itemListElement: items.map((i, index) => ({ "@type": "ListItem", position: index + 1, name: i.name })),
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.facilities.title"))}</h1><p>${e(intro)}</p>` +
      `<ul>${items.map((i) => `<li>${e(i.name)}${i.body ? `: ${e(i.body)}` : ""}</li>`).join("")}</ul>` +
      nav(),
  };
};

export const contact: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const c = site.contact;
  return {
    ...titled(ctx, "site.contact.title", "site.contact.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "ContactPage",
        name: say("site.contact.title"),
        url: `${ctx.origin}/contact`,
        mainEntity: {
          "@type": "EducationalOrganization",
          name: ctx.school.name,
          url: ctx.origin,
          address: { "@type": "PostalAddress", streetAddress: c.address },
          telephone: c.phones,
          ...(c.email ? { email: c.email } : {}),
        },
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.contact.title"))}</h1>` +
      `<p>${e(say("site.address"))}: ${e(c.address)}</p>` +
      `<p>${e(say("site.phone"))}: ${e(c.phones.join(", "))}</p>` +
      (c.email ? `<p>${e(say("site.email"))}: ${e(c.email)}</p>` : "") +
      (c.hours ? `<p>${e(say("site.hours"))}: ${e(c.hours)}</p>` : "") +
      nav(),
  };
};
```

- [ ] **Step 7: Register the pages and read the words lazily**

In `apps/api/src/modules/site/pages.ts`:

1. Add these imports with the others at the top, and re-export the two types the file used to define:

```ts
import type { Builder, PageContext, PageParts } from "./page-types";
import { admission, contact, facilities, home, programmes, scholarships } from "./site-pages";

export type { PageContext, PageParts };
```

2. Delete the local `interface PageContext`, `interface PageParts`, `type Builder = ...` and the whole `const home: Builder = ...` block. Keep `bsWords` and `notices`.
3. Replace the `PAGES` object with:

```ts
const PAGES: Record<string, Builder> = {
  "/": home,
  "/notices": notices,
  "/programmes": programmes,
  "/admission": admission,
  "/scholarships": scholarships,
  "/facilities": facilities,
  "/contact": contact,
};
```

4. Add to `SUMMARIES` (keep the two that exist):

```ts
  "/programmes": (school) => ({ name: say("site.programmes.title"), summary: say("site.programmes.description", { school }) }),
  "/admission": (school) => ({ name: say("site.admission.title"), summary: say("site.admission.description", { school }) }),
  "/scholarships": (school) => ({ name: say("site.scholarships.title"), summary: say("site.scholarships.description", { school }) }),
  "/facilities": (school) => ({ name: say("site.facilities.title"), summary: say("site.facilities.description", { school }) }),
  "/contact": (school) => ({ name: say("site.contact.title"), summary: say("site.contact.description", { school }) }),
```

In `apps/api/src/modules/site/render.ts`:

1. Change the config import to `import { loadConfig, loadSiteContent, type SiteContent } from "../../core/config";`
2. Replace the line `const parts = await builderFor(url.pathname)({ ... });` with:

```ts
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
```

- [ ] **Step 8: Register the addresses with Cloudflare**

In `apps/api/wrangler.jsonc` replace the single line beginning `"run_worker_first":` with:

```jsonc
    "run_worker_first": ["/api/*", "/", "/notices", "/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/robots.txt", "/sitemap.xml", "/llms.txt"],
```

Do the same in the git-ignored `apps/api/wrangler.local.jsonc`: find the line with `grep -n run_worker_first apps/api/wrangler.local.jsonc` and replace only that line with the same list.

- [ ] **Step 9: Run the tests to see them pass**

```bash
cd apps/api && npx vitest run test/site-render.test.ts test/crawler-files.test.ts test/worker-entry.test.ts
node ../../scripts/check-boundaries.mjs
cd ../web && npx vitest run test/site-links.test.ts test/site-strings.test.ts
```

Expected: PASS, and "Layer boundaries hold."

- [ ] **Step 10: Break it on purpose**

1. Remove `"/contact": contact,` from `PAGES`. `check-boundaries.mjs` must fail with "public addresses differ", and the `/contact` cases in `site-render.test.ts` must fail. Restore it.
2. In `site-pages.ts`, change `e(p.name)` in the Programmes builder to `p.name`. The hostile-text test must fail. Restore it.

- [ ] **Step 11: Run what the CI runs for the API, then commit**

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
```

Do not run the whole web suite yet: `guards.test.ts` and `render.test.tsx` are brought up to date by Tasks 4 to 6.

```bash
git add apps/api/src apps/api/test apps/api/wrangler.jsonc apps/web/src/i18n/messages.ts apps/web/src/shell/site-links.ts apps/web/test
git commit -m "Slice 3b: the Worker fills in the six fixed pages for crawlers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: The web frame and the five inner pages (slice 3c)

**Files:**
- Create: `apps/web/src/site/model.ts`, `client.ts`, `SiteFrame.tsx`, `ProgrammesView.tsx`, `AdmissionView.tsx`, `ScholarshipsView.tsx`, `FacilitiesView.tsx`, `ContactView.tsx`, `site.module.css`; `apps/web/src/app/{programmes,admission,scholarships,facilities,contact}/page.tsx`; `apps/web/test/site-model.test.ts`, `site-client.test.ts`, `site-pages.test.tsx`
- Modify: `apps/web/src/i18n/messages.ts`, `apps/web/test/guards.test.ts`

**Interfaces:**
- Consumes: `GET /api/site/pages` and its generated type `components["schemas"]["SitePages"]` (Task 2); `SITE_LINKS` and the five `site.*.title` keys (Task 3); `contactHref` from `@/content/model`; `usePageTitle`; `ConfigGate`; `useConfig().config.sections`.
- Produces: `SiteContent`, `Programme` types and `groupProgrammes(sections, programmes)` in `site/model.ts`; `loadSite(api): Promise<{ ok: true; site: SiteContent | null } | { ok: false }>` in `site/client.ts`; `SiteView` (`loading | ready | notReady | failed`), `useSite()`, `SiteFrameView({ title, view, onRetry, children })` (pure, testable) and `SiteFrame({ title, children })` in `site/SiteFrame.tsx`; `ProgrammesView({ site, sections })`, `AdmissionView({ site })`, `ScholarshipsView({ site })`, `FacilitiesView({ site })`, `ContactView({ site })`; CSS classes in `site.module.css` (`stack`, `intro`, `group`, `groupTitle`, `itemTitle`, `anchor`, `facts`, `fact`, `steps`, `step`, `stepNumber`, `list`, `item`, `facilityList`, `facility`, `facilityName`, `muted`, `plain`, `contactLink`, `pageTitle`) that Task 5 reuses.

- [ ] **Step 1: Read the Next.js notes for this version**

`apps/web/AGENTS.md` says this Next.js has breaking changes. Read the parts that apply before writing pages: run `ls apps/web/node_modules/next/dist/docs` and open the guides on static export (`output: "export"`), client components and `usePathname`. Note anything that changes what the steps below assume (route file names, `"use client"`, hash links with `Link`). If something differs, follow the docs and say so in the commit message.

- [ ] **Step 2: Design search (no `--persist`)**

Load the `ui-ux-pro-max` skill. Detect the stack (Next.js static export) and run the smallest searches that fit, for example: a UX search on "content pages list card hierarchy college", a UX search on "responsive navigation menu mobile", and a stack search for Next.js. Do not create a `design-system/` folder. Treat every suggestion as an idea to express with existing theme tokens, never as a value to paste. Write down which searches you ran; they go in the final report.

- [ ] **Step 3: Write the failing tests**

Create `apps/web/test/site-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { groupProgrammes } from "@/site/model";

const programme = (key: string, section: string) => ({ key, name: key, section, affiliation: "A", duration: "1 year", summary: "S", options: [] as string[] });
const sections = [{ key: "plus2", name: "+2" }, { key: "bachelors", name: "Bachelor's" }];

describe("groupProgrammes", () => {
  it("groups by section, in the section order, keeping each group's own order", () => {
    const groups = groupProgrammes(sections, [programme("b1", "bachelors"), programme("p1", "plus2"), programme("b2", "bachelors")]);
    expect(groups.map((g) => g.name)).toEqual(["+2", "Bachelor's"]);
    expect(groups[1]!.items.map((p) => p.key)).toEqual(["b1", "b2"]);
  });

  it("leaves out a section with nothing in it", () => {
    expect(groupProgrammes(sections, [programme("p1", "plus2")]).map((g) => g.name)).toEqual(["+2"]);
  });

  it("puts a programme in an unknown section last, with no heading, rather than losing it", () => {
    const groups = groupProgrammes(sections, [programme("x", "gone"), programme("p1", "plus2")]);
    expect(groups.map((g) => g.name)).toEqual(["+2", null]);
    expect(groups[1]!.items[0]!.key).toBe("x");
  });
});
```

Create `apps/web/test/site-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import { loadSite } from "@/site/client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const clientFor = (respond: () => Promise<Response>) => createApiClient({ baseUrl: "https://school.example", fetch: async () => respond() });

describe("loadSite", () => {
  it("returns the words when the school has them", async () => {
    const site = { home: { headline: "H", summary: "S" } };
    const result = await loadSite(clientFor(async () => json({ site })));
    expect(result).toEqual({ ok: true, site });
  });

  it("returns null words, not a failure, when the school has none yet", async () => {
    expect(await loadSite(clientFor(async () => json({ site: null })))).toEqual({ ok: true, site: null });
  });

  it("is a failure on a server error and on a dropped connection, and never throws", async () => {
    expect(await loadSite(clientFor(async () => json({ error: "x" }, 500)))).toEqual({ ok: false });
    expect(await loadSite(clientFor(async () => { throw new TypeError("network"); }))).toEqual({ ok: false });
  });
});
```

Create `apps/web/test/site-pages.test.tsx`:

```tsx
/* eslint-disable @typescript-eslint/no-explicit-any -- the test deliberately edits loosely-typed pack data */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ProgrammesPage from "@/app/programmes/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { AdmissionView } from "@/site/AdmissionView";
import { ContactView } from "@/site/ContactView";
import { FacilitiesView } from "@/site/FacilitiesView";
import { ProgrammesView } from "@/site/ProgrammesView";
import { ScholarshipsView } from "@/site/ScholarshipsView";
import { SiteFrameView } from "@/site/SiteFrame";
import { fakeSession } from "./session";
import { parsePack } from "../../api/src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/programmes", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** What React writes for text: it escapes an apostrophe as &#x27;. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe.each([
  { label: "Royal Softech", json: royalJson },
  { label: "Sample Basic School", json: sampleJson },
])("$label's pages", ({ json }) => {
  const pack = parsePack(json);
  const site = pack.site;

  it("Programmes: every programme is a card with its anchor, grouped under its section", () => {
    const html = renderToStaticMarkup(<ProgrammesView site={site} sections={pack.sections} />);
    for (const p of site.programmes) {
      expect(html, p.key).toContain(`id="${p.key}"`);
      expect(html).toContain(esc(p.name));
      expect(html).toContain(esc(p.affiliation));
    }
    for (const s of pack.sections) expect(html).toContain(`>${esc(s.name)}</h2>`);
    // "Options" appears only for a programme that has some.
    expect(count(html, />Options</g)).toBe(site.programmes.filter((p) => p.options.length > 0).length);
  });

  it("Admission: the steps are an ordered list numbered in words, with one prominent way on", () => {
    const html = renderToStaticMarkup(<AdmissionView site={site} />);
    expect(count(html, /<li/g)).toBe(site.admission.steps.length);
    site.admission.steps.forEach((step, index) => {
      expect(html).toContain(`Step ${index + 1}`);
      expect(html).toContain(esc(step.title));
    });
    expect(html).toContain("<ol");
    expect(count(html, /class="button primary/g)).toBe(1);
    expect(html).toMatch(/<a[^>]*href="\/contact"[^>]*>Contact the college<\/a>/);
  });

  it("Scholarships: an item for each, with its words", () => {
    const html = renderToStaticMarkup(<ScholarshipsView site={site} />);
    for (const item of site.scholarships.items) expect(html).toContain(esc(item.title));
    expect(count(html, /class="button primary/g)).toBe(0);
  });

  it("Facilities: every facility by name, and its note when it has one", () => {
    const html = renderToStaticMarkup(<FacilitiesView site={site} />);
    for (const item of site.facilities.items) {
      expect(html).toContain(esc(item.name));
      if (item.body) expect(html).toContain(esc(item.body));
    }
  });

  it("Contact: the address, every phone as a call link, and an email link only when there is one", () => {
    const html = renderToStaticMarkup(<ContactView site={site} />);
    expect(html).toContain(esc(site.contact.address));
    for (const phone of site.contact.phones) expect(html).toContain(`href="tel:${phone.startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}"`);
    expect(count(html, /href="mailto:/g)).toBe(site.contact.email ? 1 : 0);
  });

  it("carries no colour of its own: nothing but theme variables can colour it", () => {
    const html = [
      renderToStaticMarkup(<ProgrammesView site={site} sections={pack.sections} />),
      renderToStaticMarkup(<AdmissionView site={site} />),
      renderToStaticMarkup(<ContactView site={site} />),
    ].join("");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});

describe("text from the pack is shown as text, never run", () => {
  const script = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
  const bad = structuredClone(royalJson) as any;
  bad.site.programmes[0].name = script;
  bad.site.admission.steps[0].body = script;
  bad.site.scholarships.items[0].title = script;
  bad.site.facilities.items[0].name = script;
  bad.site.contact.address = script;
  const pack = parsePack(bad);

  it("on every page", () => {
    const html = [
      renderToStaticMarkup(<ProgrammesView site={pack.site} sections={pack.sections} />),
      renderToStaticMarkup(<AdmissionView site={pack.site} />),
      renderToStaticMarkup(<ScholarshipsView site={pack.site} />),
      renderToStaticMarkup(<FacilitiesView site={pack.site} />),
      renderToStaticMarkup(<ContactView site={pack.site} />),
    ].join("");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the frame around a page's words", () => {
  const site = parsePack(royalJson).site;
  const frame = (view: Parameters<typeof SiteFrameView>[0]["view"]) =>
    renderToStaticMarkup(
      <SiteFrameView title="Programmes" view={view} onRetry={() => {}}>
        {() => <p>the words</p>}
      </SiteFrameView>,
    );

  it("always has the page's one heading", () => {
    for (const view of [{ status: "loading" }, { status: "failed" }, { status: "notReady" }, { status: "ready", site }] as const) {
      expect(count(frame(view), /<h1/g)).toBe(1);
    }
  });

  it("shows the shape of the page while it loads, as a labelled status, and no words yet", () => {
    const html = frame({ status: "loading" });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading…");
    expect(html).not.toContain("the words");
  });

  it("says plainly that the page cannot load, with a way to try again", () => {
    const html = frame({ status: "failed" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load this page.");
    expect(html).toContain("Try again");
  });

  it("says calmly that the page is not ready yet, and is not an alarm", () => {
    const html = frame({ status: "notReady" });
    expect(html).toContain("This page isn&#x27;t ready yet");
    expect(html).not.toContain('role="alert"');
  });

  it("shows the words once they are ready", () => {
    const html = frame({ status: "ready", site });
    expect(html).toContain("the words");
    expect(html).not.toContain('role="status"');
  });
});

describe("a page as the visitor first sees it", () => {
  const config: PublicConfig = {
    school: { name: "Royal Softech College", shortName: "Royal Softech", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
    sections: royalJson.sections,
    modules: {},
    terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Admin", "term.terminal": "Terminal", "term.programme": "Programme", "term.level": "Level", "term.section": "Section" },
    theme: royalJson.theme as PublicConfig["theme"],
  };

  it("starts on its heading and a loading placeholder, with no sign-in needed and nothing alarming", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <SessionContext.Provider value={fakeSession()}>
          <ProgrammesPage />
        </SessionContext.Provider>
      </ConfigContext.Provider>,
    );
    expect(html).toMatch(/<h1[^>]*>Programmes<\/h1>/);
    expect(html).toContain("Loading…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="alert"');
  });
});
```

In `apps/web/test/guards.test.ts`, extend the test "the notice board's filter buttons and a vacancy's contact link are full-size targets too" by adding one more line inside it:

```ts
    expect(css("site/site.module.css")).toMatch(/\.contactLink\s*\{[^}]*min-height:\s*var\(--control-height\)/);
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/site-model.test.ts test/site-client.test.ts test/site-pages.test.tsx test/guards.test.ts`
Expected: FAIL (the `@/site/*` modules and the pages do not exist).

- [ ] **Step 5: Add the words**

In `apps/web/src/i18n/messages.ts`, add after the five `site.*.title` keys from Task 3:

```ts
  "site.affiliation": "Affiliation",
  "site.duration": "Duration",
  "site.options": "Options",
  "site.step": "Step {number}",
  "site.address": "Address",
  "site.phone": "Phone",
  "site.email": "Email",
  "site.hours": "Office hours",
  "site.admission.contact": "Contact the college",
  "site.loading": "Loading…",
  "site.loadFailed": "Could not load this page. Check your connection and try again.",
  "site.retry": "Try again",
  "site.notReadyTitle": "This page isn't ready yet",
  "site.notReadyBody": "Please check back soon.",
```

- [ ] **Step 6: Model and client**

Create `apps/web/src/site/model.ts`:

```ts
import type { components } from "@/api/schema";

/** The words of the fixed public pages, as the API sends them (`GET /api/site/pages`). */
export type SiteContent = NonNullable<components["schemas"]["SitePages"]["site"]>;
export type Programme = SiteContent["programmes"][number];

/** The programmes under each section's name, in the section's order. One whose section is unknown goes last, with no heading. */
export function groupProgrammes(sections: { key: string; name: string }[], programmes: Programme[]): { name: string | null; items: Programme[] }[] {
  const groups = sections.map((s) => ({ name: s.name as string | null, items: programmes.filter((p) => p.section === s.key) })).filter((g) => g.items.length > 0);
  const known = new Set(sections.map((s) => s.key));
  const rest = programmes.filter((p) => !known.has(p.section));
  return rest.length > 0 ? [...groups, { name: null, items: rest }] : groups;
}
```

Create `apps/web/src/site/client.ts`:

```ts
import type { ApiClient } from "@/api/client";

import type { SiteContent } from "./model";

export type SiteResult = { ok: true; site: SiteContent | null } | { ok: false };

/** The words of the fixed public pages. No sign-in. `site` is null before the school has them. Never throws: a dropped connection is `ok: false`. */
export async function loadSite(api: ApiClient): Promise<SiteResult> {
  try {
    const { data } = await api.GET("/api/site/pages");
    return data ? { ok: true, site: data.site } : { ok: false };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 7: The frame**

Create `apps/web/src/site/SiteFrame.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { createApiClient } from "@/api/client";
import { usePageTitle } from "@/config/page-title";
import { t } from "@/i18n/messages";
import { Button, Notice, Skeleton } from "@/ui";

import { loadSite } from "./client";
import type { SiteContent } from "./model";
import styles from "./site.module.css";

export type SiteView = { status: "loading" } | { status: "ready"; site: SiteContent } | { status: "notReady" } | { status: "failed" };

/** Loads the fixed pages' words after the page opens, and can load them again. */
export function useSite(): { view: SiteView; retry: () => void } {
  const [api] = useState(() => createApiClient());
  const [view, setView] = useState<SiteView>({ status: "loading" });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const result = await loadSite(api);
    if (mine !== latest.current) return;
    setView(!result.ok ? { status: "failed" } : result.site ? { status: "ready", site: result.site } : { status: "notReady" });
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  function retry() {
    setView({ status: "loading" });
    void load();
  }
  return { view, retry };
}

/**
 * The heading of a public page and what stands in for its words while they load, fail or do not exist yet.
 * Drawn from a `view` so every state can be checked without a network.
 */
export function SiteFrameView({ title, view, onRetry, children }: { title: string; view: SiteView; onRetry: () => void; children: (site: SiteContent) => ReactNode }) {
  return (
    <>
      <h1 className={styles.pageTitle}>{title}</h1>

      {view.status === "loading" ? (
        <div role="status" aria-busy="true" className={styles.stack}>
          <span className="sr-only">{t("site.loading")}</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className={styles.item} aria-hidden>
              <Skeleton width="40%" height="1.25rem" />
              <Skeleton />
              <Skeleton width="70%" />
            </div>
          ))}
        </div>
      ) : null}

      {view.status === "failed" ? (
        <Notice tone="bad">
          <p>{t("site.loadFailed")}</p>
          <Button variant="secondary" onClick={onRetry}>
            {t("site.retry")}
          </Button>
        </Notice>
      ) : null}

      {view.status === "notReady" ? <Notice title={t("site.notReadyTitle")}>{t("site.notReadyBody")}</Notice> : null}

      {view.status === "ready" ? children(view.site) : null}
    </>
  );
}

/** A public page: its heading and tab title, and its words once they arrive. */
export function SiteFrame({ title, children }: { title: string; children: (site: SiteContent) => ReactNode }) {
  usePageTitle(title);
  const { view, retry } = useSite();
  return (
    <SiteFrameView title={title} view={view} onRetry={retry}>
      {children}
    </SiteFrameView>
  );
}
```

- [ ] **Step 8: The five views**

Create `apps/web/src/site/ProgrammesView.tsx`:

```tsx
import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import { groupProgrammes, type SiteContent } from "./model";
import styles from "./site.module.css";

/** The programmes, each a card with an anchor (`/programmes#bbs`), grouped under their section. */
export function ProgrammesView({ site, sections }: { site: SiteContent; sections: { key: string; name: string }[] }) {
  return (
    <div className={styles.stack}>
      {groupProgrammes(sections, site.programmes).map((group) => (
        <section key={group.name ?? "other"} className={styles.group}>
          {group.name ? <h2 className={styles.groupTitle}>{group.name}</h2> : null}
          {group.items.map((programme) => (
            <Card key={programme.key} id={programme.key} className={styles.anchor}>
              <h3 className={styles.itemTitle}>{programme.name}</h3>
              <p>{programme.summary}</p>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>{t("site.affiliation")}</dt>
                  <dd>{programme.affiliation}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>{t("site.duration")}</dt>
                  <dd>{programme.duration}</dd>
                </div>
                {programme.options.length > 0 ? (
                  <div className={styles.fact}>
                    <dt>{t("site.options")}</dt>
                    <dd>{programme.options.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
```

Create `apps/web/src/site/AdmissionView.tsx`:

```tsx
import Link from "next/link";

import { t } from "@/i18n/messages";
import { buttonClass } from "@/ui";

import type { SiteContent } from "./model";
import styles from "./site.module.css";

/** The admission steps in order, and the one thing to do next: get in touch. */
export function AdmissionView({ site }: { site: SiteContent }) {
  return (
    <div className={styles.stack}>
      <p className={styles.intro}>{site.admission.intro}</p>
      <ol className={styles.steps}>
        {site.admission.steps.map((step, index) => (
          <li key={index} className={styles.step}>
            <span className={styles.stepNumber}>{t("site.step", { number: index + 1 })}</span>
            <h2 className={styles.itemTitle}>{step.title}</h2>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <div>
        <Link href="/contact" className={buttonClass()}>
          {t("site.admission.contact")}
        </Link>
      </div>
    </div>
  );
}
```

Create `apps/web/src/site/ScholarshipsView.tsx`:

```tsx
import type { SiteContent } from "./model";
import styles from "./site.module.css";

export function ScholarshipsView({ site }: { site: SiteContent }) {
  return (
    <div className={styles.stack}>
      <p className={styles.intro}>{site.scholarships.intro}</p>
      <ul className={styles.list}>
        {site.scholarships.items.map((item, index) => (
          <li key={index} className={styles.item}>
            <h2 className={styles.itemTitle}>{item.title}</h2>
            <p>{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `apps/web/src/site/FacilitiesView.tsx`:

```tsx
import type { SiteContent } from "./model";
import styles from "./site.module.css";

export function FacilitiesView({ site }: { site: SiteContent }) {
  return (
    <div className={styles.stack}>
      <p className={styles.intro}>{site.facilities.intro}</p>
      <ul className={styles.facilityList}>
        {site.facilities.items.map((item, index) => (
          <li key={index} className={styles.facility}>
            <span className={styles.facilityName}>{item.name}</span>
            {item.body ? <span className={styles.muted}>{item.body}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `apps/web/src/site/ContactView.tsx`:

```tsx
import { contactHref } from "@/content/model";
import { t } from "@/i18n/messages";
import { Card } from "@/ui";

import type { SiteContent } from "./model";
import styles from "./site.module.css";

/** A phone number or email as a link only when it is one (`contactHref` builds `tel:` and `mailto:` from checked characters). */
function Reach({ value }: { value: string }) {
  const href = contactHref(value);
  return href ? (
    <a href={href} className={styles.contactLink}>
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );
}

export function ContactView({ site }: { site: SiteContent }) {
  const { address, phones, email, hours } = site.contact;
  return (
    <Card>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{t("site.address")}</dt>
          <dd>{address}</dd>
        </div>
        <div className={styles.fact}>
          <dt>{t("site.phone")}</dt>
          <dd>
            <ul className={styles.plain}>
              {phones.map((phone) => (
                <li key={phone}>
                  <Reach value={phone} />
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {email ? (
          <div className={styles.fact}>
            <dt>{t("site.email")}</dt>
            <dd>
              <Reach value={email} />
            </dd>
          </div>
        ) : null}
        {hours ? (
          <div className={styles.fact}>
            <dt>{t("site.hours")}</dt>
            <dd>{hours}</dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}
```

- [ ] **Step 9: The styles**

Create `apps/web/src/site/site.module.css` (tokens only; nothing here writes a colour, font or motion):

```css
/* The fixed public pages. Tokens only: no colour, font or motion is written out here. */

.pageTitle {
  font-size: var(--text-2xl);
  overflow-wrap: anywhere;
}

.intro {
  max-width: 40rem;
  color: var(--color-text-muted);
  font-size: var(--text-lg);
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.groupTitle {
  font-size: var(--text-xl);
}

.itemTitle {
  font-size: var(--text-lg);
  overflow-wrap: anywhere;
}

/* A programme card can be linked to from Home and elsewhere. */
.anchor {
  scroll-margin-top: var(--space-5);
}

.muted {
  color: var(--color-text-muted);
}

/* Label and value pairs: stacked on a phone, side by side from a wider screen. */
.facts {
  display: grid;
  gap: var(--space-3);
  margin: 0;
}

.fact {
  display: grid;
  gap: var(--space-1);
}

.fact dt {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.fact dd {
  margin: 0;
  overflow-wrap: anywhere;
}

@media (min-width: 40rem) {
  .fact {
    grid-template-columns: 10rem minmax(0, 1fr);
    gap: var(--space-4);
  }

  .fact dt {
    font-size: var(--text-base);
  }
}

.steps,
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.step,
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: min(var(--space-5), 5vw);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.stepNumber {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.facilityList {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.facility {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.facilityName {
  font-weight: var(--weight-medium);
}

.plain {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A phone number or email is a link, so it gets a full 44px target. */
.contactLink {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  color: var(--color-primary);
}
```

Check that every token used is defined: from `apps/web`, run
`grep -o "var(--[a-z0-9-]*" src/site/site.module.css | sort -u | sed 's/var(//' | while read t; do grep -rq -- "$t:" src/app/tokens.css src/theme || echo "missing $t"; done`
Expected: no output. If `--text-xl` (or another) is reported missing, use the nearest defined size (`--text-lg`) and note it.

- [ ] **Step 10: The routes**

Create `apps/web/src/app/programmes/page.tsx`:

```tsx
"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { ProgrammesView } from "@/site/ProgrammesView";
import { SiteFrame } from "@/site/SiteFrame";

function Programmes() {
  const { config } = useConfig();
  return <SiteFrame title={t("site.programmes.title")}>{(site) => <ProgrammesView site={site} sections={config?.sections ?? []} />}</SiteFrame>;
}

/** The programmes the school offers: open to everyone, no sign-in. */
export default function ProgrammesPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <Programmes />
      </ConfigGate>
    </PublicShell>
  );
}
```

Create `apps/web/src/app/admission/page.tsx`:

```tsx
"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { AdmissionView } from "@/site/AdmissionView";
import { SiteFrame } from "@/site/SiteFrame";

/** How to apply: open to everyone, no sign-in. */
export default function AdmissionPage() {
  return (
    <PublicShell>
      <ConfigGate>
        <SiteFrame title={t("site.admission.title")}>{(site) => <AdmissionView site={site} />}</SiteFrame>
      </ConfigGate>
    </PublicShell>
  );
}
```

Create `apps/web/src/app/scholarships/page.tsx` the same way, with `ScholarshipsView`, `site.scholarships.title` and the function name `ScholarshipsPage`. Create `apps/web/src/app/facilities/page.tsx` with `FacilitiesView`, `site.facilities.title`, `FacilitiesPage`. Create `apps/web/src/app/contact/page.tsx` with `ContactView`, `site.contact.title`, `ContactPage`.

- [ ] **Step 11: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run test/site-model.test.ts test/site-client.test.ts test/site-pages.test.tsx test/guards.test.ts test/site-links.test.ts test/site-strings.test.ts`
Expected: PASS. If the guard "no sentence is written directly between JSX tags" flags a view, move the words to the catalog.

- [ ] **Step 12: Break it on purpose**

In `ContactView.tsx`, replace `<Reach value={phone} />` with `<a href={`tel:${phone}`}>{phone}</a>` and add a phone `"x"` to a test pack: the `tel:` test must fail on the exact link. Also in `ProgrammesView.tsx` remove `id={programme.key}`: the anchor test must fail. Restore both.

- [ ] **Step 13: Typecheck, lint, commit**

```bash
cd apps/web && npm run typecheck && npm run lint
```

Expected: PASS. Then:

```bash
git add apps/web
git commit -m "Slice 3c: the frame and the five inner public pages" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: The Home page, admissions first (slice 3c)

**Files:**
- Create: `apps/web/src/site/HomeView.tsx`, `apps/web/src/site/Reach.tsx`, `apps/web/src/site/useUrgentNotices.ts`, `apps/web/test/site-home.test.tsx`
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/site/ContactView.tsx`, `apps/web/src/site/site.module.css`, `apps/web/src/i18n/messages.ts`, `apps/api/src/modules/site/strings.ts`, `apps/web/test/site-strings.test.ts`, `apps/web/test/render.test.tsx`, `apps/web/test/content-screens.test.tsx`, `apps/web/test/guards.test.ts`
- Delete: `apps/web/src/app/home.module.css`

**Interfaces:**
- Consumes: `useSite`, `SiteFrameView`, `SiteView` (Task 4); `SiteContent`, `groupProgrammes` (Task 4); `loadPublic` from `@/content/client` (its items have `id`, `title`, `urgent`); the styles from Task 4.
- Produces: `Reach({ value })` in `site/Reach.tsx` (a `tel:` / `mailto:` link when the value is one, otherwise text); `HomeView({ site, sections, urgent })` where `urgent: { id: string; title: string }[]`; `HomeFrameView({ schoolName, sections, view, urgent, onRetry })`; `useUrgentNotices(): { id: string; title: string }[]`.
- Home has exactly one prominent button: **How to apply**.

- [ ] **Step 1: Write the failing Home tests**

Create `apps/web/test/site-home.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HomeFrameView, HomeView } from "@/site/HomeView";
import { parsePack } from "../../api/src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe.each([
  { label: "Royal Softech", json: royalJson },
  { label: "Sample Basic School", json: sampleJson },
])("$label's home page", ({ json }) => {
  const pack = parsePack(json);
  const site = pack.site;
  const html = renderToStaticMarkup(<HomeView site={site} sections={pack.sections} urgent={[]} />);

  it("leads with the school's headline as its one heading, and its summary", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toContain(`>${esc(site.home.headline)}</h1>`);
    expect(html).toContain(esc(site.home.summary));
  });

  it("has exactly one prominent button, How to apply, and a quiet way to the notices", () => {
    expect(count(html, /class="button primary/g)).toBe(1);
    expect(html).toMatch(/<a[^>]*class="button primary[^"]*"[^>]*href="\/admission"[^>]*>How to apply<\/a>|<a[^>]*href="\/admission"[^>]*class="button primary[^"]*"[^>]*>How to apply<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/notices"[^>]*>Notices and updates<\/a>/);
  });

  it("does not offer Sign in here: that belongs to the header and footer", () => {
    expect(html).not.toContain("/sign-in");
  });

  it("lists every programme under its section, each linking to its card on the Programmes page", () => {
    for (const p of site.programmes) expect(html).toContain(`href="/programmes#${p.key}"`);
    for (const s of pack.sections) expect(html).toContain(`>${esc(s.name)}</h3>`);
  });

  it("shows the admission steps in brief, and the address and first phone", () => {
    for (const step of site.admission.steps) expect(html).toContain(`<li>${esc(step.title)}</li>`);
    expect(html).toContain(esc(site.contact.address));
    const phone = site.contact.phones[0]!;
    expect(html).toContain(`href="tel:${phone.startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}"`);
  });

  it("links on to the full pages", () => {
    for (const href of ["/programmes", "/admission", "/contact"]) expect(html, href).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*class="button quiet|<a[^>]*class="button quiet[^"]*"[^>]*href="${href}"`));
  });

  it("carries no colour of its own", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});

describe("the urgent strip", () => {
  const pack = parsePack(royalJson);

  it("is left out when nothing is urgent", () => {
    const html = renderToStaticMarkup(<HomeView site={pack.site} sections={pack.sections} urgent={[]} />);
    expect(html).not.toContain("Urgent");
  });

  it("names each urgent notice as a link to the notice board, politely announced", () => {
    const html = renderToStaticMarkup(<HomeView site={pack.site} sections={pack.sections} urgent={[{ id: "a", title: "School closed tomorrow" }, { id: "b", title: "Exam <b>moved</b>" }]} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Urgent");
    expect(html).toMatch(/<a[^>]*href="\/notices"[^>]*>School closed tomorrow<\/a>/);
    expect(html).not.toContain("<b>moved");
    expect(count(html, /class="button primary/g)).toBe(1);
  });
});

describe("the home page before its words are ready", () => {
  const pack = parsePack(royalJson);
  const frame = (view: Parameters<typeof HomeFrameView>[0]["view"]) =>
    renderToStaticMarkup(<HomeFrameView schoolName="Royal Softech College" sections={pack.sections} view={view} urgent={[]} onRetry={() => {}} />);

  it("keeps the school's name as the heading while loading, failed or not set up, and shows the shape of the page", () => {
    for (const view of [{ status: "loading" }, { status: "failed" }, { status: "notReady" }] as const) {
      const html = frame(view);
      expect(count(html, /<h1/g), view.status).toBe(1);
      expect(html).toContain(">Royal Softech College</h1>");
    }
    expect(frame({ status: "loading" })).toContain('aria-busy="true"');
  });

  it("has no prominent button until there is something to apply to", () => {
    for (const view of [{ status: "loading" }, { status: "failed" }, { status: "notReady" }] as const) expect(count(frame(view), /class="button primary/g)).toBe(0);
  });

  it("shows the words once ready", () => {
    expect(frame({ status: "ready", site: pack.site })).toContain(esc(pack.site.home.headline));
  });
});
```

In `apps/web/test/render.test.tsx`:
1. Add imports near the other imports: `import { HomeView } from "@/site/HomeView";` and `import { parsePack } from "../../api/src/core/config";`
2. Replace the whole test `it("the home page also has exactly one prominent button", () => { ... });` (it renders `<Home />`) with:

```tsx
  it("the home page also has exactly one prominent button", () => {
    const pack = parsePack(royal);
    const home = page(<HomeView site={pack.site} sections={pack.sections} urgent={[]} />, royal, signedOut);
    expect(home.match(/class="button primary/g)).toHaveLength(1);
  });
```

3. If `Home` (`import Home from "@/app/page"`) is no longer used in that file, remove the import. It stays used only if another test still renders it.

In `apps/web/test/content-screens.test.tsx`:
1. Add imports: `import { HomeView } from "@/site/HomeView";` and `import { parsePack } from "../../api/src/core/config";` and `import royalJson from "../../../packs/royal-softech/pack.json";` (skip any that are already imported).
2. Replace the whole test `it("the home page links to it as a secondary action, leaving Sign in the one prominent button", () => { ... });` with:

```tsx
  it("the home page links to it as a quiet action, leaving How to apply the one prominent button", () => {
    const pack = parsePack(royalJson);
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <SessionContext.Provider value={fakeSession()}>
          <HomeView site={pack.site} sections={pack.sections} urgent={[]} />
        </SessionContext.Provider>
      </ConfigContext.Provider>,
    );
    expect(html).toMatch(/<a[^>]*href="\/notices"[^>]*>Notices and updates<\/a>/);
    expect(count(html, /class="[^"]*\bprimary\b[^"]*"/g)).toBe(1);
  });
```

3. If `Home` is no longer used in that file, remove `import Home from "@/app/page";`.

In `apps/web/test/site-strings.test.ts`, in the list in "covers what a crawler needs to read", replace `"home.welcome"` with `"home.notices"`.

In `apps/web/test/guards.test.ts`, inside "the notice board's filter buttons and a vacancy's contact link are full-size targets too", add:

```ts
    expect(css("site/site.module.css")).toMatch(/\.programmeLink\s*\{[^}]*min-height:\s*var\(--control-height\)/);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/site-home.test.tsx test/render.test.tsx test/content-screens.test.tsx test/guards.test.ts`
Expected: FAIL (`@/site/HomeView` does not exist).

- [ ] **Step 3: Retire the placeholder words, add the Home words**

Check where the old words are used: `grep -rn "home.welcome\|home.intro" apps/web/src apps/api/src`. Expected: `messages.ts`, `strings.ts`, and `app/page.tsx` only (which Step 6 rewrites).

In `apps/web/src/i18n/messages.ts`: delete the `"home.welcome"` and `"home.intro"` lines and their comment `// Public home (a placeholder until the public website in Phase 2)`. Add after `"site.notReadyBody"`:

```ts
  "site.home.apply": "How to apply",
  "site.home.seeProgrammes": "See every programme",
  "site.home.seeAdmission": "Read the full admission process",
  "site.home.seeContact": "See all contact details",
```

In `apps/api/src/modules/site/strings.ts`, delete the `"home.welcome"` line from `STRINGS`.

- [ ] **Step 4: Extract `Reach` and add the hook**

Create `apps/web/src/site/Reach.tsx`:

```tsx
import { contactHref } from "@/content/model";

import styles from "./site.module.css";

/** A phone number or email as a link only when it is one (`contactHref` builds `tel:` and `mailto:` from checked characters). */
export function Reach({ value }: { value: string }) {
  const href = contactHref(value);
  return href ? (
    <a href={href} className={styles.contactLink}>
      {value}
    </a>
  ) : (
    <span>{value}</span>
  );
}
```

In `apps/web/src/site/ContactView.tsx`, delete the local `Reach` function and the `contactHref` import, and add `import { Reach } from "./Reach";`.

Create `apps/web/src/site/useUrgentNotices.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

import { createApiClient } from "@/api/client";
import { loadPublic } from "@/content/client";

/** The titles of up to three urgent notices live today, for the strip on Home. A failure shows nothing: the strip is a bonus. */
export function useUrgentNotices(): { id: string; title: string }[] {
  const [api] = useState(() => createApiClient());
  const [urgent, setUrgent] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    let alive = true;
    void loadPublic(api).then((result) => {
      if (alive && result.ok) setUrgent(result.items.filter((item) => item.urgent).slice(0, 3).map(({ id, title }) => ({ id, title })));
    });
    return () => {
      alive = false;
    };
  }, [api]);

  return urgent;
}
```

- [ ] **Step 5: The Home view**

Create `apps/web/src/site/HomeView.tsx`:

```tsx
import Link from "next/link";

import { t } from "@/i18n/messages";
import { Card, Notice, buttonClass } from "@/ui";

import { groupProgrammes, type SiteContent } from "./model";
import { Reach } from "./Reach";
import { SiteFrameView, type SiteView } from "./SiteFrame";
import styles from "./site.module.css";

/**
 * The home page: admissions first. The headline and summary, one prominent way to apply, any urgent notice,
 * the programmes by section, the admission steps in brief, and how to get in touch. Sign in is not here: it
 * lives in the header and footer, so this page has one main action (D-030).
 */
export function HomeView({ site, sections, urgent }: { site: SiteContent; sections: { key: string; name: string }[]; urgent: { id: string; title: string }[] }) {
  return (
    <div className={styles.home}>
      <Card className={styles.hero}>
        <h1 className={styles.heroTitle}>{site.home.headline}</h1>
        <p className={styles.heroIntro}>{site.home.summary}</p>
        <div className={styles.actions}>
          <Link href="/admission" className={buttonClass()}>
            {t("site.home.apply")}
          </Link>
          <Link href="/notices" className={buttonClass({ variant: "quiet" })}>
            {t("home.notices")}
          </Link>
        </div>
      </Card>

      {urgent.length > 0 ? (
        <Notice title={t("content.urgent")}>
          <ul className={styles.plain}>
            {urgent.map((item) => (
              <li key={item.id}>
                <Link href="/notices" className={styles.contactLink}>
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <section className={styles.block}>
        <h2 className={styles.groupTitle}>{t("site.programmes.title")}</h2>
        {groupProgrammes(sections, site.programmes).map((group) => (
          <div key={group.name ?? "other"} className={styles.group}>
            {group.name ? <h3 className={styles.itemTitle}>{group.name}</h3> : null}
            <ul className={styles.programmeList}>
              {group.items.map((programme) => (
                <li key={programme.key}>
                  <Link href={`/programmes#${programme.key}`} className={styles.programmeLink}>
                    <span className={styles.programmeName}>{programme.name}</span>
                    <span className={styles.muted}>{`${programme.affiliation}, ${programme.duration}`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <Link href="/programmes" className={buttonClass({ variant: "quiet" })}>
            {t("site.home.seeProgrammes")}
          </Link>
        </div>
      </section>

      <section className={styles.block}>
        <h2 className={styles.groupTitle}>{t("site.home.apply")}</h2>
        <ol className={styles.briefSteps}>
          {site.admission.steps.map((step, index) => (
            <li key={index}>{step.title}</li>
          ))}
        </ol>
        <div>
          <Link href="/admission" className={buttonClass({ variant: "quiet" })}>
            {t("site.home.seeAdmission")}
          </Link>
        </div>
      </section>

      <section className={styles.block}>
        <h2 className={styles.groupTitle}>{t("site.contact.title")}</h2>
        <p>{site.contact.address}</p>
        <p>
          <Reach value={site.contact.phones[0]!} />
        </p>
        <div>
          <Link href="/contact" className={buttonClass({ variant: "quiet" })}>
            {t("site.home.seeContact")}
          </Link>
        </div>
      </section>
    </div>
  );
}

/**
 * Home in each state of loading its words. Until they are ready (or when they cannot be), the school's own
 * name is the heading and the shape of the page or a plain message stands in.
 */
export function HomeFrameView({
  schoolName,
  sections,
  view,
  urgent,
  onRetry,
}: {
  schoolName: string;
  sections: { key: string; name: string }[];
  view: SiteView;
  urgent: { id: string; title: string }[];
  onRetry: () => void;
}) {
  if (view.status === "ready") return <HomeView site={view.site} sections={sections} urgent={urgent} />;
  return (
    <SiteFrameView title={schoolName} view={view} onRetry={onRetry}>
      {() => null}
    </SiteFrameView>
  );
}
```

Note on the guards: `{`${programme.affiliation}, ${programme.duration}`}` is an expression, not a sentence between tags.

- [ ] **Step 6: Rewrite the page and its styles**

Replace the whole of `apps/web/src/app/page.tsx` with:

```tsx
"use client";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { PublicShell } from "@/shell/PublicShell";
import { HomeFrameView } from "@/site/HomeView";
import { useSite } from "@/site/SiteFrame";
import { useUrgentNotices } from "@/site/useUrgentNotices";

function Home() {
  const { config } = useConfig();
  const { view, retry } = useSite();
  const urgent = useUrgentNotices();
  if (!config) return null;
  return <HomeFrameView schoolName={config.school.name} sections={config.sections} view={view} urgent={urgent} onRetry={retry} />;
}

/** The school's front page: admissions first, from the words in its pack. Open to everyone. */
export default function HomePage() {
  return (
    <PublicShell>
      <ConfigGate>
        <Home />
      </ConfigGate>
    </PublicShell>
  );
}
```

Delete `apps/web/src/app/home.module.css` (`git rm apps/web/src/app/home.module.css`), then append to `apps/web/src/site/site.module.css`:

```css

/* Home */
.home {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.hero {
  gap: var(--space-5);
  padding: min(var(--space-6), 7.5vw) min(var(--space-5), 7.5vw);
}

.heroTitle {
  font-size: var(--text-2xl);
  overflow-wrap: anywhere;
}

.heroIntro {
  max-width: 40rem;
  color: var(--color-text-muted);
  font-size: var(--text-lg);
}

@media (min-width: 48rem) {
  .hero {
    padding: var(--space-8) var(--space-7);
  }

  .heroTitle {
    font-size: var(--text-3xl);
  }
}

/* The actions wrap on a narrow screen or with enlarged text. */
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
}

.programmeList {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
  gap: var(--space-3);
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The whole card is the link, so it is a full-size target. */
.programmeLink {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-1);
  min-height: var(--control-height);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  color: var(--color-text);
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: transform var(--motion-fast) var(--motion-ease);
}

.programmeLink:active {
  transform: scale(0.98);
}

.programmeName {
  color: var(--color-primary);
  font-weight: var(--weight-medium);
}

.briefSteps {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding-inline-start: var(--space-5);
}
```

Re-run the token check from Task 4 Step 9 for `site.module.css`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run`
Expected: the whole web suite PASSES (guards, render, content screens, strings). If `render.test.tsx` fails only on an unused `Home` import, remove it.

Run: `cd apps/api && npx vitest run test/site-render.test.ts test/crawler-files.test.ts`
Expected: PASS (nothing in the Worker used `home.welcome` any more).

- [ ] **Step 8: Break it on purpose**

Add a second `buttonClass()` link (a primary "Sign in" to `/sign-in`) inside the hero in `HomeView.tsx`. The "exactly one prominent button" test and the "does not offer Sign in here" test must fail. Restore it.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
cd apps/web && npm run typecheck && npm run lint
cd ../api && npm run typecheck && npm run lint
```

Expected: PASS.

```bash
git add apps
git commit -m "Slice 3c: the Home page, admissions first" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: The public header, Menu and footer (slice 3c)

**Files:**
- Create: `apps/web/src/shell/PublicHeader.tsx`, `apps/web/test/public-header.test.tsx`
- Modify: `apps/web/src/shell/PublicShell.tsx`, `apps/web/src/shell/site-links.ts`, `apps/web/src/shell/shell.module.css`, `apps/web/src/i18n/messages.ts`, `apps/web/test/site-links.test.ts`, `apps/web/test/guards.test.ts`

**Interfaces:**
- Consumes: `SITE_LINKS` (Task 3); `useConfig`, `useSession`; `buttonClass`, `Skeleton` from `@/ui`.
- Produces: `isHere(pathname: string | null, href: string): boolean` in `site-links.ts`; `PublicHeaderView({ brand, signedIn, showSignIn, pathname, open, panelId, buttonRef, onToggle, onNavigate })` (pure, testable); `PublicHeader({ showSignIn })` (holds the open state); `PublicShell` keeps its props (`children`, `showSignIn`) and now draws the header and a footer with the page links.
- Header structure (source order = visual order): a top row with the school name (link home), a Menu button (visible below 48 rem only) and Sign in or Dashboard; then `<nav aria-label="Site pages">` with the six links. Below 48 rem the nav is hidden until Menu is pressed. From 48 rem it is always shown, inline.

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/site-links.test.ts`, add `isHere` to the import (`import { SITE_LINKS, isHere } from "@/shell/site-links";`) and add:

```ts
describe("isHere", () => {
  it("is true on the page itself, with or without a trailing slash", () => {
    expect(isHere("/programmes", "/programmes")).toBe(true);
    expect(isHere("/programmes/", "/programmes")).toBe(true);
  });

  it("is false on every other page, on Home, and before the address is known", () => {
    expect(isHere("/admission", "/programmes")).toBe(false);
    expect(isHere("/", "/programmes")).toBe(false);
    expect(isHere("/programmes-old", "/programmes")).toBe(false);
    expect(isHere(null, "/programmes")).toBe(false);
  });
});
```

Create `apps/web/test/public-header.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext, type Me } from "@/session/SessionProvider";
import { PublicHeaderView } from "@/shell/PublicHeader";
import { PublicShell } from "@/shell/PublicShell";
import { fakeSession } from "./session";
import royalJson from "../../../packs/royal-softech/pack.json";

const here = vi.hoisted(() => ({ path: "/programmes" }));
vi.mock("next/navigation", () => ({ usePathname: () => here.path, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: "Royal Softech College", shortName: "Royal Softech", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: royalJson.sections,
  modules: {},
  terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Admin", "term.terminal": "Terminal", "term.programme": "Programme", "term.level": "Level", "term.section": "Section" },
  theme: royalJson.theme as PublicConfig["theme"],
};
const me: Me = { name: "Sita Sharma", roles: [{ role: "coordinator", scope: "institution" }] };

function shell(path: string, options: { signedIn?: boolean; showSignIn?: boolean } = {}) {
  here.path = path;
  return renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={options.signedIn ? fakeSession({ status: "signedIn", me }) : fakeSession()}>
        <PublicShell showSignIn={options.showSignIn}>
          <h1>x</h1>
        </PublicShell>
      </SessionContext.Provider>
    </ConfigContext.Provider>,
  );
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const header = (html: string) => /<header[\s\S]*?<\/header>/.exec(html)![0];
const footer = (html: string) => /<footer[\s\S]*?<\/footer>/.exec(html)![0];
const LABELS = ["Programmes", "Admission", "Scholarships", "Facilities", "Contact", "Notices and updates"];
const HREFS = ["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"];

describe("the public header", () => {
  const html = header(shell("/programmes"));

  it("links to every public page, in reading order, in a labelled navigation", () => {
    expect(html).toMatch(/<nav[^>]*aria-label="Site pages"/);
    const links = [...html.matchAll(/<a[^>]*class="siteLink"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(links).toEqual(LABELS);
    const hrefs = [...html.matchAll(/<a[^>]*class="siteLink"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="siteLink"/g)].map((m) => m[1] ?? m[2]);
    expect(hrefs).toEqual(HREFS);
  });

  it("marks the current page, and only that one", () => {
    expect(count(html, /aria-current="page"/g)).toBe(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Programmes<\/a>/);
    expect(count(header(shell("/")), /aria-current="page"/g)).toBe(0);
    expect(header(shell("/notices/"))).toMatch(/<a[^>]*aria-current="page"[^>]*>Notices and updates<\/a>/);
  });

  it("puts the school's name, then Menu, then Sign in, then the page links, so what is read is what is tabbed to", () => {
    const at = (text: string) => html.indexOf(text);
    expect(at("Royal Softech")).toBeGreaterThan(-1);
    expect(at("Royal Softech")).toBeLessThan(at(">Menu<"));
    expect(at(">Menu<")).toBeLessThan(at(">Sign in<"));
    expect(at(">Sign in<")).toBeLessThan(at('aria-label="Site pages"'));
  });

  it("has no prominent button: Menu and Sign in are quiet", () => {
    expect(count(html, /class="button primary/g)).toBe(0);
    expect(html).toMatch(/<a[^>]*class="button quiet"[^>]*href="\/sign-in"|<a[^>]*href="\/sign-in"[^>]*class="button quiet"/);
  });

  it("offers the dashboard instead of Sign in to someone signed in, and no Sign in where the form is already on the page", () => {
    expect(header(shell("/programmes", { signedIn: true }))).toContain('href="/portal"');
    expect(header(shell("/sign-in", { showSignIn: false }))).not.toContain('href="/sign-in"');
  });
});

describe("the Menu button and its list", () => {
  const props = { brand: "Royal Softech", signedIn: false, showSignIn: true, pathname: "/programmes", panelId: "site-pages", buttonRef: { current: null }, onToggle: () => {}, onNavigate: () => {} };

  it("starts closed: the button says so and points at the list, which is marked closed", () => {
    const html = renderToStaticMarkup(<PublicHeaderView {...props} open={false} />);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="site-pages"|<button[^>]*aria-controls="site-pages"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/<nav[^>]*id="site-pages"[^>]*data-open="false"|<nav[^>]*data-open="false"[^>]*id="site-pages"/);
  });

  it("when open, says so on both", () => {
    const html = renderToStaticMarkup(<PublicHeaderView {...props} open />);
    expect(html).toMatch(/<button[^>]*aria-expanded="true"/);
    expect(html).toMatch(/<nav[^>]*data-open="true"/);
  });

  it("is a real button, not a link, with the word Menu", () => {
    const html = renderToStaticMarkup(<PublicHeaderView {...props} open={false} />);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Menu<\/button>/);
  });
});

describe("the footer", () => {
  it("repeats the page links in its own labelled navigation, so they are reachable without the Menu, and names the school", () => {
    const html = footer(shell("/programmes"));
    expect(html).toMatch(/<nav[^>]*aria-label="Footer"/);
    expect([...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(HREFS);
    for (const label of LABELS) expect(html).toContain(`>${label}</a>`);
    expect(html).toContain("Royal Softech College");
  });

  it("does not offer Sign in (the header does)", () => {
    expect(footer(shell("/programmes"))).not.toContain("/sign-in");
  });
});

describe("the whole shell", () => {
  it("keeps the skip link first, one main landmark and two labelled navigations", () => {
    const html = shell("/programmes");
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<header"));
    expect(count(html, /<main id="main"/g)).toBe(1);
    expect(count(html, /<nav/g)).toBe(2);
  });

  it("carries no colour of its own", () => {
    const html = shell("/programmes");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:\s*(?!var\()/);
  });
});
```

In `apps/web/test/guards.test.ts`, inside "the brand link, menu entries and buttons are at least a full control tall (44px)", add:

```ts
    expect(css("shell/shell.module.css")).toMatch(/\.siteLink\s*\{[^}]*min-height:\s*var\(--control-height\)/);
    expect(css("shell/shell.module.css")).toMatch(/\.footerLink\s*\{[^}]*min-height:\s*var\(--control-height\)/);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/site-links.test.ts test/public-header.test.tsx test/guards.test.ts`
Expected: FAIL (`isHere` and `PublicHeaderView` do not exist; no footer navigation).

- [ ] **Step 3: Add the words and `isHere`**

In `apps/web/src/i18n/messages.ts` add after the `site.home.*` keys:

```ts
  "site.menu": "Menu",
  "site.navLabel": "Site pages",
  "site.footerNavLabel": "Footer",
```

Append to `apps/web/src/shell/site-links.ts`:

```ts

/** True on a link's own page. A trailing slash makes no difference; before the address is known nothing is current. */
export function isHere(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return path === href;
}
```

- [ ] **Step 4: The header**

Create `apps/web/src/shell/PublicHeader.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Skeleton, buttonClass } from "@/ui";

import { SITE_LINKS, isHere } from "./site-links";
import styles from "./shell.module.css";

/**
 * The public header, drawn from its state so every case can be checked without a browser. It has two rows,
 * so what is read first is also what is tabbed to first: the school's name, Menu (a phone only) and Sign in;
 * then the page links. Below 48 rem the links are hidden until Menu is pressed; from 48 rem they are always
 * shown. Sign in is quiet on purpose, so a page's own main action stays the only prominent button.
 */
export function PublicHeaderView({
  brand,
  signedIn,
  showSignIn,
  pathname,
  open,
  panelId,
  buttonRef,
  onToggle,
  onNavigate,
}: {
  brand: ReactNode;
  signedIn: boolean;
  showSignIn: boolean;
  pathname: string | null;
  open: boolean;
  panelId: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link href="/" className={styles.brand}>
          {brand}
        </Link>
        <div className={styles.actions}>
          <span className={styles.menuSlot}>
            <button type="button" ref={buttonRef} className={buttonClass({ variant: "quiet" })} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
              {t("site.menu")}
            </button>
          </span>
          {signedIn ? (
            <Link href="/portal" className={buttonClass({ variant: "secondary" })}>
              {t("nav.dashboard")}
            </Link>
          ) : showSignIn ? (
            <Link href="/sign-in" className={buttonClass({ variant: "quiet" })}>
              {t("shell.signIn")}
            </Link>
          ) : null}
        </div>
      </div>
      <nav id={panelId} aria-label={t("site.navLabel")} className={styles.siteNav} data-open={open}>
        <ul className={styles.siteLinks}>
          {SITE_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={styles.siteLink} aria-current={isHere(pathname, link.href) ? "page" : undefined} onClick={onNavigate}>
                {t(link.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * Holds whether the Menu is open. It is open only on the page it was opened on, so choosing a link (or any
 * change of page) closes it without an effect. Escape closes it and returns focus to the button.
 */
export function PublicHeader({ showSignIn }: { showSignIn: boolean }) {
  const { config } = useConfig();
  const { status } = useSession();
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [openAt, setOpenAt] = useState<string | null>(null);
  const page = pathname ?? "";
  const open = openAt === page;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenAt(null);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <PublicHeaderView
      brand={config?.school.shortName ?? <Skeleton width="7rem" />}
      signedIn={status === "signedIn"}
      showSignIn={showSignIn}
      pathname={pathname}
      open={open}
      panelId={panelId}
      buttonRef={buttonRef}
      onToggle={() => setOpenAt(open ? null : page)}
      onNavigate={() => setOpenAt(null)}
    />
  );
}
```

- [ ] **Step 5: The shell and its styles**

In `apps/web/src/shell/PublicShell.tsx`: replace the `<header>...</header>` block with `<PublicHeader showSignIn={showSignIn} />` and the `<footer>` line with:

```tsx
      <footer className={styles.footer}>
        <nav aria-label={t("site.footerNavLabel")}>
          <ul className={styles.footerLinks}>
            {SITE_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={styles.footerLink}>
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {school ? <p>{t("shell.footer", { school: school.name })}</p> : null}
      </footer>
```

Update the imports: add `import { PublicHeader } from "./PublicHeader";` and `import { SITE_LINKS } from "./site-links";`, keep `Link`, and remove the imports that are no longer used (`useSession`, `Skeleton`, `buttonClass`). `school` is still `config?.school`, so keep `useConfig`. Update the component's doc comment to say the header and footer link to the public pages.

Append to `apps/web/src/shell/shell.module.css`:

```css

/* The public header's second row: the page links. Below 48rem they are hidden until Menu is pressed
   (the footer repeats them, so they are reachable without it). From 48rem they are always shown. */
.menuSlot {
  display: inline-flex;
}

.siteNav {
  display: none;
  border-top: 1px solid var(--color-border);
}

.siteNav[data-open="true"] {
  display: block;
}

.siteLinks {
  display: flex;
  flex-direction: column;
  max-width: var(--content-width);
  margin: 0 auto;
  padding: var(--space-2) var(--page-gutter);
  list-style: none;
}

.siteLink {
  display: flex;
  align-items: center;
  min-height: var(--control-height);
  color: var(--color-text);
  font-weight: var(--weight-medium);
  text-decoration: none;
}

.siteLink[aria-current="page"] {
  color: var(--color-primary);
  font-weight: var(--weight-bold);
}

.footerLinks {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-1) var(--space-3);
  margin: 0 0 var(--space-3);
  padding: 0;
  list-style: none;
}

.footerLink {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  color: var(--color-text);
}

@media (min-width: 48rem) {
  .menuSlot {
    display: none;
  }

  .siteNav {
    display: block;
  }

  .siteLinks {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding-block: 0;
  }

  .siteLink {
    padding: 0 var(--space-3);
    border-radius: var(--radius-control);
  }

  .siteLink[aria-current="page"] {
    box-shadow: inset 0 -3px 0 var(--color-primary);
  }
}
```

Run the token check from Task 4 Step 9 against `src/shell/shell.module.css`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run`
Expected: the whole web suite PASSES. If `render.test.tsx` fails on a header expectation, keep the intent (quiet Sign in for a visitor, Dashboard when signed in, no Sign in on the sign-in page) and adjust only the markup it matches.

- [ ] **Step 7: Build, then check the Menu in the browser**

The web app has no DOM test library, so the keyboard behaviour is checked here, by hand, and reported.

1. Stop any running `next dev` or `wrangler dev`, then: `cd apps/web && npm run build`. Expected: succeeds, and `apps/web/out` contains `programmes.html` (or `programmes/index.html`), `admission`, `scholarships`, `facilities` and `contact`.
2. Set up the local database and start both servers: `cd apps/api && npm run provision -- --pack ../../packs/royal-softech --local`, then `preview_start` with `name: "worker"` and again with `name: "web-dev"`. If `wrangler dev` complains about missing variables, follow `README.md` (`.dev.vars`).
3. Open `http://localhost:3000/programmes` in the preview browser. With `resize_window` set `preset: "mobile"`, reload, then:
   - `read_page` the header: the Menu button has `aria-expanded="false"`, and no page link is visible.
   - Click Menu. Expected: `aria-expanded="true"` and the six links stack, each at least 44 px tall (`javascript_tool`: `[...document.querySelectorAll('nav a')].map(a => a.getBoundingClientRect().height)`).
   - Press Escape. Expected: the list closes and `document.activeElement.textContent === 'Menu'`.
   - Click Menu, then click Admission. Expected: the page changes and the list is closed on the new page.
   - Set `document.documentElement.style.fontSize = '200%'` and, at width 320 (`resize_window` `width: 320, height: 640`), check `document.documentElement.scrollWidth <= window.innerWidth` on Home, Programmes and Contact (no sideways scroll).
4. `resize_window` with `preset: "desktop"`: the Menu button is gone and the six links sit in a row under the school's name; the current page is underlined.
5. Reset the size with `preset: "desktop"` when done. Take one mobile screenshot with the list open and one desktop screenshot for the report. Read `read_console_messages` with `onlyErrors: true`: expect none.

If any check fails, fix the code (not the check), re-run Step 6, and repeat.

- [ ] **Step 8: Break it on purpose**

In `PublicHeader.tsx` change `open = openAt === page` to `open = openAt !== null`. The unit tests still pass (they take `open` as a prop), so repeat Step 7's "click Admission, the list is closed on the new page" check: it must fail. Restore it. This is the check that the state logic is right, because it cannot be tested without a DOM.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
cd apps/web && npm run typecheck && npm run lint
```

Expected: PASS.

```bash
git add apps/web
git commit -m "Slice 3c: the public header with a Menu on phones, and a footer with the page links" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Reviews, decisions, a clean-clone replay and staging (slice 3d)

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/build-plan.md`, `CLAUDE.md`, `README.md` (only if it lists public routes), the memory file `C:\Users\kumar\.claude\projects\C--Users-kumar-OneDrive-Desktop-School-Website\memory\project-school-platform-status.md`; fixes from the reviews wherever they land.

**Interfaces:**
- Consumes: everything from Tasks 1 to 6.
- Produces: `D-050`, `D-051`, `D-052` in `DECISIONS.md`; the final report the PM reads.

- [ ] **Step 1: Run every check locally**

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
node ../../scripts/check-no-bom.mjs && node ../../scripts/check-boundaries.mjs
npm run gen:permissions && git diff --exit-code ../../docs/permission-matrix.md
npm run gen:openapi && git diff --exit-code openapi.json
cd ../web && npm run gen:api && git diff --exit-code src/api/schema.d.ts
npm run typecheck && npm run lint && npm test
```

Expected: all pass, no diffs. Fix anything that fails before going on.

- [ ] **Step 2: The `apple-design` review**

Check the skill is installed: `ls .claude/skills/apple-design`. If it is missing, stop and tell the PM (it is installed per developer and git-ignored; see `CLAUDE.md` section 7); do not continue UI work without it.

Load the skill. Read its always-load pages (accessibility, layout, typography, colour) and the pages for what is on screen (navigation and menus, buttons, lists, and a read-only page). Read a page before citing it.

With both dev servers running (Task 6 Step 7) look at every page in the preview browser, at 320 px with text at 200% (`document.documentElement.style.fontSize = '200%'`), at a phone width, and at desktop width, in light and dark (`resize_window` with `colorScheme`). Check and note:
- one prominent button per view (Home: How to apply; Admission: Contact the college; the others none);
- every control and link at least 44 px, visible keyboard focus (Tab through Home and the Menu);
- no sideways scroll and no mid-word breaks at 320 px and 200%;
- hierarchy: one h1 per page, headings in order, calm spacing, nothing decorative;
- contrast of the brand-coloured links in both modes (the theme check already enforces 4.5:1; confirm on screen);
- reduced motion: the only motion is the small press scale on programme cards (`transform`).

Fix what is wrong in the code (with a test where a test can catch it), and re-run Step 1. Keep a list: what was checked, which pages were used (`file.md › Heading`), what was fixed, what was left and why. It goes in D-052 and the final report.

- [ ] **Step 3: Write the decisions**

Read the end of `docs/DECISIONS.md` and insert the new entries after D-049 and before the "Open items carried forward" heading (line starts `## Open items carried forward`).

```markdown
**D-050 The fixed public pages' words live in the pack (Phase 2, slice 3).** 2026-09-21, designed with the PM in chat and written up in `docs/superpowers/specs/2026-09-21-public-pages-design.md`. Home, Programmes, Admission, Scholarships, Facilities and Contact get their words from a required `site` block in `pack.json` (rule 2, D-008). `npm run provision` stores it as one row (`site_content`, migration 0008) and it is read two ways: by the Worker's crawler copy (D-046) and by the web pages through `GET /api/site/pages`, which uses the anonymous `site.view` action like `GET /api/site/content`. The Admin still edits only the five content types (D-039); changing these words is a change to the pack. Both packs carry the block and the sample school shares no wording with Royal (a test checks). Only the five page titles are shared between the Worker and the web catalog (a test keeps them equal, so the tab title the app sets is the one the Worker wrote); the other crawler labels are crawler-only. A page with no site row is served as the plain static page.
- **`OPEN:`** Royal's block is unconfirmed third-party text (`docs/client-profile.md`, from directory listings): the nine programmes, the admission steps, the scholarship policy (including "up to 50% for Dalit students"), thirteen facilities and four phone numbers. The college must confirm it before the site is made indexable.
- **`OPEN:`** the site row is replaced whole when its text changes, unlike sections, which stay. This touches the open question of whether applying a pack should remove what it no longer lists (D-026).
- **`OPEN:`** a programme's options (for example +2 Science's Biology, Mathematics and Computer Science, and the BSc specialisations) are shown as text only. Nothing is modelled; the elective-group question stays open.
- Fees, results, permissions and the audit log are not touched. The permission matrix does not change.

**D-051 Home leads with admissions; a two-row public header with a Menu (Phase 2, slice 3).** 2026-09-21, the PM chose "admissions first" for Home. Home shows the headline, the summary and one prominent button, **How to apply**; then any urgent notice, the programmes by section, the admission steps in brief and the contact. Sign in moved out of Home to the header, where it is quiet (one prominent button per view, D-030); the footer does not repeat it. The header has two rows so the source order is the visual order: the school's name, Menu (below 48 rem) and Sign in, then the page links. Below 48 rem the links are hidden until Menu is pressed; the footer repeats them, so they are reachable without JavaScript. The open state belongs to the page it was opened on, so any change of page closes it; Escape closes it and returns focus to the button. The placeholder words `home.welcome` and `home.intro` are gone.
- The web app has no DOM test library, and adding one needs a reason and the PM's approval. The Menu's markup is unit-tested; its keyboard behaviour (Escape, focus return, closing on navigation) was checked in the browser preview, and the steps are in the plan (`docs/superpowers/plans/2026-09-21-public-pages.md`, Task 6).
- A page costs the Worker two database round trips (the configuration batch, then one read for the words).

**D-052 Slice 3 reviews.** 2026-09-21. Write here, from what was actually done: the `ui-ux-pro-max` searches that shaped the design; the `apple-design` review (what was checked, the guideline pages used as `file.md › Heading`, what was fixed, what was left and why); and each `geo-*` skill's findings on the deployed staging pages, with what was applied and what waits. Staging sends `noindex` and `Disallow: /` by design (D-049), so the crawler-access findings for staging are expected; production settings are covered by tests.
```

Fill in D-052 only when Steps 2 and 8 are done; do not leave it half written.

- [ ] **Step 4: Update the plan documents and the memory**

1. `docs/build-plan.md`: in the status line near the top change `slices 0, 1, 2 and 4 built, slice 3 next` to `slices 0 to 4 built, slice 5 next`; in "Phase 2 progress" add a bullet `- **Slice 3:** the fixed public pages: Home (admissions first), Programmes, Admission, Scholarships, Facilities and Contact, with their words in the pack, a two-row header with a Menu, and the Worker's crawler copy (D-050, D-051, D-052).` and change the "Not started" bullet to slice 5 only; replace the paragraph headed "Start slice 3 here (next session)" with a short "Start slice 5 here (next session)" paragraph: design and GEO pass across the public site, page-weight budgets, the staging exit check, the client's confirmation of the content, and the `OPEN:` items above.
2. `CLAUDE.md`: in the "Current phase" line replace `slices 0, 1, 2 and 4 are built; slice 3 (the fixed public pages) is next, then slice 5.` with `slices 0 to 4 are built (D-038 to D-052); slice 5 (design and GEO pass, page-weight budgets, staging exit check) is next.`
3. `README.md`: run `grep -n "site/content\|/notices" README.md docs/architecture.md`. If either lists public routes, add `/programmes`, `/admission`, `/scholarships`, `/facilities`, `/contact` and `GET /api/site/pages`; if not, leave them.
4. Memory: read `project-school-platform-status.md`, then update it (do not add a new file) with: slice 3 built on branch `slice-3-public-pages` (date), the provision-then-deploy order for staging, that the Royal site block is unconfirmed, and where the plan and spec are. Keep its index line in `MEMORY.md` accurate.

- [ ] **Step 5: Replay the CI in a clean clone**

Local files hid two CI bugs before (`CLAUDE.md` section 3), so replay the workflow in a fresh clone of the branch, which has only tracked files. Use the scratchpad directory, not `/tmp`, and run it with a long timeout (up to 10 minutes):

```bash
R="C:/Users/kumar/AppData/Local/Temp/claude/C--Users-kumar-OneDrive-Desktop-School-Website/82412da6-3436-498f-a3c7-73a577532a72/scratchpad/clean-clone"
rm -rf "$R" && git clone --branch slice-3-public-pages "C:/Users/kumar/OneDrive/Desktop/School Website" "$R"
cd "$R/apps/api" && npm ci && node ../../scripts/check-no-bom.mjs && node ../../scripts/check-boundaries.mjs && npm run typecheck && npm run lint && npm test && npm run gen:permissions && git diff --exit-code ../../docs/permission-matrix.md && npm run gen:openapi && git diff --exit-code openapi.json
cd "$R/apps/web" && npm ci && npm run gen:api && git diff --exit-code src/api/schema.d.ts && npm run typecheck && npm run lint && npm test && npm run build
```

Expected: every step passes. The clone has no `wrangler.local.jsonc`, no `.next`, no `.dev.vars`: a failure here that did not show locally is exactly the kind of bug this catches. Fix it in the working tree, commit, and repeat. Commit the docs from Step 4 first so the clone includes them.

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md README.md apps
git commit -m "Slice 3d: decisions D-050 to D-052, plan and status documents, review fixes" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Ask the PM before anything leaves this machine**

Stop and ask the PM, in one message, for a yes on each: (a) push `slice-3-public-pages` to GitHub and let CI run (the repo's practice is commits on `main`; say which they want); (b) provision staging with the new site words. Do not push or touch staging until they answer.

On (b) yes, in `apps/api` (this applies the additive migration and the pack; run it before the deploy, which is safe with the old code because the new table is only read by the new code):

```bash
npm run provision -- --pack ../../packs/royal-softech --remote --config wrangler.local.jsonc
```

If wrangler is not logged in, give the PM this exact command to run in their own PowerShell instead. Then ask the PM to deploy from their own PowerShell:

```bash
cd apps\api
npx wrangler deploy --config wrangler.local.jsonc
```

Deploy order matters: provision first, then deploy. A deploy before the migration would make the six pages read a table that is not there yet.

- [ ] **Step 8: Verify staging, then run the GEO skills**

After the PM says it is deployed, on `https://school-platform-staging.k-rishav0301.workers.dev`:
1. `curl -s` each of `/`, `/programmes`, `/admission`, `/scholarships`, `/facilities`, `/contact`: the HTML has the page's own `<title>`, one canonical link, `application/ld+json` blocks, and the words in a `#server-copy` block. `curl -sI` shows `X-Robots-Tag: noindex, nofollow`. `/sitemap.xml` and `/llms.txt` list all seven public pages; `/robots.txt` says `Disallow: /`.
2. Open each page in the preview browser: content appears, the Menu works on a phone width, `read_console_messages` with `onlyErrors: true` shows none.
3. Run the `geo-schema`, `geo-technical`, `geo-crawlers`, `geo-llmstxt`, `geo-content` and `geo-citability` skills on the staging pages (not `geo-update`, and none of the agency skills). Staging is deliberately not indexable, so treat crawler-access findings as expected and judge the rest. Apply the fixes that are ours to make (titles, descriptions, structured-data types, wording of the summary lines) with tests, commit them, and repeat Step 5 for the changed files. List what waits on the client's confirmation of the content.
4. Write D-052 from the real results and commit it.

- [ ] **Step 9: The final report**

End with, in this order: (1) at the top: fees, results, permissions and the audit log are not touched, and the permission matrix did not change; (2) what changed; (3) what was tested (counts of API and web tests, the break-it-on-purpose checks, the clean-clone replay, the browser check of the Menu, staging); (4) the design review and the GEO findings; (5) what is not done; (6) every `OPEN:` item touched: the unconfirmed content, the whole-row replace, and the DOM test library; (7) suggestions that are not in the documents.


---

## Deviations found while executing (2026-09-21)

Where the plan above and the code differ, the code is right. What changed and why:

1. **Web tests never import API runtime code.** The plan's Tasks 4 to 6 tests used `parsePack` from `apps/api/src/core/config`. That pulls Cloudflare-only types (`D1Database`, `HTMLRewriter`) into the web typecheck, which then failed. The tests read the pack JSON through `apps/web/test/site-fixture.ts` (`siteFrom`, which fills in the one default the API fills in), and `site-links.test.ts` reads the `PAGES` source the way `scripts/check-boundaries.mjs` does. Pack validation stays tested in the API.
2. **A colour check that matched a link.** `#bed-it` in a Home programme link looked like a hex colour. The Home test ignores `href` values.
3. **Menu state.** The plan's "break it on purpose" for the Menu assumed the state was lost only because it is keyed to the page. Each page renders its own shell, so a change of page remounts the header either way. The behaviour that needs the handler is choosing the current page's own link, and that is what was checked in the browser (and broken on purpose there).
4. **Long button labels at 320 px with 200% text** widened the page (buttons are `nowrap`), and so did the header's Menu and Dashboard row. Found by measuring against the real viewport (an earlier check compared the page with itself and passed wrongly). Fixed with `a.wrapLabel` on the public pages' button links and `flex-wrap` on the header actions, with tests.
5. **Home's programme grid** was squeezed into one narrow column at desktop width, because the section lines its children up at the start. Fixed with `width: 100%` on `.group`, with a test.
6. **Spacing.** The design search asked for at least 8 px between touch targets, so the stacked Menu links, the inline links and the footer rows use `--space-2` (the plan had 4 px in places). The footer links use `prefetch={false}`, because they repeat the header's.
7. **Local production build.** `npm run build` cannot replace `apps/web/out` while another session's `wrangler dev` holds it open (Windows). The clean-clone replay runs the build in a fresh folder, and the browser checks used `next dev`.
