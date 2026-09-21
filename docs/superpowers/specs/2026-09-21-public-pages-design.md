# Phase 2, slice 3: the fixed public pages

Status: design approved by the PM in chat, 2026-09-21 (three sections). Awaiting the PM's read of this file before the implementation plan.
Rules it rests on: D-008 (pack, seam before builder), D-026 (packs only add and update), D-038 (Phase 2), D-039 (content model), D-046 and D-049 (crawler copy, `PAGES`), D-030 (house design rules), D-031 (GEO skills for the public site), `CLAUDE.md` sections 2, 3 and 7.

## 1. Goal

Royal Softech's public site gets its six fixed pages: **Home, Programmes, Admission, Scholarships, Facilities, Contact**. The words come from the school's pack, so a second school gets its own pages from the same build. Text and design only (R2 is held, D-020). Home leads with admissions.

Not in this slice: an Admin screen for these words (the Admin edits only the five content types, D-039), photos, per-programme pages, seat numbers, social links, a vision statement, a Nepali toggle, and slice 5 (page-weight budgets, staging exit check).

## 2. Approach chosen

A `site` block in the pack, stored as one JSON row and read through its own public endpoint.

Rejected: adding it to `PublicConfig` (every portal page would fetch every programme and facility); putting the words in the web catalog (Royal's words would ship in every school's build, breaking rule 2).

## 3. Data

### 3.1 Pack block (`apps/api/src/core/config/pack.ts`)

`PackSchema` gains a required `site` block (a `strictObject`; unknown keys are rejected). All strings are trimmed and length-capped in the schema.

| Key | Shape |
|---|---|
| `home` | `{ headline, summary }` |
| `programmes` | `{ key, name, section, affiliation, duration, summary, options[] }[]`, max 20. `key` is a slug (used as the page anchor). `section` must be one of the pack's section keys. |
| `admission` | `{ intro, steps: { title, body }[] }`, 1 to 12 steps |
| `scholarships` | `{ intro, items: { title, body }[] }` |
| `facilities` | `{ intro, items: { name, body? }[] }` |
| `contact` | `{ address, phones: string[], email?, hours? }` |

`parsePack` adds checks the schema cannot express: programme keys are unique, and every programme's `section` exists in `sections`.

Both packs carry a `site` block. Royal's holds the nine programmes, six admission steps, scholarship policy and fifteen facilities from `docs/client-profile.md`. That content is third-party and unconfirmed, so the pack file and the tests mark it `OPEN:`. The sample school's block is written for Nursery to Grade 10 and shares no wording with Royal's (the second-school test checks this).

### 3.2 Storage

One migration, `0008_site_content.sql`: `site_content (id INTEGER PRIMARY KEY CHECK (id = 1), content_json TEXT NOT NULL, updated_at TEXT NOT NULL)`. It is a core-config table, like `themes` and `sections`. `packOperations` upserts the row. `sql-render.ts` (which renders operations for remote runs) must handle the new operation; the plan checks this first.

Applying a pack replaces the whole row (an update of one document, never a delete). This differs from sections, which stay when a pack drops them, and touches the open D-026 question on removal. It is logged in `DECISIONS.md` and not decided here: `OPEN:`.

### 3.3 Reading

- `core/config/site.ts`: `loadSiteContent(db)` returns the parsed block or `null` (one round trip; the row is re-validated on read and ignored if it no longer parses, like a stored theme).
- `GET /api/site/pages`, in `modules/site`, declared public and listed in `PUBLIC_ROUTES` (the same for every visitor, nothing private). Output is validated by Zod and added to the committed OpenAPI contract, and the typed client is regenerated. Response is `{ ready: false }` when there is no row, otherwise `{ ready: true, ...block }`. `Cache-Control: public, max-age=60`.
- The Worker's builders call `loadSiteContent` directly, not the HTTP route.

## 4. Public pages

### 4.1 Addresses

Add `/programmes`, `/admission`, `/scholarships`, `/facilities`, `/contact` to `PAGES` and `SUMMARIES` (`modules/site/pages.ts`), and to `run_worker_first` in `apps/api/wrangler.jsonc` and the git-ignored `wrangler.local.jsonc`. `scripts/check-boundaries.mjs` and the "page has a summary" test already fail if a list is missed. `sitemap.xml` and `llms.txt` are built from `FILLED_PAGES` (`crawler-files.ts`), so they follow; a test confirms it. Programmes are anchors on one page (`/programmes#bbs`), so no extra addresses.

### 4.2 Home, in order

Each block shows only if it has content.
1. Hero: school name as the h1, the pack's summary, one prominent button **How to apply** (to `/admission`), and a quiet link to `/notices`.
2. Urgent notice strip: live urgent items from the existing content API (`GET /api/site/content`).
3. Programmes, grouped by section, each a card linking to its anchor.
4. Admission in brief: step titles only, with a link to the full page.
5. Contact strip: first phone and the address, linking to `/contact`.

The current Home's primary "Sign in" button moves to the header and footer (one prominent button per view, D-030).

### 4.3 Header, Menu and footer (`apps/web/src/shell/PublicShell.tsx`)

Links: Programmes, Admission, Scholarships, Facilities, Contact, Notices. The school's short name is the Home link. The current page has `aria-current="page"`. Sign in stays a quiet link (or **Dashboard** when signed in, as now).

From tablet width the links sit inline. Below that, one **Menu** button opens a panel of the links: `aria-expanded` and `aria-controls`, closes on Escape and on choosing a link, focus returns to the button, controls at least 44 px, no sideways scroll at 320 px with text at 200%. The footer repeats the page links.

### 4.4 The web pages

Static export, one client component per page, wrapped in `PublicShell` and `ConfigGate`. A shared loader reads `GET /api/site/pages` and gives every page three states: the page's shape as skeletons while loading, a calm retry message on failure (as on the notice board, D-044), and "This page isn't ready yet" when `ready` is false.

Words: generic labels (headings, buttons, "Step 1") go in `apps/web/src/i18n/messages.ts`; the ones the crawler copy shares go in `modules/site/strings.ts`, and `site-strings.test.ts` keeps the two equal. School-specific words come only from the endpoint. Only theme tokens for colour and font. Transform and opacity only for motion.

### 4.5 Crawler copy

Each new page gets a builder in `modules/site/pages.ts` producing the same content as escaped plain markup, with a title, description and structured data. Structured data is built only from what the pack says: an item list of programmes, the admission steps, an item list of facilities, and the address and phones on the organisation. The `geo-schema` skill picks the exact schema.org types when run on staging. When there is no site row, the builder returns the static page unchanged (as the renderer already does when the school is not set up).

## 5. Tests (written before the code)

- **Pack:** both packs parse with a `site` block; unknown keys, over-long text, duplicate programme keys, an unknown programme section and empty steps are rejected.
- **Provision:** applying twice changes nothing; changed text updates the row; the migration runs on a fresh database.
- **API:** the route is public and listed in `PUBLIC_ROUTES`; its output is validated; `{ ready: false }` with no row; cache header set; the OpenAPI contract is current.
- **Crawler, per page:** title, description, canonical, parseable JSON-LD; `<script>` in pack text comes out escaped; the sample school's pages contain no Royal Softech words; staging stays `noindex`.
- **Lists:** boundary check and summary test cover the new addresses; a new test confirms `sitemap.xml` and `llms.txt` list every page.
- **Web:** guards (no hardcoded colours, fonts or words) pass; a markup test per page; loading, error and not-ready states; Menu behaviour (`aria-expanded`, Escape, focus return, current page); `site-strings.test.ts`; the second-theme snapshot.
- **Break on purpose:** remove the escaping, drop a page from `PAGES`, drop the Menu's Escape handler; each must fail a test.

Fees, results, permissions and the audit log are not touched. The permission matrix does not change (the route is public, not an action).

## 6. Reviews

- Design with `ui-ux-pro-max` (smallest searches that fit, no `--persist`); review with `apple-design` and report the guideline pages used, what was fixed and what was left. House rules: one prominent button, 44 px controls, checked at 320 px with text at 200%, page shape while loading.
- After the code is on staging, run the `geo-*` skills (schema, technical, crawlers, `llms.txt`, content, citability) and report their findings.

## 7. Build order

One commit per step, one report at the end, and a fresh-clone replay of the CI steps before calling it green.
1. **3a** Pack schema, migration, provision, read endpoint, with tests. Both packs get their blocks.
2. **3b** Crawler builders and address registration.
3. **3c** Header, Menu, footer and the six web pages.
4. **3d** Design review, `DECISIONS.md` (from D-050), docs and build-plan update, CI replay, staging.

Staging needs the PM's `wrangler deploy` from their own PowerShell after 3d. Provisioning staging with the new block uses the existing provision command and the secrets in `C:\Users\kumar\.school-platform\`; the exact command is given if it has to be the PM.

## 8. `OPEN:` items

- The programme list, phone numbers, admission steps, scholarship policy and facilities are unconfirmed third-party content (`docs/client-profile.md`).
- Whether applying a pack should remove content it no longer lists (D-026): site content is replaced as a whole.
- Programme options (for example +2 Science's subject options) are shown as text only; nothing is modelled (the elective-group question stays open).
