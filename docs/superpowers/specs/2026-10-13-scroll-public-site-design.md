# The scroll public site (a new public layout, first used by Lahan Manakamana)

Status: design approved by the PM in chat, 2026-10-13. Awaiting the PM's read of this file before the implementation plan.
Rules it rests on: D-008 and D-009 (configure, then theme; only the public site has layout variants, 2 or 3), D-026 (packs, theme contrast check), D-029 to D-032 (Apple-level design, `ui-ux-pro-max`, review with `apple-design`), D-031 (GEO skills for the public site), D-039 and D-044 (website content and the public notice board), D-046 and D-049 (pages the Worker answers itself), D-063 (admissions), D-144 (Lahan's pack), D-020 (no uploads, R2 off), `CLAUDE.md` sections 2, 3 and 7.
Source data: `docs/lahan-manakamana-profile.md` (read from the school's Facebook page on 2026-10-13, unconfirmed).
Reference for the feel: https://www.colegiojunipero.org/ (studied 2026-10-13). We copy its structure, scroll behaviour and typographic feel, never its photos, words, code or colours.

## 1. Goal

Lahan Manakamana's public site becomes **one long scrolling page** with a full-screen photo hero, a school-and-batches story, a notice board, an admission form and an about block, with a quiet sign-in at the top right for everyone. It is built only from data we have today; nothing is invented, and a block with no content is not shown.

Not in this slice: counters or "facts" bands (no confirmed figures), programmes, scholarships and facilities pages (no data), a Nepali toggle, photo uploads (R2 is held), an analytics or cookie banner, an Admin screen for the page's words.

## 2. Where it lives (D-008, D-009)

A new public layout, **`scroll`**, chosen by the school's pack: `site.layout: "scroll"` (default `"classic"`, today's pages). One build serves every school; Royal Softech and the sample school are unchanged and the second-school test still passes.

- `/` renders the scroll page when the layout is `scroll`. The other fixed pages (`/programmes`, `/admission`, `/scholarships`, `/facilities`, `/contact`) are not filled for a scroll school, so `PAGES`, `FILLED_PAGES`, `sitemap.xml` and `llms.txt` follow its content and omit them (D-046, D-049). `/notices`, `/apply`, `/privacy` and `/sign-in` stay.
- Anchors on `/`: `#notices`, `#admission`, `#about`.
- The Worker still fills `/` for crawlers from the same pack data (D-046): the school name, address, phone, the notice titles and the about text. Nothing important is only in JavaScript.

## 3. The page, top to bottom

Design follows the reference's flow. Colours are theme tokens taken from the school's crest (gold and maroon), checked by the contrast guard (D-026); fonts are self-hosted (a classical serif for display lines, a clean sans for text).

1. **Top bar (fixed, over the hero, solid once scrolled).** Menu on the left (Notices, Admission, About, as anchors), the crest centred, **Sign in** on the right. Sign in is the existing management sign-in and is the only link a signed-in person needs; a signed-in person sees "Portal" in its place. Controls are at least 44 px; a menu of one entry is not shown (D-030).
2. **Hero.** Full-screen school photos cross-fading slowly under a dark overlay (first image loads at once; the rest lazily). Small-caps address line, the school's name as the `h1`, then two buttons: **Sign in** (the one filled button, D-030) and **Apply** (outlined, to `#admission`). Along the bottom edge, three quiet links: Notices, Admission, About.
3. **The school.** A full-width dark band: a short centred intro paragraph from the pack. Then a **sideways photo strip** (scrollable, keyboard reachable).
4. **Batches.** A sticky two-column block: the heading and a one-line note stay pinned on the left while one card per class group scrolls on the right (Kindergarten to Class 10, as the pack lists them, marked "to confirm"). Under 768 px the columns stack and nothing sticks.
5. **Notice board.** Titles only, newest first and urgent first, each with its kind (Notice, Holiday, Routine, News, Event, Information) and its date in BS. Clicking a title opens the **whole post in a reader dialog** (focus kept inside, Escape closes, a deep link `/?notice=<id>` opens it, text from the existing item endpoint). "All notices" links to `/notices`. Empty state: "No notices at the moment."
6. **Admission.** The existing application (`ApplyScreen`) in the page, **without an email field** (section 5). When no class is open, the section says so and shows the school's phone number instead of a form.
7. **About.** Address, phone, a link to the school's Facebook page, and the pack's story text. A map link opens the visitor's own map app; no third-party embed.
8. **Footer.** Privacy, Sign in, the school's name.

## 4. Motion

- Reveals (fade and rise) use `IntersectionObserver` and animate only transform and opacity; the sticky column is plain CSS (`position: sticky`).
- Smooth scrolling uses **Lenis** (about 3 KB, pinned to an exact version). **OPEN:** a new dependency, to be approved by the PM before it is added. Without it, native scrolling works and nothing else changes.
- Everything is off under `prefers-reduced-motion`: no cross-fade (the first photo stays), no reveal, no smooth scroll.
- With JavaScript off, the content still shows (reveals start visible, the hero shows its first photo).

## 5. Admission without an email (a PM decision, recorded as a new D-number)

Today the public form requires an email and the application waits as `email_unverified` until the link is opened (D-063). For a scroll school:

- The public form has **no email field**. The backend makes one with `suggestEmail` (`first.last@student.com`, then `first.last_1@…`), exactly as it already does for a walk-in or a registered student.
- With no real address there is nothing to verify, so the application is stored as **`pending_review`** and appears in the Co-ordinator's queue at once. No `admission_verify` message is queued. The Co-ordinator still reviews and approves every application; rejection stays final.
- This amends the rule in `CLAUDE.md` section 7 ("email verification before the application enters the queue"). It is on for a school only when its pack says `site.layout: "scroll"` with `school.publicApplyNeedsLink: false` (default `true`; built as a column on `school`, migration 0039, like `studentKeepsPin`), so Royal Softech and the sample school keep verification.
- The anonymous write path is guarded by: the one-time submission token (a retry is idempotent), the hidden `website` trap field (already there), **a limit per phone number** (the old limit per email is meaningless with an invented email, so it is replaced for these schools) and the existing limit per address, and the existing duplicate flags (phone, or name plus date of birth). The strict upload rule is unchanged (no uploads).
- **OPEN:** a CAPTCHA (for example Cloudflare Turnstile) needs the PM's approval before it is added.
- Server-side cleanup for expired unverified applications is unaffected (these never enter that state).

## 6. Data

### 6.1 Pack (`apps/api/src/core/config/pack.ts`, strict)
`site` gains `layout: "classic" | "scroll"` (default `"classic"`) and, for `scroll`, a block `scroll`:

| Key | Shape |
|---|---|
| `hero` | `{ images: { file, alt }[] (1 to 6), tagline? }` |
| `intro` | `string` (the school paragraph) |
| `batches` | `{ title, note? }[]` (max 20) |
| `about` | `{ story?, facebook? (https URL on facebook.com), mapQuery? }` |

`school.publicApplyNeedsLink` (boolean, default `true`; named without the word "email" because a guard test forbids it in the public configuration). `parsePack` checks: a plain `.webp` file name for each hero image (a test, `lahan-pack.test.ts`, checks the files exist, because the core cannot read the file system), the Facebook link's host, unique batch titles. Address and phones keep coming from `site.contact`. Lahan's pack is filled from `docs/lahan-manakamana-profile.md`; unconfirmed items are named in `packs/README.md` and in the test that counts them (`OPEN:`), since JSON holds no comment.

### 6.2 Reading
The scroll block travels in the existing `GET /api/site/pages` answer (new optional field, contract regenerated). Notices come from the existing public content endpoints (D-039, D-044), which show items live from their publish day. No new table, no new migration.

### 6.3 Photos
Static WebP files in `apps/web/public/site/lahan/` (R2 stays off, D-020). Hero images at most about 150 KB each, strip and card images about 80 KB. Chosen from the school's page: the cover photo and wide shots, not close-ups of children. **Before anything is downloaded the PM approves a list of file name, source and size.** The school's written consent for the photos is needed before launch (they show minors). The crest is the school's own file, never regenerated (`CLAUDE.md` section 7).

## 7. Who posts what
Unchanged. The Principal publishes notices directly. A Co-ordinator saves a draft and presses "Send for approval"; the Principal approves, and then it shows on the board (matrix rows `content.draft` and `content.publish`).

## 8. Code layout
- Web: `apps/web/src/site/scroll/` (`ScrollHome`, `TopBar`, `Hero`, `SchoolBand`, `PhotoStrip`, `Batches`, `NoticeBoard`, `NoticeReader`, `AdmissionBlock`, `AboutBlock`, `useReveal`, `scroll.module.css`), words in `apps/web/src/i18n/messages.ts`, no hardcoded colours or fonts.
- Web: `ApplyScreen` takes a `withEmail` option; `/` picks the layout from the loaded pack.
- API: `pack.ts` schema, `modules/site` (answer, Worker fill, page lists), `modules/admissions/service.ts` (no-email path, phone limit, `pending_review`), `apps/api/openapi.json` regenerated.

## 9. Testing (before it is done)
- API, before code: a no-email application is stored `pending_review`, gets a suggested email, queues no message; a second one with the same first and last name gets `_1`; the limit per phone; a retried token is idempotent; a classic school still requires and verifies the email; a Co-ordinator cannot be bypassed (approval needed to create a student).
- Pack: unknown layout and keys rejected; missing hero file rejected; the Facebook host check.
- Web: markup tests for each block and its empty state; the notice reader opens, traps focus, closes on Escape and opens from `?notice=`; reduced motion removes the cross-fade and reveals; every guard in `apps/web/test/guards.test.ts` (no hardcoded colours, fonts or words).
- Permissions: the matrix tests are unchanged and still pass; `/api/admissions/apply` stays the only anonymous write.
- The second-school test and the second-theme snapshot test; `check-boundaries` for the page lists and `run_worker_first`.
- In a browser at 320 px with text at 200%, at tablet and desktop, with reduced motion; page weight inside the budget.
- Review: `apple-design` (accessibility, layout, typography, colour pages) and the matching `geo-*` skills (schema, technical, crawlers, llms.txt, content, citability), reported in the final message.

## 10. Order of work (small vertical slices; the plan will fix the detail)
1. Pack schema, `layout`, the scroll block, Lahan's pack, the page lists.
2. No-email admission (API first, with its tests).
3. The page shell: top bar, hero, the school band, photo strip, batches.
4. Notice board and reader.
5. Admission block and about block.
6. Motion, Lenis (once approved), reduced motion, then the design and GEO reviews.

## 11. Local first, deploy last (PM, 2026-10-13)
The whole page is developed and checked **locally** (dev server, local D1, the local Worker) until every slice in section 10 is done and reviewed. Nothing is deployed to staging or to Lahan's site, no remote migration or pack is applied, and nothing is pushed or merged, until the PM says so. Photos are downloaded only after the PM approves the list (section 6.3). Lahan's live pages stay as they are in the meantime.

## 12. Open points
- **OPEN:** Lenis as a dependency; a CAPTCHA; the official school name ("Secondary" or not); the class range; the school's photos and their consent; real intro, story, principal and contact text; an email adapter (D-144) for real email later.
- Touches admissions (anonymous write path and a rule in section 7): called out at the top of the final message with its tests.
