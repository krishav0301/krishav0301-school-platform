# The scroll public site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lahan Manakamana a one-page scrolling public site (photo hero, school and batches, notice board with a reader, admission form without an email field, about), chosen by its pack, with the portal and every other school unchanged.

**Architecture:** A new public layout `scroll` selected by `site.layout` in the pack. The pack's `site` block (stored as one JSON row, served by `GET /api/site/pages`) gains the scroll words; the web home page renders `ScrollHome` when the layout is `scroll`. Admission for such a school skips email verification (a `school` flag, like `student_keeps_pin`), so the backend fills the email and the application enters the queue as `pending_review`. Motion is CSS plus `IntersectionObserver`, with Lenis for smooth scrolling, all off under reduced motion.

**Tech Stack:** Cloudflare Worker (Hono, zod-openapi, D1, hand-written SQL migrations), Next.js 16 static export, React 19, CSS modules on theme tokens, vitest, Lenis.

**Spec:** `docs/superpowers/specs/2026-10-13-scroll-public-site-design.md` (read it first). Source data: `docs/lahan-manakamana-profile.md`.

## Global Constraints

- **Local only until the PM says deploy** (spec section 11): no push, no merge, no `wrangler deploy`, no remote migration, no `provision --remote`. Commits go on a feature branch `scroll-public-site`, made with `git switch -c scroll-public-site` from `main`. Commit only because the PM asked for the plan to be executed; never push.
- One build serves every school. The core never names a school and never imports from `packs/`. Royal Softech and `sample-basic-school` must behave exactly as before (the second-school test).
- **No hardcoded colours or fonts** in any `.css`/`.tsx` (the web guard test fails the build). Overlays use `color-mix(in srgb, var(--color-text) N%, transparent)`. Fonts: `var(--font-body)` and the heading font from the theme (`headingFont: "source-serif"`).
- **All visible words go through `apps/web/src/i18n/messages.ts`** (`t("key")`); the Worker's crawler words go through `apps/api/src/modules/site/strings.ts` (`say("key")`). Words from the pack are data and may be shown directly.
- **Animate transform and opacity only.** Everything respects `prefers-reduced-motion: reduce`. Touch targets at least 44 px. One prominent button per view (D-030). Every screen works at 320 px wide with text at 200%.
- Money, results, permissions and the audit log are not touched. Admissions is: say so at the top of the final message with the tests that cover it.
- Migrations are hand-written SQL in `apps/api/migrations/`, backward compatible, next number **0039**. D1: one round trip per request where possible.
- Modules never reach into each other's tables: `site` reads notices through `listPublicContent` from `../content`.
- Pinned dependencies only (exact versions, at least two weeks old). Lenis is the only new one (approved by the PM).
- Photos: no download before the PM approves the list (spec 6.3). The crest is the school's own file, never regenerated.
- Append every decision to `docs/DECISIONS.md` (next numbers are **D-167** the scroll layout, **D-168** admission without email; check the last number first).
- Commands (from `README.md`): API `cd apps/api && npm run typecheck && npm run lint && npm test`; web `cd apps/web && npm run typecheck && npm run lint && npm test && npm run build`; root `node scripts/check-boundaries.mjs`; after a route or schema change `cd apps/api && npm run gen:openapi` then `cd apps/web && npm run gen:api`.

## Review Focus

Failure modes the spec implies but no obvious test covers; each has its test in the named task.
1. A visitor submits the form twice or the connection drops after the server saved it: same submission token gives the same application, no second row, no second limit count (Task 2).
2. Someone floods the no-email form with different names but one phone number, or one IP: the limit per phone and per IP stops it with "throttled", nothing written (Task 2).
3. A notice with a very long title, no body formatting, or a holiday with dates is opened in the reader: nothing overflows at 320 px, Escape closes, focus returns to the title that opened it (Task 8).
4. The visitor has JavaScript off, a slow connection, or reduced motion: the first photo, all text and the form still show; nothing is hidden waiting for a reveal (Task 6).
5. A deep link `/?notice=<id>` for a notice that has ended or never existed: the page opens normally with no dialog and no error (Task 8).
6. A classic school's pack with no `layout` still validates and renders as before, and a scroll pack with an unknown layout, a hero file name with a path in it, or a non-Facebook link is refused (Task 1).
7. No class is open for admission: the section shows the phone number, not a broken form (Task 9).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/core/config/site.ts` | `layout` and `scroll` block in `SiteContentSchema` |
| `apps/api/src/core/config/pack.ts`, `read.ts` | `school.publicApplyNeedsLink`, its SQL and its read |
| `apps/api/migrations/0039_public_apply_verifies_email.sql` | the new `school` column |
| `apps/api/src/modules/admissions/{schema,service}.ts` | optional email on the public form, no-email path |
| `apps/api/src/modules/site/{site-pages,pages,crawler-files,strings}.ts` | scroll `home` body, classic pages off for scroll, sitemap and `llms.txt` by layout |
| `packs/lahan-manakamana/pack.json` | layout, scroll words, theme, the no-email flag |
| `apps/web/src/site/scroll/*` | the page: `ScrollHome`, `TopBar`, `Hero`, `SchoolBand`, `PhotoStrip`, `Batches`, `NoticeBoard`, `NoticeReader`, `AdmissionBlock`, `AboutBlock`, `useReveal`, `useHeroCycle`, `SmoothScroll`, `scroll.module.css` |
| `apps/web/src/admissions/{ApplyScreen,ApplicantFields,model,client}.ts(x)` | apply without an email field |
| `apps/web/src/app/page.tsx`, `site/SiteFrame.tsx` | pick the layout; classic pages say "not available" for a scroll school |
| `apps/web/public/site/lahan/*.webp` | the photos (after PM approval) |

---

### Task 1: Pack schema, the flag, migration, Lahan's pack

**Files:**
- Modify: `apps/api/src/core/config/site.ts`, `apps/api/src/core/config/pack.ts`, `apps/api/src/core/config/read.ts`, `apps/api/src/modules/config/routes.ts` (public config schema: add the field beside `studentKeepsPin`)
- Create: `apps/api/migrations/0039_public_apply_verifies_email.sql`
- Modify: `packs/lahan-manakamana/pack.json`
- Test: `apps/api/test/scroll-pack.test.ts` (create), `apps/api/test/lahan-pack.test.ts` (extend)

**Interfaces:**
- Produces: `SiteContent` gains `layout: "classic" | "scroll"` (default `"classic"`) and `scroll?: ScrollContent`; `ScrollContent = { hero: { images: { file: string; alt: string }[]; tagline?: string }; intro: string; batches: { title: string; note?: string }[]; about: { story?: string; facebook?: string; mapQuery?: string } }`. `Pack.school.publicApplyNeedsLink: boolean` (default `true`). `PublicConfig.school.publicApplyNeedsLink: boolean`. DB column `school.public_apply_verifies_email INTEGER NOT NULL DEFAULT 1`.

- [ ] **Step 1: Create the branch**

```bash
git switch -c scroll-public-site
```

- [ ] **Step 2: Write the failing test** `apps/api/test/scroll-pack.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { InvalidPackError, parsePack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";

const scroll = {
  hero: { images: [{ file: "hero-1.webp", alt: "The school building" }] },
  intro: "A short intro.",
  batches: [{ title: "Kindergarten" }, { title: "Class 1 to 5", note: "to confirm" }],
  about: { story: "Our story.", facebook: "https://www.facebook.com/profile.php?id=100090093189751" },
};
const withSite = (patch: Record<string, unknown>) => ({ ...royalJson, site: { ...royalJson.site, ...patch } });

describe("the scroll layout in a pack", () => {
  it("a pack with no layout is a classic site, as before", () => {
    const pack = parsePack(royalJson);
    expect(pack.site.layout).toBe("classic");
    expect(pack.site.scroll).toBeUndefined();
    expect(pack.school.publicApplyNeedsLink).toBe(true);
  });

  it("accepts the scroll layout with its words", () => {
    const pack = parsePack(withSite({ layout: "scroll", scroll }));
    expect(pack.site.layout).toBe("scroll");
    expect(pack.site.scroll?.batches).toHaveLength(2);
  });

  it("refuses an unknown layout, and a scroll layout with no scroll words", () => {
    expect(() => parsePack(withSite({ layout: "carousel" }))).toThrow(InvalidPackError);
    expect(() => parsePack(withSite({ layout: "scroll" }))).toThrow(/site\.scroll/);
  });

  it("refuses a hero file that is a path, not a plain .webp name", () => {
    for (const file of ["../x.webp", "a/b.webp", "hero.png", "HERO.webp"]) {
      expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, hero: { images: [{ file, alt: "x" }] } } })), file).toThrow(InvalidPackError);
    }
  });

  it("refuses a link that is not on facebook.com, and duplicate batch titles", () => {
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, about: { facebook: "https://evil.example/facebook.com" } } }))).toThrow(InvalidPackError);
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, batches: [{ title: "A" }, { title: "A" }] } }))).toThrow(/batches/);
  });

  it("refuses scroll words on a classic site", () => {
    expect(() => parsePack(withSite({ scroll }))).toThrow(/site\.scroll/);
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `cd apps/api && npx vitest run test/scroll-pack.test.ts`
Expected: FAIL (`layout` is an unknown key / `publicApplyNeedsLink` undefined).

- [ ] **Step 4: Implement the schema** in `apps/api/src/core/config/site.ts`. Add before `SiteContentSchema`:

```ts
const HeroFile = z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}\.webp$/, "a plain lower-case .webp file name");
const FACEBOOK = /^https:\/\/(www\.)?facebook\.com\/[A-Za-z0-9._\-/?=&%]{1,200}$/;

export const ScrollContentSchema = z.strictObject({
  hero: z.strictObject({
    images: z.array(z.strictObject({ file: HeroFile, alt: Text(160) })).min(1).max(6),
    tagline: Text(160).optional(),
  }),
  intro: Text(900),
  batches: z.array(z.strictObject({ title: Text(80), note: Text(200).optional() })).min(1).max(20),
  about: z.strictObject({
    story: Text(1500).optional(),
    facebook: z.string().regex(FACEBOOK, "a facebook.com link").optional(),
    mapQuery: Text(200).optional(),
  }),
});
export type ScrollContent = z.infer<typeof ScrollContentSchema>;
```

and add to the `SiteContentSchema` object (first keys): `layout: z.enum(["classic", "scroll"]).default("classic"),` and `scroll: ScrollContentSchema.optional(),`. In `pack.ts` `parsePack`, after the programme-key checks add:

```ts
  if (pack.site.layout === "scroll" && !pack.site.scroll) problems.push("site.scroll: required when site.layout is scroll");
  if (pack.site.layout !== "scroll" && pack.site.scroll) problems.push("site.scroll: only a scroll layout may have scroll words");
  const batchTitles = pack.site.scroll?.batches.map((b) => b.title) ?? [];
  if (new Set(batchTitles).size !== batchTitles.length) problems.push("site.scroll.batches: titles must be unique");
```

In `PackSchema.school` add `publicApplyNeedsLink: z.boolean().default(true),` (doc comment: "Whether a public application must confirm an email link before it reaches the Co-ordinator (D-063). A school may turn it off (D-168): the backend then makes the email."). In `packOperations` extend the `school` INSERT and UPDATE with `public_apply_verifies_email` exactly as `student_keeps_pin` is (same pattern, `? 1 : 0`). In `read.ts` add `public_apply_verifies_email` to the SELECT, the row type and `school: { …, publicApplyNeedsLink: row.public_apply_verifies_email === 1 }`, and to `PublicConfig`. In `modules/config/routes.ts` add `publicApplyNeedsLink: z.boolean().optional()` beside `studentKeepsPin` and do the same wherever `studentKeepsPin` is handled in that file (`grep -n studentKeepsPin apps/api/src/modules/config/routes.ts`) only if it is part of the public config shape.

- [ ] **Step 5: The migration** `apps/api/migrations/0039_public_apply_verifies_email.sql`

```sql
-- D-168: a school may take public applications without an email link. On (1) unless its pack says otherwise.
ALTER TABLE school ADD COLUMN public_apply_verifies_email INTEGER NOT NULL DEFAULT 1 CHECK (public_apply_verifies_email IN (0, 1));
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && npx vitest run test/scroll-pack.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Lahan's pack.** In `packs/lahan-manakamana/pack.json` set `"school"` `"publicApplyNeedsLink": false`, and in `site` add `"layout": "scroll"` and the `scroll` block built only from `docs/lahan-manakamana-profile.md` (hero images file names `hero-1.webp` to `hero-4.webp`, to be created in Task 11; alt texts neutral; `intro`: "Lahan Manakamana English Boarding School in Lahan-8, Siraha. Notices, results and admission in one place." (draft, in `packs/README.md` marked unconfirmed); `batches`: Kindergarten, Class 1 to 3, Class 4 to 5, Class 6 to 8, Class 9 to 10 (SEE) each with note "To confirm with the school"; `about`: `facebook` the page link, `mapQuery` "Lahan-8, Road No - 2, Lahan, Siraha"). Keep the existing `site.contact` (address "Lahan-8, Road No - 2"; replace the phone "To be added" with "+977 33-564346"). Set the theme to the crest look:

```json
"theme": {
  "name": "Lahan crest",
  "font": "inter",
  "headingFont": "source-serif",
  "shape": { "radiusCard": 14, "radiusControl": 10 },
  "light": {
    "background": "#fbf7ef", "surface": "#ffffff", "text": "#2a1a14", "textMuted": "#5f5148",
    "border": "#dccfb8", "primary": "#7b1e2b", "primaryText": "#ffffff",
    "ok": "#146c2e", "okSoft": "#dcf5e3", "bad": "#b42318", "badSoft": "#fde4e1",
    "accent": "#8a6100", "accentSoft": "#f7ecc8", "warn": "#b54708", "warnSoft": "#fef0e1"
  }
}
```

- [ ] **Step 8: Extend `apps/api/test/lahan-pack.test.ts`** with:

```ts
  it("is a scroll site that takes applications without an email link, and no other school does", () => {
    expect(pack.site.layout).toBe("scroll");
    expect(pack.school.publicApplyNeedsLink).toBe(false);
    expect(parsePack(royalJson).school.publicApplyNeedsLink).toBe(true);
    expect(pack.site.scroll?.batches.length).toBeGreaterThan(0);
  });

  it("names only files that exist, and its theme passes the contrast check", () => {
    for (const image of pack.site.scroll!.hero.images) expect(existsSync(join(import.meta.dirname, "../../web/public/site/lahan", image.file)), image.file).toBe(true);
  });
```

(add `import { existsSync } from "node:fs"; import { join } from "node:path";`; the theme's contrast is already enforced by `parsePack`, so a failing theme throws at the top of the file. The file test fails until Task 11 adds the photos: mark it `it.todo`-free by running this step's file test after Task 11; until then run `-t` filters excluding it.)

- [ ] **Step 9: Run and commit**

Run: `cd apps/api && npx vitest run test/scroll-pack.test.ts test/lahan-pack.test.ts -t "^(?!.*files that exist)" ; npm run typecheck && npm run lint`
Expected: PASS (the file-existence test is run in Task 11).

```bash
git add apps/api packs
git commit -m "Pack: scroll layout, the no-email application flag, Lahan's words and crest theme"
```

---

### Task 2: Admission without an email (API)

**Files:**
- Modify: `apps/api/src/modules/admissions/schema.ts`, `apps/api/src/modules/admissions/service.ts`
- Test: `apps/api/test/admissions-no-email.test.ts` (create; reuse the helpers and the `beforeAll` fixture from `apps/api/test/admissions.test.ts` by copying its setup block)

**Interfaces:**
- Consumes: `school.public_apply_verifies_email` (Task 1), `suggestEmail(db, firstName, lastName)` and `queueEmail` (existing).
- Produces: `POST /api/admissions/apply` accepts a body with no `email` when the flag is off (answer 201 `{ id }`), the application row has `status = 'pending_review'` and a generated `@student.com` email, no `admission_verify` outbox row. With the flag on and no email: 422 "Give an email address".

- [ ] **Step 1: Write the failing tests** `apps/api/test/admissions-no-email.test.ts`. Copy the imports and the whole `beforeAll` (live year, programme, level, class) from `admissions.test.ts`, then:

```ts
const body = (over: Record<string, unknown> = {}) => ({
  firstName: "Anita", lastName: uniq("Yadav"), dob: "2012-05-14", phone: `98${Math.floor(10000000 + Math.random() * 89999999)}`,
  guardianName: "Ram Yadav", guardianPhone: "9801234567", levelId, submissionToken: token(), ...over,
});
const apply = (b: Record<string, unknown>, ip = "1.1.1.1") => call("/api/admissions/apply", { method: "POST", body: b, headers: { "CF-Connecting-IP": ip } });
const setFlag = (on: boolean) => db.prepare("UPDATE school SET public_apply_verifies_email = ? WHERE id = 1").bind(on ? 1 : 0).run();
const row = (publicId: string) => db.prepare("SELECT status, email, email_verified_at FROM applications WHERE public_id = ?").bind(publicId).first<{ status: string; email: string; email_verified_at: string | null }>();

describe("a school that takes applications without an email link (D-168)", () => {
  beforeAll(() => setFlag(false));
  afterAll(() => setFlag(true));

  it("stores a no-email application as pending_review with a made-up email, and queues no email", async () => {
    const before = await count("outbox", "template = 'admission_verify'").catch(() => 0);
    const res = await apply(body({ firstName: "Anita", lastName: "Solo" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await row(id)).toMatchObject({ status: "pending_review", email: "anita.solo@student.com", email_verified_at: null });
    expect(await count("outbox", "template = 'admission_verify'").catch(() => 0)).toBe(before);
  });

  it("gives a second applicant with the same name a numbered email", async () => {
    await apply(body({ firstName: "Anita", lastName: "Twin" }));
    const res = await apply(body({ firstName: "Anita", lastName: "Twin" }));
    const { id } = (await res.json()) as { id: string };
    expect((await row(id))!.email).toBe("anita.twin_1@student.com");
  });

  it("a retried submission token is the same application, with no new row", async () => {
    const b = body();
    const first = (await (await apply(b)).json()) as { id: string };
    const second = (await (await apply(b)).json()) as { id: string };
    expect(second.id).toBe(first.id);
    expect(await count("applications", `public_id = '${first.id}'`)).toBe(1);
  });

  it("limits one phone number to three applications in the window, and writes nothing for the fourth", async () => {
    const phone = "9811111111";
    for (let i = 0; i < 3; i++) expect((await apply(body({ phone }), `2.2.2.${i}`)).status).toBe(201);
    const blocked = await apply(body({ phone }), "2.2.2.9");
    expect(blocked.status).toBe(429);
  });

  it("limits one address to the same ceiling across different phones", async () => {
    let last = 201;
    for (let i = 0; i < 12; i++) last = (await apply(body(), "3.3.3.3")).status;
    expect(last).toBe(429);
  });

  it("still ignores a filled trap field, and a typed email, if given, is kept and checked", async () => {
    const trapped = await apply(body({ website: "http://spam.example" }));
    expect(trapped.status).toBe(201);
    const bad = await apply(body({ email: "not-an-email" }));
    expect(bad.status).toBe(422);
  });
});

describe("a school that verifies email (the default)", () => {
  it("still needs an email and still waits for the link", async () => {
    const missing = await apply(body());
    expect(missing.status).toBe(422);
    const ok = await apply(body({ email: `${uniq("p")}@example.com` }));
    expect(ok.status).toBe(201);
    const { id } = (await ok.json()) as { id: string };
    expect((await row(id))!.status).toBe("email_unverified");
  });
});
```

(`count(table, where)` and `call(path, { method, body, headers })` are the helpers in `academics-helpers.ts`; if `call` has no `headers` option, add one there, a one-line change, and check `count`'s signature with `grep -n "export async function count\|export const count" apps/api/test/academics-helpers.ts`. The outbox table name: `grep -rn "CREATE TABLE.*outbox" apps/api/migrations`; use its real name.)

- [ ] **Step 2: Run and see them fail**

Run: `cd apps/api && npx vitest run test/admissions-no-email.test.ts`
Expected: FAIL (email required, 422 on every no-email case).

- [ ] **Step 3: Implement.** In `schema.ts` make the public form's email optional while keeping the staff schemas untouched:

```ts
export const ApplySchema = ApplicantDetailsSchema.extend({
  /** Left out by a school that takes applications without an email link (D-168); then the backend makes one. */
  email: Email.optional(),
  submissionToken: z.string().trim().regex(/^[A-Za-z0-9_-]{16,100}$/, "That is not a valid submission token"),
  website: z.string().optional(),
}).openapi("ApplyInput");
```

In `service.ts` `applyForAdmission`, replace the line `const email = p.email.trim().toLowerCase();` and the rest down to the final batch with this flow (keep everything not shown):

```ts
  const verifies = ((await db.prepare("SELECT public_apply_verifies_email AS v FROM school WHERE id = 1").first<{ v: number }>())?.v ?? 1) === 1;
  if (verifies && !p.email) return { ok: false, reason: "invalid", message: "Give an email address" };
  const email = (p.email ? p.email.trim() : await suggestEmail(db, p.firstName, p.lastName)).toLowerCase();
  // With no email to count against, a no-email school limits by phone number instead (an invented email is unique every time).
  const limitKey = verifies || p.email ? email : `phone:${p.phone.replace(/\D/g, "")}`;
```

Use `limitKey` in the `application_submission_events` SELECT and INSERT (in place of `email`). Then choose the status and token fields:

```ts
  const needsLink = verifies;
  const status = needsLink ? "email_unverified" : "pending_review";
  const tokenHash = needsLink ? await sha256Hex(token) : null;
  const expiresAt = needsLink ? new Date(now.getTime() + VERIFY_HOURS * 3_600_000).toISOString() : null;
```

Change the INSERT so `status` and the two verification columns are bound values (`?` placeholders) instead of the literal `'email_unverified'` and the computed ones, and build the batch as

```ts
  const statements = [eventInsert, applicationInsert];
  if (needsLink) statements.push(await queueEmail(db, dataKey, { template: "admission_verify", to: email, data: { token }, dedupeKey: `admission-verify:${publicId}` }));
  await db.batch(statements);
```

Only generate `token = newRefreshToken()` when `needsLink`. Update the doc comment of `applyForAdmission` to name D-168.

- [ ] **Step 4: Run, typecheck, run the whole admissions suite**

Run: `cd apps/api && npx vitest run test/admissions-no-email.test.ts test/admissions.test.ts && npm run typecheck && npm run lint`
Expected: PASS everywhere (the existing flow is unchanged with the flag on).

- [ ] **Step 5: Regenerate the contract and commit**

```bash
cd apps/api && npm run gen:openapi && cd ../web && npm run gen:api
git add apps/api apps/web/src/api
git commit -m "Admissions: a school may take public applications without an email link (D-168)"
```

---

### Task 3: The Worker's crawler copy and lists follow the layout

**Files:**
- Modify: `apps/api/src/modules/site/{site-pages.ts,pages.ts,crawler-files.ts,strings.ts}`
- Test: `apps/api/test/scroll-crawler.test.ts` (create; model its setup on `apps/api/test/crawler-files.test.ts` and the existing site-pages tests: `grep -ln "FILLED_PAGES\|site-pages" apps/api/test`)

**Interfaces:**
- Consumes: `SiteContent.layout`, `SiteContent.scroll` (Task 1), `listPublicContent` (existing).
- Produces: `filledPagesFor(layout: "classic" | "scroll"): readonly string[]` in `pages.ts` (classic: all of `FILLED_PAGES`; scroll: `["/", "/notices"]`); `home` builder returns the scroll body when `site.layout === "scroll"`; `programmes`, `admission`, `scholarships`, `facilities`, `contact` return `null` for a scroll site; `buildSitemap/buildLlmsTxt` use `filledPagesFor(site?.layout ?? "classic")`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("a scroll site's front page tells crawlers the name, address, phone, intro, batches, notices and about", async () => {
  const parts = await home(ctxFor(lahanSite));          // ctxFor builds a PageContext with the pack's site and two live notices
  expect(parts!.bodyHtml).toContain("<h1>Lahan Manakamana");
  for (const batch of lahanSite.scroll.batches) expect(parts!.bodyHtml).toContain(batch.title);
  expect(parts!.bodyHtml).toContain("+977 33-564346");
  expect(parts!.bodyHtml).toContain("Notice title one");
  expect(parts!.bodyHtml).not.toMatch(/<script|onerror=/i);
});
it("escapes everything the pack says", async () => { /* a batch titled <img src=x onerror=1> comes out as &lt;img … */ });
it("the classic-only pages say nothing for a scroll site (the static page is served untouched)", async () => {
  for (const b of [programmes, admission, scholarships, facilities, contact]) expect(await b(ctxFor(lahanSite))).toBeNull();
});
it("the sitemap and llms.txt of a scroll site list only / and /notices; a classic site still lists all seven", async () => {
  expect(filledPagesFor("scroll")).toEqual(["/", "/notices"]);
  expect(filledPagesFor("classic")).toEqual(FILLED_PAGES);
  expect(sitemapFor({ layout: "scroll" })).not.toContain("/programmes");
});
```

Write `ctxFor`, `lahanSite` and `sitemapFor` in the test file from the real fixtures (`lahanJson.site`, a `PageContext` object with `db` from the test helpers, `school`, `sections: []`, `origin: "https://example.test"`, `path`, `site: async () => lahanSite`), and seed two notices with the same helper `content.test.ts` uses (`grep -n "createContent\|publishContent" apps/api/test/content.test.ts`).

- [ ] **Step 2: Run, see them fail.** `cd apps/api && npx vitest run test/scroll-crawler.test.ts` — FAIL (no scroll body, builders not null, `filledPagesFor` undefined).

- [ ] **Step 3: Implement.**
  - `strings.ts`: add keys `site.scroll.batches` ("Classes"), `site.scroll.about` ("About the school"), `site.scroll.admission` ("Admission"), `site.scroll.notices` ("Notices"), `site.scroll.facebook` ("Facebook page"), reusing `site.phone`.
  - `site-pages.ts`: at the top of each classic-only builder add `if (site.layout === "scroll") return null;` after the `if (!site) return null;` line; in `home`, branch: `if (site.layout === "scroll" && site.scroll) return scrollHome(ctx, site);` where

```ts
async function scrollHome(ctx: PageContext, site: SiteContent): Promise<PageParts> {
  const { items } = await listPublicContent(ctx.db, nepalMinute(new Date()));
  const s = site.scroll!;
  return {
    title: ctx.school.name,
    description: s.intro.slice(0, 160),
    structuredData: [{ "@context": LD, "@type": "WebSite", "@id": `${ctx.origin}/#website`, name: ctx.school.name, url: ctx.origin, publisher: { "@id": orgId(ctx.origin) } }],
    organisation: { ...orgDetails(site), description: s.intro, ...(s.about.facebook ? { sameAs: [s.about.facebook] } : {}) },
    bodyHtml:
      `<h1>${e(ctx.school.name)}</h1><p>${e(site.contact.address)}</p><p>${e(say("site.phone"))}: ${e(site.contact.phones[0]!)}</p><p>${e(s.intro)}</p>` +
      `<h2>${e(say("site.scroll.batches"))}</h2><ul>${s.batches.map((b) => `<li>${e(b.title)}${b.note ? ` (${e(b.note)})` : ""}</li>`).join("")}</ul>` +
      `<h2>${e(say("site.scroll.notices"))}</h2><ul>${items.map((i) => `<li>${e(i.title)}</li>`).join("")}</ul><p><a href="/notices">${e(say("notices.title"))}</a></p>` +
      (s.about.story ? `<h2>${e(say("site.scroll.about"))}</h2><p>${e(s.about.story)}</p>` : "") +
      (s.about.facebook ? `<p><a href="${e(s.about.facebook)}" rel="noopener">${e(say("site.scroll.facebook"))}</a></p>` : ""),
  };
}
```

(import `listPublicContent` from `../content` and `nepalMinute` from `../../core/dates`, as `pages.ts` already does.)
  - `pages.ts`: export `filledPagesFor`.
  - `crawler-files.ts`: where `FILLED_PAGES` is used (lines ~65 and ~76) replace with `filledPagesFor(site?.layout ?? "classic")`, taking `site` from the `loadConfigAndSite` call those functions already make (read the two functions first; pass `site` through).
  - `pagesWithoutSummary` stays over `FILLED_PAGES` (unchanged).

- [ ] **Step 4: Run all site tests.** `cd apps/api && npx vitest run test/scroll-crawler.test.ts test/crawler-files.test.ts && npm test -- site && npm run typecheck && npm run lint && cd .. && node scripts/check-boundaries.mjs` — PASS (`run_worker_first` still lists every address: unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "Worker: crawler copy, sitemap and llms.txt follow the scroll layout"
```

---

### Task 4: The application form without an email (web)

**Files:**
- Modify: `apps/web/src/admissions/{ApplyScreen.tsx,ApplicantFields.tsx,model.ts,client.ts}`, `apps/web/src/i18n/messages.ts`
- Test: `apps/web/test/admissions-no-email.test.tsx` (create; model on `apps/web/test/admissions-screens.test.tsx`)

**Interfaces:**
- Consumes: `PublicConfig.school.publicApplyNeedsLink` (Task 1, via `useConfig()`).
- Produces: `ApplyScreen({ embedded?: boolean })`: when `config.school.publicApplyNeedsLink === false` the email field is not drawn, `validateApplicant(values, { email: false })` skips it, `apply(...)` sends no `email`, and the done card says `admissions.apply.doneBodyNoEmail`. `embedded` drops the card's own `HeroBand`/h1 (the scroll page supplies its heading).

- [ ] **Step 1: Failing tests.**

```tsx
it("draws no email field when the school takes applications without one", () => {
  const html = renderToStaticMarkup(<ApplicantFields values={emptyApplicantForm()} errors={{}} levels={[level]} onChange={() => {}} fieldRefs={refs} showEmail={false} />);
  expect(html).not.toMatch(/type="email"/);
});
it("still draws it by default", () => { /* showEmail omitted: type="email" present */ });
it("validateApplicant with email:false never reports an email error, with true it does", () => {
  const v = { ...emptyApplicantForm(), firstName: "A", lastName: "B", dobBs: "2070-01-01", phone: "9801234567", guardianName: "G", guardianPhone: "9801234567", levelId: "x".repeat(32) };
  expect(validateApplicant(v, { email: false }).email).toBeUndefined();
  expect(validateApplicant(v).email).toBe("admissions.error.email");
});
it("applicantBody leaves email out when it is blank and not required", () => { /* body.email undefined */ });
```

- [ ] **Step 2: Run, see fail.** `cd apps/web && npx vitest run test/admissions-no-email.test.tsx` — FAIL.

- [ ] **Step 3: Implement.** `model.ts`: `export function validateApplicant(values: ApplicantForm, options: { email?: boolean } = {})` and guard the existing email check with `(options.email ?? true) &&`. `ApplicantFields`: new prop `showEmail?: boolean` (default `true`), wrap the existing `<Field … type="email" …/>` in `{showEmail !== false ? … : null}`. `client.ts` `applicantBody(values, dob)`: `email: values.email.trim() || undefined`. `ApplyScreen`: read `const { config } = useConfig(); const needsEmail = config?.school.publicApplyNeedsLink !== false;` pass `showEmail={needsEmail}` and `validateApplicant(values, { email: needsEmail })`; the intro key becomes `needsEmail ? "admissions.apply.intro" : "admissions.apply.introNoEmail"`; the done body `needsEmail ? doneBody : doneBodyNoEmail`; add the `embedded` prop that renders `<Card>` without the `HeroBand` block. Messages to add:

```ts
  "admissions.apply.introNoEmail": "Fill in the applicant's details. The school office will review the application and call you.",
  "admissions.apply.doneBodyNoEmail": "Thank you. The school office will review the application and call the number you gave.",
```

- [ ] **Step 4: Run, typecheck, full web admissions tests.** `cd apps/web && npx vitest run test/admissions-no-email.test.tsx test/admissions-screens.test.tsx && npm run typecheck && npm run lint` — PASS.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "Apply form: no email field for a school that takes applications without one (D-168)"`

---

### Task 5: Motion foundations (reveal, hero cycle, Lenis) and the page's tokens

**Files:**
- Create: `apps/web/src/site/scroll/{useReveal.ts,useHeroCycle.ts,SmoothScroll.tsx,motion.ts}`
- Modify: `apps/web/package.json` (+ lock), `apps/web/src/i18n/messages.ts`
- Test: `apps/web/test/scroll-motion.test.tsx` (create)

**Interfaces:**
- Produces: `prefersReducedMotion(): boolean` (`motion.ts`); `useReveal<T extends HTMLElement>(): React.RefObject<T | null>`, sets `data-revealed="true"` on the element when it enters the viewport and immediately when reduced motion is on or `IntersectionObserver` is missing; `useHeroCycle(count: number, intervalMs?: number): number` returns the index of the visible photo (always `0` under reduced motion or `count < 2`); `<SmoothScroll />` mounts Lenis once and does nothing under reduced motion.

- [ ] **Step 1: Add Lenis, pinned.**

```bash
cd apps/web && npm view lenis versions --json | tail -5      # pick a version published at least two weeks ago
npm install --save-exact lenis@<that version>
```

- [ ] **Step 2: Failing tests** `apps/web/test/scroll-motion.test.tsx` (jsdom is the web test environment; check `vitest.config` `environment`; if tests run in node, use `// @vitest-environment jsdom` at the top as other `*.test.tsx` that use `window` do):

```tsx
it("prefersReducedMotion follows the media query", () => {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  expect(prefersReducedMotion()).toBe(true);
});
it("useHeroCycle stays on the first photo under reduced motion and with one photo", () => { /* renderHook: 0 after advancing timers */ });
it("useHeroCycle advances and wraps otherwise", () => { /* fake timers: 0 → 1 → 2 → 0 for count 3 */ });
it("useReveal marks an element revealed at once when IntersectionObserver is missing", () => {
  // @ts-expect-error remove it
  delete window.IntersectionObserver;
  /* render <Probe/> using the ref; expect data-revealed="true" */
});
```

- [ ] **Step 3: Run, see fail.** `cd apps/web && npx vitest run test/scroll-motion.test.tsx` — FAIL (modules missing).

- [ ] **Step 4: Implement.**

```ts
// motion.ts
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
```

```ts
// useReveal.ts
"use client";
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion";

/** Marks the element revealed when it first scrolls into view. Without JavaScript the CSS shows it from the start (the hidden state needs the `js` class on <html>). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      el.dataset.revealed = "true";
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { (entry.target as HTMLElement).dataset.revealed = "true"; observer.unobserve(entry.target); }
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}
```

```ts
// useHeroCycle.ts
"use client";
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./motion";

export function useHeroCycle(count: number, intervalMs = 6000): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (count < 2 || prefersReducedMotion()) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs]);
  return count < 2 ? 0 : index;
}
```

```tsx
// SmoothScroll.tsx
"use client";
import Lenis from "lenis";
import { useEffect } from "react";
import { prefersReducedMotion } from "./motion";

/** Smooth scrolling for the scroll page only. Does nothing under reduced motion, and stops when the page is left. */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const lenis = new Lenis({ anchors: true });
    let frame = 0;
    const raf = (time: number) => { lenis.raf(time); frame = requestAnimationFrame(raf); };
    frame = requestAnimationFrame(raf);
    return () => { cancelAnimationFrame(frame); lenis.destroy(); };
  }, []);
  return null;
}
```

(`anchors: true` lets the menu's `#notices` links scroll smoothly; confirm the option exists in the installed version's types, and otherwise handle anchor clicks with `lenis.scrollTo(hash)`.)

- [ ] **Step 5: Run, typecheck, lint, commit.** `cd apps/web && npx vitest run test/scroll-motion.test.tsx && npm run typecheck && npm run lint` then `git add apps/web && git commit -m "Scroll page: reveal, hero cycle and Lenis smooth scrolling, all off for reduced motion"`

---

### Task 6: The page shell: top bar, hero, school band, photo strip

**Files:**
- Create: `apps/web/src/site/scroll/{ScrollHome.tsx,TopBar.tsx,Hero.tsx,SchoolBand.tsx,PhotoStrip.tsx,scroll.module.css}`
- Modify: `apps/web/src/i18n/messages.ts`
- Test: `apps/web/test/scroll-home.test.tsx` (create)

**Interfaces:**
- Consumes: `SiteContent` (`@/site/model`, regenerated types), `useReveal`, `useHeroCycle`, `SmoothScroll` (Task 5).
- Produces: `ScrollHomeView({ schoolName, site, notices, applyBlock, signedIn }: { schoolName: string; site: SiteContent & { scroll: ScrollContent }; notices: ReactNode; applyBlock: ReactNode; signedIn: boolean })` renders every block; the blocks in Tasks 7 to 9 are passed in/placed as children (`<Batches/>`, `<NoticeBoard/>`, `<AdmissionBlock/>`, `<AboutBlock/>`), so this task renders the shell with `Batches`, `NoticeBoard`, `AdmissionBlock` and `AboutBlock` slots as props: `slots: { batches: ReactNode; notices: ReactNode; admission: ReactNode; about: ReactNode }`. Photo URL for a file: `` `/site/${schoolSlug}/${file}` ``, where the slug is derived from one place: `export const photoUrl = (file: string) => "/site/lahan/" + file`. **OPEN:** per-school folder name should come from the pack; for now `site.scroll.hero.folder` is not in the schema, so use the constant and note it in D-167 (a second scroll school adds `photosFolder` to the pack).

- [ ] **Step 1: Failing tests** (render with `renderToStaticMarkup`, as `site-home.test.tsx` does; build the site with `siteFrom(lahanJson)` plus a scroll block):

```tsx
it("has one h1, the school's name, and the address above it", () => { /* count(<h1)=1, name inside */ });
it("has exactly one prominent button (Sign in) and an outlined Apply that links to #admission", () => {
  expect(count(html, /class="button primary/g)).toBe(1);
  expect(html).toMatch(/href="#admission"/);
});
it("puts Sign in at the top right, for everyone, and shows Portal for a signed-in person", () => {
  expect(htmlSignedOut).toMatch(/href="\/sign-in"[^>]*>Sign in</);
  expect(htmlSignedIn).toMatch(/href="\/portal"[^>]*>Portal</);
});
it("the menu has Notices, Admission and About anchors, and every anchor target exists", () => {
  for (const id of ["notices", "admission", "about"]) { expect(html).toContain(`href="#${id}"`); expect(html).toContain(`id="${id}"`); }
});
it("the first hero photo is eager and the rest are lazy; every photo has its alt text", () => {});
it("shows the school intro and one photo-strip item per hero image, and no counters", () => {});
it("uses theme tokens only (the guard test also covers the stylesheet)", () => {});
```

- [ ] **Step 2: Run, see fail.** `npx vitest run test/scroll-home.test.tsx` — FAIL.

- [ ] **Step 3: Implement.** Messages to add (all in `messages.ts`): `scroll.menu` "Menu", `scroll.menuLabel` "Page sections", `scroll.nav.notices` "Notices", `scroll.nav.admission` "Admission", `scroll.nav.about` "About", `scroll.signIn` "Sign in", `scroll.portal` "Portal", `scroll.apply` "Apply", `scroll.hero.scroll` "Scroll", `scroll.school.heading` "The school", `scroll.strip.label` "Photos of the school", `scroll.skip` reuse `shell.skipToContent`. Components:

`TopBar.tsx` — a fixed `<header>` with a left `<details>`-free menu: a plain list of three anchor links shown inline from 768 px and, below 768 px, behind a "Menu" `<button aria-expanded>` that toggles a list (state in a small `useState`); the crest (`<img src="/site/lahan/crest.webp" alt="">` named via `crestFile` from the first-class constant `photoUrl("crest.webp")`, decorative, with the school name as the link's accessible name) centred and linking to `#top`; right: a quiet link to `/sign-in` or `/portal`. Controls `min-height: 44px; min-width: 44px`. The bar is transparent over the hero and gets a solid `var(--color-surface)` background with a border once `window.scrollY > 24` (a `scrolled` state set in a passive scroll listener; no layout animation).

`Hero.tsx`:

```tsx
export function Hero({ schoolName, address, images, tagline, signedIn }: HeroProps) {
  const active = useHeroCycle(images.length);
  return (
    <section id="top" className={styles.hero} aria-label={schoolName}>
      <div className={styles.heroPhotos} aria-hidden={images.length > 1 ? undefined : undefined}>
        {images.map((image, i) => (
          <img key={image.file} src={photoUrl(image.file)} alt={i === active ? image.alt : ""} className={styles.heroPhoto} data-active={i === active} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding="async" />
        ))}
      </div>
      <div className={styles.heroShade} />
      <div className={styles.heroText}>
        <p className={styles.heroKicker}>{address}</p>
        <h1 className={styles.heroTitle}>{schoolName}</h1>
        {tagline ? <p className={styles.heroTagline}>{tagline}</p> : null}
        <div className={styles.heroActions}>
          <Link href={signedIn ? "/portal" : "/sign-in"} className={buttonClass()}>{t(signedIn ? "scroll.portal" : "scroll.signIn")}</Link>
          <a href="#admission" className={buttonClass({ variant: "secondary" })}>{t("scroll.apply")}</a>
        </div>
      </div>
      <nav className={styles.heroLinks} aria-label={t("scroll.menuLabel")}>…three anchors…</nav>
    </section>
  );
}
```

`scroll.module.css` — hero: `min-height: 100svh; position: relative; overflow: clip;` photos `position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0; transition: opacity 1.4s ease` and `[data-active="true"]{opacity:1}`; the first photo is `opacity:1` in the base rule when JavaScript is off (use `:first-child` fallback under `html:not(.js)`; add `document.documentElement.classList.add("js")` in `ScrollHome`'s effect). Shade: `background: linear-gradient(to bottom, color-mix(in srgb, var(--color-text) 55%, transparent), color-mix(in srgb, var(--color-text) 25%, transparent) 40%, color-mix(in srgb, var(--color-text) 70%, transparent))`. Text over the photo uses `color: var(--color-surface)`. Title uses `font-family: var(--font-heading)` (look up the real variable name in `apps/web/src/theme/css.ts`) at `clamp(2.25rem, 7vw, 4.5rem)`. Reveal blocks: `.reveal{transition: opacity .7s ease, transform .7s ease}` and `html.js .reveal:not([data-revealed="true"]){opacity:0; transform:translateY(1.25rem)}`; `@media (prefers-reduced-motion: reduce){ .reveal, .heroPhoto{transition:none} html.js .reveal:not([data-revealed="true"]){opacity:1; transform:none} }`. The school band: `background: var(--color-primary); color: var(--color-primary-text)` (use the real token names found in `tokens.css`/`css.ts`), centred serif paragraph, max-width `40rem`. Photo strip: `display:flex; gap: var(--space-3); overflow-x:auto; scroll-snap-type:x proximity; padding-inline: var(--page-gutter);` with `tabindex="0"` and `role="region" aria-label={t("scroll.strip.label")}`; each image `flex:0 0 min(78vw, 22rem); aspect-ratio: 4/3; object-fit: cover; border-radius: var(--radius-card)`.

`ScrollHome.tsx` composes `<SmoothScroll/>`, `<TopBar/>`, `<main id="main">` with `Hero`, `SchoolBand`, `PhotoStrip`, `slots.batches`, `<section id="notices">{slots.notices}</section>`, `<section id="admission">{slots.admission}</section>`, `<section id="about">{slots.about}</section>`, and a `<footer>` with the Privacy link and the school name (existing keys `shell.privacy`, `shell.footer`). Skip link first.

- [ ] **Step 4: Run, typecheck, lint, the guards.** `cd apps/web && npx vitest run test/scroll-home.test.tsx test/guards.test.ts && npm run typecheck && npm run lint` — PASS. If `guards.test.ts` flags a word or colour, fix the source, never the test.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "Scroll page: top bar, photo hero, school band and photo strip"`

---

### Task 7: Batches (sticky two columns)

**Files:**
- Create: `apps/web/src/site/scroll/Batches.tsx`
- Modify: `apps/web/src/site/scroll/scroll.module.css`, `apps/web/src/i18n/messages.ts`
- Test: add to `apps/web/test/scroll-home.test.tsx`

**Interfaces:**
- Consumes: `site.scroll.batches` (`{ title; note? }[]`), `useReveal`.
- Produces: `<Batches batches={...} />` rendering `<section aria-labelledby="batches-title">`.

- [ ] **Step 1: Failing tests.**

```tsx
it("lists one card per batch, in order, with its note when it has one", () => {
  for (const b of batches) expect(html).toContain(esc(b.title));
  expect(html).toContain("To confirm with the school");
  expect(html.indexOf(esc(batches[0]!.title))).toBeLessThan(html.indexOf(esc(batches.at(-1)!.title)));
});
it("the heading is an h2 and the cards are a list", () => { expect(html).toMatch(/<h2[^>]*id="batches-title"/); expect(count(html, /<li[^>]*batchCard/g)).toBe(batches.length); });
it("shows nothing at all when there are no batches", () => { expect(renderToStaticMarkup(<Batches batches={[]} />)).toBe(""); });
```

- [ ] **Step 2: Run, see fail.** FAIL (`Batches` missing).

- [ ] **Step 3: Implement.** Messages: `scroll.batches.title` "Our classes", `scroll.batches.lead` "From the youngest learners to the SEE class." (placeholder-free, true to the profile: Kindergarten to Class 10 is "likely": use "The classes the school teaches, as the school has told us." and keep the per-card note "To confirm with the school"). Component:

```tsx
export function Batches({ batches }: { batches: { title: string; note?: string }[] }) {
  if (batches.length === 0) return null;
  return (
    <section className={styles.batches} aria-labelledby="batches-title">
      <div className={styles.batchesPin}>
        <h2 id="batches-title" className={styles.sectionTitle}>{t("scroll.batches.title")}</h2>
        <p className={styles.sectionLead}>{t("scroll.batches.lead")}</p>
      </div>
      <ol className={styles.batchList}>
        {batches.map((b, i) => <BatchCard key={b.title} number={i + 1} {...b} />)}
      </ol>
    </section>
  );
}
function BatchCard({ title, note, number }: { title: string; note?: string; number: number }) {
  const ref = useReveal<HTMLLIElement>();
  return (
    <li ref={ref} className={`${styles.batchCard} ${styles.reveal}`}>
      <span className={styles.batchNumber} aria-hidden>{String(number).padStart(2, "0")}</span>
      <h3 className={styles.batchTitle}>{title}</h3>
      {note ? <p className={styles.muted}>{note}</p> : null}
    </li>
  );
}
```

CSS: `.batches{display:grid; gap: var(--space-6); padding: var(--space-8) var(--page-gutter)}`; at `min-width: 768px` `grid-template-columns: minmax(0,1fr) minmax(0,1.2fr)` and `.batchesPin{position:sticky; top: 6rem; align-self:start}`. Cards: `background: var(--color-surface); border:1px solid var(--color-border); border-radius: var(--radius-card); padding: var(--space-5); box-shadow: var(--shadow-card)`.

- [ ] **Step 4: Run.** `npx vitest run test/scroll-home.test.tsx test/guards.test.ts && npm run typecheck && npm run lint` — PASS.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "Scroll page: batches in a sticky two-column block"`

---

### Task 8: Notice board and the reader dialog

**Files:**
- Create: `apps/web/src/site/scroll/{NoticeBoard.tsx,NoticeReader.tsx}`
- Modify: `apps/web/src/site/scroll/scroll.module.css`, `apps/web/src/i18n/messages.ts`
- Test: `apps/web/test/scroll-notices.test.tsx` (create)

**Interfaces:**
- Consumes: `loadPublic(api)` and `PublicItem` (`@/content/client`, `@/content/model`), `KindChip`, `UrgentChip`, `PublicEntry` (`@/content/PublicEntry`), `formatBsDate`, `holidayLine` (`@/content/model`), `createApiClient` (`@/api/client`).
- Produces: `<NoticeBoard />` (loads items itself, like `/notices`) and `<NoticeBoardView items status onOpen openId onClose />` (pure, testable); `<NoticeReader item onClose />` (uses the browser's `<dialog>`, like `ui/AddDialog.tsx`: read it first and follow its focus and Escape handling and its reduced-motion rule).

- [ ] **Step 1: Failing tests.**

```tsx
it("lists titles only (never the body), newest and urgent first as the API sends them, each with kind and BS date", () => {
  expect(html).toContain("Exam routine"); expect(html).not.toContain(item.body);
  expect(html).toContain("Notice"); /* kind label */ 
});
it("each title is a button that opens that notice", () => { expect(html).toMatch(/<button[^>]*>Exam routine/); });
it("the reader shows the whole post through PublicEntry, with a close button, and is labelled by the title", () => {
  const reader = renderToStaticMarkup(<NoticeReader item={item} onClose={() => {}} />);
  expect(reader).toContain(item.body.split("\n")[0]!); expect(reader).toMatch(/aria-labelledby/); expect(reader).toMatch(/Close/);
});
it("a very long title does not overflow: the title class wraps", () => { expect(css).toMatch(/overflow-wrap:\s*anywhere/); });
it("an empty board says so, and a failed load offers a retry", () => { /* both states */ });
it("openIdFromSearch reads ?notice=<id> and ignores anything that is not a 32-hex id", () => {
  expect(openIdFromSearch("?notice=" + "a".repeat(32))).toBe("a".repeat(32));
  expect(openIdFromSearch("?notice=../x")).toBeNull(); expect(openIdFromSearch("")).toBeNull();
});
it("a notice id that is not in the live list opens nothing (it ended, or never existed)", () => { expect(pickOpen(items, "f".repeat(32))).toBeNull(); });
```

(`pickOpen(items, id)` returns the item or `null`; both helpers are exported from `NoticeBoard.tsx`.)

- [ ] **Step 2: Run, see fail.** FAIL.

- [ ] **Step 3: Implement.** Messages: `scroll.notices.title` "Notice board", `scroll.notices.lead` "What the school has told us lately. Select a title to read it all.", `scroll.notices.all` "All notices", `scroll.notices.close` "Close", `scroll.notices.open` "Read {title}" (the button's accessible name when the visible text is only the title: do not add a visible duplicate; leave the title as the content and skip `aria-label`). Keep `notices.loading`, `notices.empty`, `notices.loadFailed`, `notices.retry` from the existing catalog.

```tsx
const ID = /^[0-9a-f]{32}$/;
export const openIdFromSearch = (search: string): string | null => {
  const id = new URLSearchParams(search).get("notice");
  return id && ID.test(id) ? id : null;
};
export const pickOpen = (items: PublicItem[], id: string | null) => (id ? items.find((i) => i.id === id) ?? null : null);
```

`NoticeBoard`: `useEffect` loads `loadPublic`; `const [openId, setOpenId] = useState<string | null>(() => typeof window === "undefined" ? null : openIdFromSearch(window.location.search))`; opening sets `history.replaceState(null, "", "?notice=" + id + "#notices")`, closing restores `"#notices"` without the query and returns focus to the title button that opened it (keep a `lastTrigger` ref). The row: `<li><button type="button" className={styles.noticeRow} onClick=…><KindChip kind/> {urgent && <UrgentChip/>} <span className={styles.noticeTitle}>{title}</span> <span className={styles.muted}>{formatBsDate(item)}</span></button></li>` with `min-height: 44px`, `.noticeTitle{overflow-wrap:anywhere}`. A link "All notices" to `/notices` as a quiet button. `NoticeReader` renders a `<dialog>` opened with `showModal()` in an effect, labelled by its heading id, containing `<PublicEntry … headingLevel={2} />` built exactly as `NoticeList` in `content/NoticeBoard.tsx` builds it (copy its props mapping for `dates` and `holiday`), plus the close button; `onClose` fires on the dialog's `close` event so Escape works; the entrance uses opacity and transform and is disabled under reduced motion.

- [ ] **Step 4: Run.** `npx vitest run test/scroll-notices.test.tsx test/guards.test.ts && npm run typecheck && npm run lint` — PASS.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "Scroll page: notice board with a reader dialog and ?notice= deep links"`

---

### Task 9: Admission and About blocks

**Files:**
- Create: `apps/web/src/site/scroll/{AdmissionBlock.tsx,AboutBlock.tsx}`
- Modify: `apps/web/src/site/scroll/scroll.module.css`, `apps/web/src/i18n/messages.ts`
- Test: `apps/web/test/scroll-admission-about.test.tsx` (create)

**Interfaces:**
- Consumes: `ApplyScreen({ embedded })` (Task 4), `loadOpenLevels(api)` (existing), `Reach` (`@/site/Reach`, renders a phone as a `tel:` link), `site.contact`, `site.scroll.about`.
- Produces: `<AdmissionBlock phone={string} />` (checks open levels once; shows the form when at least one is open, otherwise the closed state) and `<AdmissionBlockView state="loading"|"open"|"closed"|"failed" phone form />`; `<AboutBlock address phones about />`.

- [ ] **Step 1: Failing tests.**

```tsx
it("shows the form when a class is open", () => { expect(open).toContain("<form"); });
it("shows the phone number, not a form, when no class is open", () => {
  expect(closed).not.toContain("<form"); expect(closed).toContain('href="tel:+97733564346"');
  expect(closed).toContain("Admissions are not open online right now");
});
it("shows the same fallback when the levels cannot be loaded", () => { expect(failed).toContain('href="tel:'); });
it("about shows the address, the phones as links, the story, and a Facebook link that opens safely", () => {
  expect(about).toContain('rel="noopener noreferrer"'); expect(about).toContain("facebook.com");
});
it("the map link is a plain https link built from the query, URL-encoded, with no embed", () => {
  expect(about).toContain("https://www.google.com/maps/search/?api=1&amp;query=Lahan-8%2C%20Road%20No%20-%202"); expect(about).not.toContain("<iframe");
});
it("an about block with no story, no link and no map query shows only what exists", () => {});
```

- [ ] **Step 2: Run, see fail.** FAIL.

- [ ] **Step 3: Implement.** Messages: `scroll.admission.title` "Apply for admission", `scroll.admission.lead` "Tell us about the student. The school office will review it and call you.", `scroll.admission.closedTitle` "Admissions are not open online right now", `scroll.admission.closedBody` "Please call the school office to ask about admission.", `scroll.about.title` "About the school", `scroll.about.address` "Address", `scroll.about.phone` "Phone", `scroll.about.facebook` "School's Facebook page", `scroll.about.map` "Open in maps". `AdmissionBlock` loads `loadOpenLevels(api)` in an effect (via `useSession().api`, as `ApplyScreen` does), then renders `<ApplyScreen embedded />` for `open`; the view component takes the form as a prop so tests need no network. `AboutBlock` builds the map URL with `encodeURIComponent` and uses `<a href target="_blank" rel="noopener noreferrer">`. No third-party embed, no script.

- [ ] **Step 4: Run.** `npx vitest run test/scroll-admission-about.test.tsx test/guards.test.ts && npm run typecheck && npm run lint` — PASS.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "Scroll page: admission block with an office fallback, and the about block"`

---

### Task 10: Wire the page in and retire the classic pages for a scroll school

**Files:**
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/site/SiteFrame.tsx`, `apps/web/src/site/scroll/ScrollHome.tsx`
- Test: `apps/web/test/scroll-wiring.test.tsx` (create)

**Interfaces:**
- Consumes: everything above; `useSite()` (`SiteView`), `useSession()` for `signedIn` (look at how `PublicHeader` decides "signed in" through the session hint and mirror it: `grep -n "session" apps/web/src/shell/PublicHeader.tsx`).
- Produces: `/` shows `ScrollHome` when `view.site.layout === "scroll"` (no `PublicShell` header or footer around it), otherwise exactly the old `HomeFrameView`. `SiteFrameView` shows a plain "This page is not available" notice with a link home when the loaded site is a scroll site (for `/programmes`, `/admission`, `/scholarships`, `/facilities`, `/contact`).

- [ ] **Step 1: Failing tests.**

```tsx
it("a classic school's home renders as before", () => { /* HomeFrameView path unchanged: the old site-home tests stay green */ });
it("a scroll school's home renders ScrollHome with every block", () => { /* via the exported pure switch: pickHome(view) */ });
it("SiteFrameView says a classic-only page is not available on a scroll school, and links home", () => {
  expect(html).toContain("This page is not available"); expect(html).toContain('href="/"');
});
it("SiteFrameView is unchanged for a classic school", () => {});
```

Export a pure `chooseHome(view: SiteView): "scroll" | "classic" | "loading"` from `ScrollHome.tsx` for the first test.

- [ ] **Step 2: Run, see fail.** FAIL.

- [ ] **Step 3: Implement.** `page.tsx`: inside `Home()` call `useSite()` as now; `if (view.status === "ready" && view.site.layout === "scroll" && view.site.scroll) return <ScrollHome … />` and make `HomePage` render `<ConfigGate><Home/></ConfigGate>` inside `PublicShell` only for the classic case: restructure so `PublicShell` wraps only the classic return (move the shell into `Home`). `SiteFrameView`: after the `ready` check, `if (view.site.layout === "scroll") return <Notice>{t("scroll.unavailable")}</Notice>` plus a home link; add `scroll.unavailable` "This page is not available." and `scroll.home` "Back to the home page".

- [ ] **Step 4: Run the whole web suite and the build.** `cd apps/web && npm test && npm run typecheck && npm run lint && npm run build` — PASS. Open the static export `out/` size check: `node ../../scripts/check-page-weight.mjs` if the script is wired to a budget file (`grep -n "page-weight" apps/web/package.json package.json .github/workflows/*`); the `/` budget may need raising by the PM: do not change a budget silently, report the numbers.

- [ ] **Step 5: Commit.** `git add apps/web && git commit -m "Scroll page: wired in as the front page of a scroll school"`

---

### Task 11: The photos (needs the PM's yes first)

**Files:**
- Create: `apps/web/public/site/lahan/{hero-1,hero-2,hero-3,hero-4,strip-1,strip-2,strip-3,crest}.webp` (names must match `packs/lahan-manakamana/pack.json`)
- Modify: `packs/lahan-manakamana/pack.json` (hero and strip file names and alt texts), `packs/README.md` (provenance and consent note)

- [ ] **Step 1: Pick candidates and ask.** In the browser pane (the school's Facebook page is already signed in as the PM), list candidates from the Photos tab: the cover photo, wide shots of the building or classrooms, event shots without close-ups of identifiable children, and the crest from the profile picture. Write a table (file name, what it shows, source post, size) and **stop and ask the PM to approve it**. Nothing is downloaded before a yes.
- [ ] **Step 2: After the yes, download** each approved image from the page into a new empty scratch folder (not the repo), e.g. `C:\Users\kumar\AppData\Local\Temp\claude\...\scratchpad\lahan-photos\raw\`, using the browser's image URL. Treat them as untrusted data.
- [ ] **Step 3: Convert to WebP** with `sharp` run from a different directory, passing paths as arguments:

```bash
cd <scratchpad>/tools && npm init -y >/dev/null && npm i sharp
node convert.mjs <scratchpad>/lahan-photos/raw <repo>/apps/web/public/site/lahan
```

where `convert.mjs` resizes heroes to 1920 px wide at quality 70 (target at most 150 KB each, lower the quality until under), strip images to 1000 px (at most 80 KB), the crest to 256 px with transparency preserved. Report each final size.
- [ ] **Step 4: Fill `site.scroll.hero.images`, strip file names and alt texts in the pack** (alt texts describe the scene in plain words, never name a child).
- [ ] **Step 5: Run** `cd apps/api && npx vitest run test/lahan-pack.test.ts` — PASS now including the "files that exist" test; `git add apps/web/public packs && git commit -m "Lahan: school photos and crest (approved by the PM)"`.

---

### Task 12: Local end-to-end check, reviews, decisions, hand-over (no deploy)

**Files:**
- Modify: `docs/DECISIONS.md` (D-167, D-168), `CLAUDE.md` (the "Current phase" line gets one sentence; section 7 signup rule gets "except a school whose pack turns the email link off, D-168"), `packs/README.md`, `docs/uat-guide.md` (one short section for the scroll page), the spec (record the deviations below)
- Test: run everything

- [ ] **Step 1: Record the decisions.** Append D-167 (scroll layout: pack-selected, classic kept for others, photos folder constant `OPEN:`, classic-only pages say "not available") and D-168 (admission without email: the school flag `public_apply_verifies_email`, status `pending_review`, limit per phone and per address, CAPTCHA skipped by the PM on 2026-10-13, amends CLAUDE.md section 7). Update the spec's section 5 and 6.1 to say the flag is `school.publicApplyNeedsLink` (not `admissions.verifyEmail`), that one migration (0039) was needed, and that hero-file existence is checked by a test, not by `parsePack`.
- [ ] **Step 2: Everything green.**

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
cd ../web && npm run typecheck && npm run lint && npm test && npm run build
cd ../.. && node scripts/check-boundaries.mjs
cd apps/api && npm run gen:openapi && cd ../web && npm run gen:api && git status --short   # no drift
```
Expected: all pass; no uncommitted generated drift. Also confirm the second-school test and the theme snapshot tests passed inside `npm test`.
- [ ] **Step 3: Run it locally.**

```bash
cd apps/api && cp -n .dev.vars.example .dev.vars   # only if missing; set the three secrets and SITE_ORIGIN=http://localhost:3000
npm run provision -- --pack ../../packs/lahan-manakamana --local
USER_PASSWORD='<a long passphrase>' npm run dev:user -- --email principal@lahan.test --name "Test Principal" --role admin
npm run dev:content -- --email principal@lahan.test          # local sample notices
cd ../web && npm run build && cd ../api && npm run dev       # http://localhost:8787
```
(Local database only. The `--remote` flag is never used.) Then, with the preview tools (`preview_start`, `.claude/launch.json` entries `worker` and `web-dev`): scroll the page top to bottom at 1440, 768 and 320 px, with text at 200%; open a notice from the board and by `/?notice=<id>`, close with Escape and check focus returns; submit an application with no email and confirm it appears in the Co-ordinator's queue (sign in locally as a Co-ordinator made with `dev:user`); emulate `prefers-reduced-motion` and JavaScript off (view-source plus `curl http://localhost:8787/` for the crawler copy); read the console and network for errors; take screenshots as proof.
- [ ] **Step 4: Reviews.** Load `apple-design` (accessibility, layout, typography, colour pages, then the pages for the scrolling hero, forms and modal) and review the page; fix what is found. Run the matching `geo-*` skills on the local `/` (schema, technical, crawlers, llms.txt, content, citability) and note findings (do not run `geo-update`). Record both in the final message: what was checked, which guideline pages, what was fixed, what was left and why.
- [ ] **Step 5: Commit and stop.** `git add -A docs CLAUDE.md packs apps && git commit -m "Scroll public site: decisions D-167 and D-168, UAT notes"`. **Do not push, merge or deploy.** The final message lists: what changed (affecting admissions, with the tests), what was tested, what is not done (deploy, remote migration `0039`, real copy and consent, Turnstile skipped), and every `OPEN:` item (photos folder constant, intro and batch text unconfirmed, school name, class range, email adapter, Lenis pinned version).

---

## Self-review

- **Spec coverage:** sections 2 (layout, pages lists, crawler copy) Tasks 1, 3, 10; 3 (the eight blocks) Tasks 6 to 9 (top bar, hero, school band, strip, batches, notices, admission, about; footer in Task 6); 4 (motion, Lenis, reduced motion, no-JS) Task 5 and Task 6 CSS; 5 (no-email admission, limits, queue, classic unchanged, CAPTCHA skipped) Tasks 2 and 4; 6.1 (pack) Task 1, 6.2 (reading) Task 1 and 10, 6.3 (photos, approval) Task 11; 7 (who posts) needs no code, checked in Task 12 step 3 by the existing matrix tests; 8 (code layout) the File Structure table; 9 (testing) each task plus Task 12; 10 (order) matches; 11 (local only) Global Constraints and Task 12; 12 (open points) Task 12 step 5.
- **Deviations from the spec (recorded in Task 12):** the flag lives on `school` (`publicApplyNeedsLink`, migration 0039) beside `studentKeepsPin`, because the service reads it from SQL; hero files are checked by a test, not `parsePack` (the core cannot touch the file system); the photos folder is a constant for now.
- **Placeholders:** none intended; the places that say "look up the real name" (token names, outbox table, `call` options, Lenis version) are verification steps on code I read only in part, each with the command to find the answer.
- **Types:** `ScrollContent`, `SiteContent.layout`, `publicApplyNeedsLink`, `filledPagesFor`, `ApplyScreen({ embedded })`, `validateApplicant(values, { email })`, `showEmail`, `openIdFromSearch`, `pickOpen`, `chooseHome`, `photoUrl` are defined once and used with the same names.
