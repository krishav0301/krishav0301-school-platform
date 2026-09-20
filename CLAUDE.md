# School Platform: Claude Code instructions

Read at the start of every session:
1. `docs/DECISIONS.md`. It wins over anything older, including the originals in `docs/source/`.
2. `docs/build-plan.md`. The phases and their order.
3. `docs/source/sample-creation-information.md`. The original domain rules. Its "sample mode", School + College structure and stack sections are **superseded** (see DECISIONS.md). The domain rules in section 6 below are carried over from it.

If this file and `DECISIONS.md` disagree, stop and ask.

**Current phase: Phase 1 (Platform foundation), slices 1 to 6 done** (dates, schema and audit, sign-in, permissions, configuration and packs, design system and shell); slices 7 and 8 remain. Phase 0 is complete: the backend is a Cloudflare Worker (D-019 to D-021), documented in `docs/architecture.md`. Update this line when a phase closes.

## 1. What we are building

A reusable **school platform product**, first configured for **Royal Softech College, Lahan** (Grade 11 and 12, and three four-year bachelor's degrees). Other schools follow: same core, different configuration, theme and domain, a separate deployment each. Under 2,000 users per school, headroom to 5,000.

The owner operates it alone. You are the only developer. Optimize for correctness, simplicity and low operating effort.

## 2. Product model (D-008 to D-010)

Variation is handled in this order. Use the earliest that works: **configure, then template, then theme, then extension, then change the core (for everyone).**

Layers: **core**, **Nepal region pack**, **institution template**, **school configuration**, **theme and site**, **extensions**.

Rules, enforced in CI:
1. The core never names a school and never imports from `packs/`.
2. One build serves every school. Behaviour comes from runtime configuration.
3. **Seam before builder.** Where a variation is already visible, cut an interface and a default now. Build a settings screen only when a second school needs it.
4. Extension interfaces are versioned and contract-tested. Extensions are written by us only. No customer-uploaded code.
5. **Second-school test.** `packs/sample-basic-school` (Nursery to Grade 10, percentage grading, monthly fees, a different theme) runs every flow in CI beside Royal Softech.
6. Portal layout is identical for every school. Slots may add dashboard cards, profile tabs and menu items. Only the public site has layout variants (2 or 3).
7. Two requests for the same extension: promote it to the core.
8. A school is a **pack** (`packs/<school>/pack.json`), applied with `npm run provision`. Packs only add and update, never delete, and are safe to repeat. Only known optional modules and known terms can be changed; mandatory modules cannot be switched off. A theme must pass the contrast check (server-side) before it is saved (D-026).
9. `scripts/check-boundaries.mjs` (CI) enforces rule 1 and that modules do not reach into each other. A route's permission is checked before its body is validated (D-027).

Extension points, version 1: policies (grading, ranking and tie-break, student-ID format, fee billing schedule, promotion, admission rules, attendance rules, approval policy), adapters (payment gateway, SMS, email, file storage), documents (marks card, receipt, certificate, ID card), data and UI (custom fields on Student, Application, Staff; slots), events (after-commit domain events). Some rules stay fixed in the core, such as refunds and reversals always needing Admin approval.

**Demo mode** is a flag, never a separate code path. It enables the persona switcher (logged in the audit trail), a "Sample, fake data" banner, and seed and reset commands. The app refuses to start with demo mode on in production. Demo and test data is loaded through the same service functions the screens use, never direct SQL. Royal Softech's data and branding never appear in demos to other schools.

## 3. How to work

- Follow `docs/build-plan.md` in order. Do not start a later phase without PM approval.
- Work in **small vertical slices**, one flow end to end. Report after each.
- Before building a feature, state the rule and where it is written (`DECISIONS.md` or the source document). If it is not written, ask.
- **Do not decide open points** (section 9). Use the stated default, mark the spot `OPEN:` in code, and list it in the final message.
- Append every decision to `docs/DECISIONS.md`.
- Prefer boring, mainstream libraries. Add a dependency only with a reason. Never write your own crypto, date conversion tables or payment verification.
- Do not add features that are not in the documents. Put suggestions in the final message.
- **Design quality bar: Apple level (D-029).** Every screen and component is designed and reviewed with the `apple-design` skill. See "Design quality" in section 7.
- End every task with: what changed, what you tested, what is not done, and any `OPEN:` items touched.
- **Local state hides CI failures.** Leftover generated files (`.next`, route types) and the development environment made two CI bugs invisible on the first push. When a change touches CI, generated files or settings, replay the workflow steps in a fresh clone of the pushed commit before calling it green. Generated output must not depend on which routes or files happen to exist.

## 4. Stack (D-019, D-021; the Django plan in D-005, D-013, D-015 to D-017 is retired)

- **Runtime:** Cloudflare Workers, TypeScript (strict). **One Worker per school deployment** serves both the static web app (Workers Static Assets) and the API under `/api/`. Same origin, so no CORS and no cross-site cookies.
- **API:** Hono with `@hono/zod-openapi`. Every route is declared through one helper that requires a permission action, or an explicit public flag. Zod validates all input and output. The OpenAPI contract (`apps/api/openapi.json`) is committed, and the web app's typed client is generated from it.
- **Web:** Next.js, strict TypeScript, **static export**. No server components with live data, no rewrites, no Next.js server.
- **Database:** Cloudflare D1 (SQLite), one per school. Migrations are hand-written SQL run with `wrangler d1 migrations`. **No ORM**: write SQL explicitly so round trips stay visible.
  - **One database round trip per request.** Each costs about 100 ms from Nepal. Combine reads with joins or `batch()`.
  - **Atomic changes use one `batch()`**, which is a single all-or-nothing transaction. D1 has no interactive transactions. Approve-and-apply, ledger entries with receipt numbers, and SID assignment each run as one batch, using conditional SQL (`WHERE status = 'pending'`) so a race has exactly one winner.
  - **D1 has no database accounts**, so our own code could remove a guard. Append-only rules use triggers **and** a hash chain (see section 6). Never run schema changes from application code.
  - Free-tier limits to design around: 100,000 rows written and 5,000,000 rows read per day, and a query over the limit fails.
- **Modules:** `core` (config, theme, dates, permissions, crypto, jobs), `accounts`, `admissions`, `academics`, `attendance`, `results`, `fees`, `approvals`, `audit`, `content`, `files`, `notifications`. Each is a folder under `apps/api/src/modules/<name>/` with `routes`, `service` (all writes), `queries` (all reads), `schema`, and tests. Modules call each other's services, never each other's tables. A test enforces the boundaries.
- **Sessions and CSRF (D-021):** same-origin cookies (`__Host-` prefix, HttpOnly, Secure, SameSite=Lax). A signed access token (**30 minutes**, not 10: each renewal is a database write and the free plan allows 100,000 a day) carries the user's roles and scopes. A refresh cookie is an opaque token whose hash is stored in the `sessions` table, rotated on every use, with theft detection (an old token reused after 20 seconds ends the session). Sessions end after 30 days, or 7 days unused. Deactivation and role changes take effect at the next refresh, so **money, approval and publish actions re-check the user's assignments inside their own batch**. After sign-out the access cookie still works until it expires; that is by design and is why those re-checks exist. Sign-in locks an email after 5 failures in 15 minutes (unknown emails too, so lockout reveals nothing) and an address after 30. A throttled attempt writes nothing. Every non-GET request must be same-origin (`Sec-Fetch-Site: same-origin`, or an `Origin` equal to our own), otherwise 403.
- **Passwords:** scrypt (N=2^15, r=8, p=1) through `@noble/hashes`. The runtime caps PBKDF2 at 100,000 rounds, so PBKDF2 is only a fallback. Add lockout and rate limits. The client retries a 503.
- **Jobs:** Cloudflare Queues and Cron Triggers behind `core/jobs`. The outbox row is written in the same batch as the business write, and a job drains it. Handlers are idempotent. Watch cron reliability on the free plan.
- **Files:** private storage behind short-lived signed links. **R2 is not enabled yet (D-020).** Build the storage interface, and hold uploads until the PM says R2 is needed.
- **Documents:** HTML rendered with Cloudflare Browser Rendering. Generate in batches inside one browser session, because the free plan rate-limits browser starts. Embed a self-hosted Noto Sans Devanagari. The database is the record, never the PDF (its text layer is unreliable for Nepali).
- **Hosting:** one free Cloudflare account, one Worker and one D1 database per school. Never introduce servers, Kubernetes, Redis, or a second database per school.
- Excel export through a standard library. BS dates: see section 6.

## 5. Roles and scopes

Six roles: **Student** (parents share the login), **Teacher**, **Co-ordinator**, **Accountant**, **Admin**, **Super Admin**. Admin and Principal are one role.

A role assignment carries a **scope**: the whole institution, or one section (+2 or Bachelor's). Today every Co-ordinator and Accountant has whole-institution scope (D-004). Splitting later is a data change. Ranking (Top 20) and receipt numbering stay keyed per section.

| Role | Scope today |
|---|---|
| Student | Own record only. Read-only |
| Teacher | Own subject assignments. Class Teacher also sees own class |
| Co-ordinator | Whole institution (section scope supported) |
| Accountant | Whole institution (section scope supported) |
| Admin | Whole institution, always |
| Super Admin | Whole institution. Build team. Hidden from the school. Actions shown as "Support" |

**Non-negotiable:**
- One central permission layer, **deny by default**. Every permission is role + action + scope. Never check permissions in individual views.
- The role-and-action matrix lives in one file: `apps/api/src/core/permissions/matrix.ts` (D-025). `docs/permission-matrix.md` is generated from it (`npm run gen:permissions`; CI fails on drift). To add a permission, add a row there, then declare the route with `access: { action: "the.id" }`. A test fails if any route lacks a declared permission, and an unknown action fails when the route is defined.
- **A handler must build its queries from `c.get("grant")`.** The grant says how far the person reaches (`institution`, `sections`, `own`, `assigned`, `classOnly`, `limits`). Use `canAccessSection` / `allowedSections` and always filter by the person's own record for `own`. Never trust an id from the URL alone. Add a data-level test with each module that stores such data (Student A cannot open Student B's record; a +2 person gets nothing from Bachelor's).
- Permission tests come in two kinds and both are required: generated from the matrix, and **independent** rules written by hand from the requirements (a corrupted cell is consistent with itself, so only the independent tests catch it).
- Required tests: Student A cannot open Student B's fees, results, files or receipts. A section-scoped user gets nothing from the other section. Every role tries every sensitive action. Run them under both scope configurations.
- Files are served only after a permission check, through a short-lived signed link.

## 6. Domain rules

**Structure**
- A **Programme** (for example BBS, +2 Science) has an affiliation (NEB, PU, TU) and an ordered list of **levels**. +2: Grade 11, Grade 12. Bachelor's: Year 1 to Year 4. A **Class** is academic year + programme + level + optional section label (for example Morning or Evening). Each level is one academic year, assessed by terminals (D-006).

**Student and years**
- The **Student** is permanent (SID, personal details, guardians, documents). The yearly **Enrollment** (student, academic year, class) holds attendance, marks, fees, submissions and receipts. Never attach year data directly to Student.
- A closed year rejects all writes. Corrections are **new entries in the current year** that point back.
- SID = admission year + sequence, for example `2083-00123`. One sequence for the institution, assigned at approval, never changes, never editable. Increment the counter and create the student in one batch (D1 serialises writes). Class and roll number belong to the enrollment.
- No hard deletes. Deactivate or archive.
- Left or Graduated only with **zero dues**.

**Admissions**
- Only the **Co-ordinator** approves students. Walk-ins the Co-ordinator registers are auto-approved. Rejection is final. "Ask for changes" is the fix-it path.
- Duplicate check on phone, or name plus date of birth.
- "Referred by (if any)" is an optional free-text box.

**Fees and money**
- The balance is **never stored**. It is the sum of an **append-only ledger** (charge, discount, payment, reversal, refund, carried dues). Append-only is enforced by triggers **and** a hash chain: each row stores a hash of the previous row, so an edit is detectable even if a guard is removed. A daily export of the chain is copied to a second location.
- Money is **whole paisa integers**. Never floats or decimals. Currency NPR, shown with Nepali grouping (12,50,000).
- A payment is never edited or deleted. Mistakes are reversed. Reversals and refunds are new entries pointing to the original.
- Payments apply to the oldest due first. Partial payments allowed. Late fees are out of scope.
- The gateway reference is unique, so repeated callbacks cannot double-credit.
- Receipts come from a gapless sequence per section and year (a counter row incremented in the same batch as the payment, so a failed payment rolls the number back), are generated from the ledger, and are never edited.
- The Accountant owns fees. The Co-ordinator has **no Fees view**. The Accountant's student profile shows only Personal and Fees.

**Approvals (Admin)**
- Five types: website content, yearly fee structure, discount, payment reversal, refund. Any one Admin can approve.
- Approve-and-apply is **one batch** (all or nothing) with a conditional update, so a race has exactly one winner. A second click or retry returns "already resolved". Nothing is applied twice.
- A request goes stale if what it refers to changes. Nobody approves their own request.

**Attendance**
- Students: once a day, by the class's Class Teacher, Present or Absent only. Same-day edits only. No in and out times.
- Teachers: marked by the Co-ordinator in a daily list pre-filled Present. Past days are editable with a reason recorded.

**Marks and results**
- Marks are entered per component in a bulk grid. Teachers can edit until the Co-ordinator verifies.
- Statuses: Draft, Under review, Verified, Published. Results publish for a **whole class per terminal**, and Publish stays disabled until every subject is Verified.
- Grading is a **per-programme grading policy**: marks to grade to GPA or percentage, the pass rule, the rank rule. +2 follows NEB: subject-wise letter grades and a credit-hour-weighted GPA, no total (verify the exact scale against NEB sources before coding). A class with no policy cannot be published. A policy change affects only unpublished results.
- Published marks cards are **snapshots**.
- Top 20: name and rank only for students, ranked **per section**, only after the class is published.

**Audit**
- Insert-only audit log: triggers block update and delete, and a keyed hash chain (HMAC-SHA256 with the `AUDIT_HMAC_KEY` Worker secret, never stored in the database) makes any edit, or any insert or delete in the middle, detectable, because D1 has no database accounts. Deleting the newest entries together with the chain head is caught only by the daily export of `auditChainSummary`. Append with `recordAudit`, in the same batch as the change, and verify with `verifyAuditChain`. No update or delete for anyone, including Super Admin. Every service write emits an audit event in the same batch. Sign-ins and failed 2FA go in a separate Sign-ins view.

**Dates**
- Store **AD** dates. Show and accept **BS** everywhere. One date module owns all conversion.
- Timestamps in UTC, shown in Nepal time (UTC+5:45). Day boundaries use Nepal midnight.
- The week is Sunday to Friday. Saturday is the weekly holiday.
- Never generate BS conversion data from memory. Convert inside the date module only, and only for **verified BS years** (a list, currently 2000 to 2083). Beyond that the libraries disagree, so refuse the conversion and block entering dates in unverified years (D-014, `docs/spikes/bs-dates.md`). The converter is `@inicrea/bikram-sambat-core`, **pinned to exactly 0.1.3** (D-022). A golden test (`apps/api/test/fixtures/bs-golden.json`) reproduces every day of BS 2000 to 2083 and fails if an upgrade changes an answer. Use only `apps/api/src/core/dates`. BS 2062 Baisakh 31 to Jestha 31 is a disputed stretch: `conversionConfidence()` flags it, and a date of birth there is confirmed against the certificate. Never import the library elsewhere.

## 7. Security, reliability and quality

- Validate all input. Rate-limit and lock out logins and OTPs. Rate-limit the "email already taken" check.
- Signup is the only anonymous write path: rate limiting, CAPTCHA or similar, a submission token against double submits, email verification before the application enters the queue, strict upload limits, temporary storage with cleanup.
- Uploads: check type by content, rename on save, 20 MB limit (PDF, DOC, DOCX, JPG, PNG), serve from a separate storage domain.
- Notes and question papers: soft protection only (watermark with student name and ID, right-click and print disabled). Never claim it is a hard guarantee.
- Staff 2FA by SMS (codes expire in minutes, remember device 30 days, email fallback). Super Admin uses an authenticator app.
- Important operations are idempotent (idempotency keys), transactional and have defined failure states. Ask: "What if the server finishes but the user never gets the response?"
- Notifications: one record per event, recipient and channel with a unique key, sent from a background job with retry. SMS only for 2FA codes, account approved, fee overdue and results published. Absence alerts are in-app only, with a per-event switch. Keep SMS templates very short.
- All UI text goes through a **translation catalog**. Do not build the Nepali toggle yet.
- UI is built from theme tokens only. **No hardcoded colours or fonts** (a web test fails the build if one appears; see D-028). Words live in `apps/web/src/i18n/messages.ts`, never in components. Host fonts ourselves. Mobile-first, low page weight, readable contrast, visible keyboard focus. Animate transform and opacity only, and respect reduced motion.

**Design quality: Apple level (D-029)**
The PM's standard is that this product looks and feels like Apple made it: calm, precise, generous spacing, clear hierarchy, considered motion, nothing decorative that does not help. Use the `apple-design` skill (`.claude/skills/apple-design/`) through the whole build, not once at the end.
- **When:** before designing or changing any screen or component, and again before calling a UI slice done. This covers the public website, the portals, forms, emails and printed documents (receipts, marks cards).
- **How:** load the skill, then its always-load pages (accessibility, layout, typography, colour) and the pages for what is on screen. Read a page before citing it. In the final message of a UI slice, include a short review: what was checked, which guideline pages were used (`file.md › Heading`), what was fixed, what was left and why.
- **Translate, do not copy.** The guidelines are written for apps. Apply their principles to a responsive website (touch targets of 44 px, clear focus, dynamic text size, reduced motion, dark appearance, plain language, one primary action per screen). Do not imitate Apple's look literally, and do not use Apple's logos, SF fonts or icons.
- **What still wins over the skill:** a school's own brand comes from its theme and packs (D-008, D-026); the readability and contrast rules enforced by tests; the no-hardcoded-colours, fonts and words rules; the permission and security rules; the phased plan. If the skill conflicts with one of these, keep the rule and note it in the review.
- **The skill is installed per developer, not committed** (it reproduces Apple's text, so `.claude/skills/apple-design/` is git-ignored). To install it: clone https://github.com/dickwu/apple-design-skill, copy `SKILL.md` and `references/` into `.claude/skills/apple-design/`, and do not run its refresh script. If it is missing, say so and ask the PM before continuing UI work.
- **House rules from review 1 (D-030):** one prominent button per view; the brand colour means "you can act on this", so labels and notices never use it; brand-colour text (links, quiet buttons) needs 4.5:1; controls are at least 44 px; every screen is checked at 320 px wide with text enlarged to 200% (no sideways scroll, no mid-word breaks); a menu of one entry is not shown; show the shape of a page while it loads, not a lone spinner.
- Design changes must not weaken the tests: a new component still passes the guards in `apps/web/test/guards.test.ts` and gets a markup test.

**Testing (required before a slice is done)**
- Tests **before** code for the ledger, discounts, reversals, refunds, grading, year locks and approvals. Use property-based tests for ledger invariants.
- Permission matrix tests and cross-scope tests on every change.
- Failure paths: duplicate submit, repeated callback, interrupted upload, stale approval.
- The second-school test and the second-theme snapshot test.
- Migrations are backward compatible. Release order: staging, then the test school, then real schools.

## 8. Operations (production)

- The operator is not on call. Prefer managed services and boring choices.
- Build in: error tracking, uptime monitoring, alerts to a named person, staging, a daily export of the database and the hash chain to a second location (D1 Time Travel restores the last 30 days), and a quarterly restore drill.
- Money never touches the operator. The gateway merchant account is in the school's name.
- If a change affects fees, results, permissions or the audit log, say so at the top of the final message and list the tests that cover it.

## 9. Open points: do not decide, use the default, mark `OPEN:`

| Topic | Default |
|---|---|
| Payment gateway, merchant account | Not built. Interface and demo adapter only |
| +2 to Bachelor's move: dues | Must be zero |
| Optional subjects (+2 Science options, BSc specialisations) | Not modelled until PM approves the elective-group recommendation |
| Semester vs year for bachelor's | Yearly with terminals (D-006) |
| NEB rank tie-break | Tied students share a rank |
| Recheck notification threshold | Notify Admin on every post-publish change, with a required reason |
| Top 20 visible to other students | Shown, name and rank only |
| View-only trustee role | Not built. All Admins approve |
| Academic year start month, holidays | Config placeholders |
| Discount reasons | Scholarship, Sibling, Staff child, Other |
| Refund rules | Every refund needs Admin approval |
| Attendance alert threshold | 75% placeholder |
| Homework retention | One year after the year closes |
| Programme and stream names | Working list in `docs/client-profile.md`, unconfirmed |
| Admission documents | One certificate upload until PM approves multiple typed documents |
| File uploads and R2 | Not enabled (D-020). Build the storage interface only; no uploads until PM says R2 is needed |
| Disputed BS 2062 stretch | Flagged, not hidden. BS 2083 is verified against Hamro Patro. Verify BS 2084 before extending the range |

## 10. Out of scope

OCR marks entry, facial-recognition attendance, a separate parent login, a gallery, a public enquiry form, malware scanning, late fees and fines, a generic workflow engine, per-school portal layouts, Nepali translation, real gateway integration before Phase 9, and anything not in the documents.

## 11. Definition of done

A slice is done when: the rule is implemented as written, the section 7 tests pass, any UI in it has had its Apple-level design review (section 7), permissions are covered by the matrix, the second-school test passes, `docs/DECISIONS.md` is updated, no open point was decided silently, and the final message lists what is not done.
