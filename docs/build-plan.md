# Build plan: reusable school platform

Status: **approved by PM 2026-09-20 (D-012). Phases 0 and 1 complete (2026-09-21). Phase 2 approved 2026-09-21 (D-038), slices to be confirmed with the PM.** Decisions it rests on are in `DECISIONS.md`.

## Where we are, and how to start the next session (updated 2026-09-21)

**Done (Phases 0 and 1: the foundation).** A reusable school platform on Cloudflare's free plan: one Worker per school serves the static Next.js site and the API on one origin, with one D1 database. Built and tested (590 API tests, 108 web tests, CI green on GitHub):
- **Accounts and security:** six roles with a permission matrix (61 actions, deny by default, generated docs); sign-in with lockout, rotating sessions and theft detection; password reset by emailed link; authenticator-app two-step sign-in for the Super Admin (recovery codes, reset by another Super Admin); passwords may not contain the school's name; a keyed, tamper-evident activity log.
- **The product model:** a school is a "pack" (`packs/<school>/pack.json`: name, sections, optional modules, wording, theme) applied with `npm run provision`. Royal Softech and a deliberately different sample school both run through the same flows in tests. Themes must pass a server-side readability check.
- **Interface:** design system and portal shell driven by the school's theme (colours, font, radii, wording), sign-in, reset and two-step screens, `/design` gallery. Apple-level design review 1 done and applied (D-030). Tests fail the build on hardcoded colours, fonts, words, or non-transform motion.
- **Infrastructure:** BS date module (verified 2000 to 2083); notifications and jobs (outbox, sealed payloads, dev email adapter, 5-minute cron sweep); operator tooling (`provision`, `dev:user --remote` for the first Super Admin, a wrangler D1 shim).
- **Staging:** https://school-platform-staging.k-rishav0301.workers.dev, Royal pack, six test users (one per role). Secrets are in `C:\Users\kumar\.school-platform\`, outside the repo.

**Next: Phase 2, the public website and content (5 to 7 working days).** Home, the nine programmes, admission process, scholarships, facilities, contact; content types Notice, Holiday, Routine, Vacancy and Post with expiry; cached pages purged on publish; the Admin edits content directly (drafts and approval arrive in Phase 3). **Exit:** Royal's public site on staging with editable content and page-weight budgets met. It is the first visible product and the first place design choices matter most.

**Answered 2026-09-21 (D-038):** 1 approved; 2 no brand assets, use the placeholder; 3 fonts approved; 4 text and design only, R2 stays held; 5 programme list stays a placeholder; 6 Admin two-step sign-in is required (QR code and pack-removal left open). The list below is kept for the record.

**Before starting Phase 2, get the PM's answer to:**
1. Approve starting Phase 2.
2. Brand assets: has the client sent a logo, colours or photos? (Until then: a neutral wordmark and restrained accent; nothing is taken from their Facebook page without approval, D-007.)
3. Fonts: approval to download and self-host Inter and Noto Sans (and Noto Sans Devanagari). Until then the site uses each device's own font.
4. Photos and files: R2 is held (D-020), so the public site is text and design only unless the PM turns R2 on (it probably needs a card).
5. Content: the programme and stream list is third-party and unconfirmed (`docs/client-profile.md`); Phase 2 uses it as a placeholder marked `OPEN:`.
6. Small pending decisions: Admin required to use two-step sign-in (D-036); a QR code on 2FA setup; whether applying a pack should remove settings it no longer lists (D-026 open item).

**Phase 2 progress (2026-09-21):** slice 0 (Admin two-step sign-in) built, D-038. Slice 1 (content model and cached public read API) built, D-039: 637 API tests and 108 web tests pass. Not yet committed or deployed to staging. Slice 2 (Admin content routes, D-040; Admin screens and BS date conversion, D-041) is built and tested (683 API tests, 173 web tests) but still needs a person to try the screens in a browser, the `apple-design` review, and a staging deploy before it is called done.

**How to run Phase 2 (rules already in `CLAUDE.md`):** design with `ui-ux-pro-max`, review with `apple-design` (report the review), run the matching `geo-*` skill for each public-site slice (schema, technical, crawlers, `llms.txt`, content, citability; D-031), use the code graph before scanning files (D-033), tests before code, break the code on purpose to check the tests, report after each slice. Suggested slices (to confirm with the PM): 1 content model and the cached public read API; 2 Admin editing screens; 3 public pages (Home, Programmes, Admissions, Scholarships, Facilities, Contact) built from theme tokens and the message catalog; 4 notices, holidays, routine, vacancies and posts with expiry; 5 design and GEO pass, page-weight budgets, staging exit check.

**Practical notes for the next session:** stop `wrangler dev` and `next dev` before `npm run build` in `apps/web` (Windows locks `out`); write patch scripts with the Write and Edit tools, not `sed` or `node -e` with regexes (backslashes are lost); the web tests import API code, so the web CI job installs API packages too; `gh` is at `C:\Program Files\GitHub CLI\gh.exe`.

### Phase 0 progress

- [x] Rewrite `CLAUDE.md`; decisions log; client profile; build plan
- [x] Python (via `uv`) and PostgreSQL 17 installed and working
- [x] Git repo initialised and pushed to the private GitHub repo `krishav0301/krishav0301-school-platform`
- [x] ~~Django API skeleton~~ retired 2026-09-20 (D-019); still in git history
- [x] Worker API skeleton (Hono, D1): deny-by-default routes, route-coverage test, same-origin rule for writes, demo-mode guard, health check, committed OpenAPI contract; 25 tests in the Workers runtime
- [x] Next.js static export served by the same Worker on one origin, typed client generated from the contract
- [x] CI workflow. First run on GitHub failed (two real bugs: unpinned OpenAPI tag, missing Next.js route types on a clean checkout). Fixed in 415d7cd. Green on GitHub's Linux runners (api and web jobs) since that commit
- [x] Spike: BS dates (`spikes/bs-dates.md`)
- [x] Spike: Postgres-backed job queue (`spikes/job-queue.md`): Procrastinate
- [x] Spike: session and CSRF through the Next.js proxy (`spikes/session-csrf.md`): works with trusted origins; token rotates at login
- [x] Spike: PDF with Devanagari (`spikes/pdf-devanagari.md`): renders correctly; real-viewer check owed in Phase 6
- [x] `data-model.md` and `permission-matrix.md` drafts (independent of hosting; awaiting PM review)
- [x] Spike: all-Cloudflare backend (`spikes/cloudflare-test.md`): passed with caveats; D-019 recommends replacing the Django backend, awaiting PM approval
- [x] `architecture.md` written (API conventions are in `CLAUDE.md` and `README.md`)
- [x] Cloudflare account created by PM (free, no card); tooling logged in
- [x] Staging "hello" deploy of the real Worker: static page, API and real D1 answer on Cloudflare; a forged cross-site write is refused (403)
- [x] **Phase 0 complete.** Phase 1 next

## How we build

1. **Foundation first, then easy and visible, then hard, paid integrations last.** Where a hard piece is a dependency of an early one (permissions, audit, approvals, dates), it is built early in its smallest generic form.
2. **Every phase ends running on staging**, with tests, updated docs, and the second-school fixture (D-009) green. The PM sees each phase working before the next starts.
3. **Tests before code** for permissions, approvals, the fee ledger, grading, and year locks.
4. **Apple-level design** (D-029). Each phase that ships screens ends with a review using the `apple-design` skill, reported with the phase.
5. **Seam before builder** (D-008). Interfaces and defaults now; settings screens only when a second school needs them.
6. **Paperwork for paid parts starts now**, even though the integration lands last (see "Start now").

**Estimates** are working days, rough (about plus or minus 40%). They assume the PM reviews within a day and the client answers on time. Recalibrate after Phase 1, when we know our real pace.

## Phases

| # | Phase | Days | Why here |
|---|---|---|---|
| 0 | Groundwork | 2-3 | Decisions, toolchain, repo, spikes |
| 1 | Platform foundation | 8-10 | Everything else stands on it |
| 2 | Public website and content | 5-7 | Easy, visible, no dependencies beyond Phase 1 |
| 3 | Academic setup, people, approvals | 5-7 | Prerequisite for every student record |
| 4 | Admissions and student record | 6-8 | First real use. **Release A** |
| 5 | Daily school life | 7-9 | Easy, self-contained, daily value. **Release B** |
| 6 | Fees and ledger | 8-10 | Hard. Rules are already settled |
| 7 | Results | 8-12 | Hard. Waits for client answers, so it goes later |
| 8 | Year lifecycle | 5-7 | Needs fees and results. **Release C** |
| 9 | Paid integrations | 6-10 + lead time | Payment gateway, SMS, email, monitoring |
| 10 | Production readiness and go-live | 6-8 | Security, backups, import, training. **Release D** |
| 11 | Productisation | after live | Second school, Nepali toggle |

Total to Royal live: about 66-91 working days, roughly 13-18 weeks. Release A is at about week 5-7.

### Phase 0: Groundwork
- Rewrite `CLAUDE.md` for the product. Write `architecture.md`, `data-model.md`, a permission-matrix draft, API conventions.
- Install Python (via `uv`) and PostgreSQL. `git init`, private repo, monorepo skeleton, CI skeleton, hosting accounts.
- Time-boxed spikes (about half a day each): BS date libraries against an official calendar; Postgres-backed job queue; Next.js to Django cookie auth on one domain; PDF generation with Devanagari.
- **Exit:** docs approved, both apps deployed as "hello" on staging.

### Phase 1: Platform foundation

**Progress** (slices, each ends with tests and a report):
- [x] 1. BS date module: verified years only, disputed stretch flagged, Nepal midnight. Golden test over 30,681 days (D-022)
- [x] 2. Migrations and the base D1 schema (school, sections, users, role assignments, audit, outbox); keyed audit hash chain with tamper tests, checked on a real D1 database (D-023). Sessions come with slice 3
- [x] 3. Passwords (scrypt), sign-in, sign-out, refresh with theft detection, lockout and throttling, sign-in log (D-024). Password reset comes with slice 7
- [x] 4. Permission layer: matrix in code with the document generated from it, deny by default (401/403), grants for handlers, tests for every role and action under both scope settings, plus independent rules (D-025)
- [x] 5. School configuration, theme with server-side contrast check, packs (Royal Softech, sample basic school), provisioning command, layer-boundary check in CI (D-026, D-027)
- [x] 6. Design system and app shell: tokens from the theme, components, portal and public shells, sign-in page, session renewal, live theme swap, rules enforced by tests (D-028). First Apple-level design review done and applied (D-030)
- [x] 7. Notifications and jobs (outbox runner, sealed payloads, email adapter, cron sweep; D-034), password reset (D-035), authenticator-app 2FA for the Super Admin with recovery codes and reset (D-036), school-name password rule
- [x] 8. Exit check: every role signs in; wrong role or section is denied; live theme swap; both packs boot; staged (automated for both packs, and run on staging; D-037)
- [x] **Phase 1 complete (2026-09-21).** 590 API tests, 108 web tests, CI green. Phase 2 (public website) awaits PM approval
- **Chassis:** module skeleton, API conventions (idempotency keys, one error format), OpenAPI to typed TypeScript client, CI gates (lint, types, import boundaries, every route declares a permission).
- **Identity and access:** email and password, sessions, lockout, password reset, TOTP 2FA, role assignments carrying a scope (D-004), permission matrix with generated tests.
- **Trust layer:** insert-only audit log, transactional event outbox, notifications framework (in-app and email), job queue, file storage with signed links.
- **Configuration and packs:** school config, Nepal region pack, institution templates, module switches, terminology catalog, extension-point registry, `packs/royal-softech`, `packs/sample-basic-school`, provisioning command.
- **Dates:** BS module chosen by the spike.
- **Design system:** tokens, theme service with contrast check, core components, app shell, motion rules, second-theme snapshot test, accessibility baseline.
- **Exit:** log in as each role; a wrong-role or wrong-section request is denied; live theme swap; both packs boot; CI green; deployed to staging.

### Phase 2: Public website and content
Home, programmes (9), admission process, scholarships, facilities, contact. Content types Notice, Holiday, Routine, Vacancy, Post with expiry. Cached pages purged on publish. Admin edits directly; Co-ordinator drafts and approval arrive in Phase 3.
**Exit:** Royal's public site on staging with editable content and page-weight budgets met.

### Phase 3: Academic setup, people and approvals
Academic years, sections, programmes and levels, classes, subjects with mark components, elective groups, terminals. Admin creates Co-ordinators and Accountants; Co-ordinator creates teachers, teacher assignments and Class Teachers. Co-ordinator setup checklist. Apply the "+2 and Bachelor's" template. The **generic approvals engine** and Admin inbox, first used for website content.
**Needs from client:** programme and subject list, staff list.

### Phase 4: Admissions and student record
Public multi-document application, email verification, rate limits and CAPTCHA, duplicate check. Co-ordinator review: approve, ask for changes, reject; walk-ins. SID, Student and Enrollment, student login and profile, search. Upload hardening and cleanup jobs.
**Release A (soft launch):** public site plus online admissions. This is real applicant data about minors, so a mini go-live checklist comes first: backups running, error alerts, privacy notice and consent text, a Nepal Privacy Act check.

### Phase 5: Daily school life
Student attendance by the Class Teacher, teacher attendance by the Co-ordinator, percentage and threshold alerts, daily activity log, notes and question papers with soft protection, homework and assignments (deadline, late flag, review, resubmission), role dashboards, related reports.

### Phase 6: Fees and ledger
Tests first. Fee structure with Admin approval, charge generation through the billing-schedule policy, append-only ledger, voucher queue, cash entry, gapless receipts with PDF, discounts, reversals, refunds, previous dues, dues list, overdue reminders, payment-attempt model and gateway interface with a demo adapter, fee reports and Excel export.
**Needs from client:** fee structure, discount reasons (including the scholarship), refund rules, what "course-wise" means.

### Phase 7: Results
Grading policies (NEB credit-weighted GPA, percentage and division), bulk marks grid with draft-save, verify workflow, publish per class with gating, snapshot marks cards (2-3 templates), Top 20 with a tie-break rule, recheck, whole-class sheet, student result view, results-day load test.
**Needs from client:** grading and ranking rules, optional subjects, year versus semester, components and maximum marks, marks-card format.

### Phase 8: Year lifecycle
Year rollover (Promote, Repeat, Leaving), closed-year locks tested on every write path, previous dues, Left and Graduated with zero dues, waive-dues flow, +2 to Bachelor's handover, reactivation.

### Phase 9: Paid integrations
Payment gateway with server-side confirmation, reconciliation job and exceptions screen. SMS provider (2FA, approvals, overdue, results published) with budget alert. Production email, error tracking, uptime, CDN.
**Needs:** the school's merchant account, an SMS vendor, gateway sandbox access.

### Phase 10: Production readiness and go-live
Security review, backups with point-in-time recovery and a restore drill, monitoring and a runbook, accessibility and low-end phone pass, load test, import tooling for existing students, balances and results, release order staging then test then production, training material, switch-over plan.

### Phase 11: Productisation
Second real school through the provisioning command, review of extensions used, promote repeated requests to core, Nepali toggle, pricing and operations pack.

## Dependencies

Foundation, then Academic setup, then Admissions, then the student record. From there Daily life, Fees and Results can proceed, Year lifecycle needs Fees and Results, and Integrations come last. Public site depends only on the foundation.

## Start now (paperwork with lead time)

- Payment gateway: Royal begins the merchant account in the school's name; pick eSewa, Khalti or Fonepay.
- SMS vendor quotes, including Devanagari billing. Verify prices.
- Domain name, sending domain for email, hosting accounts, private GitHub repo.
- Client answers: grading and ranking rules, optional subjects, year versus semester, fee structure, exact +2 streams.
- Contract: reuse and IP clause, data ownership, what "yearly" includes.

## Top risks

1. Late client answers block Phases 6 and 7.
2. Two-stack complexity (cookie auth across Next.js and Django, deploys). Mitigation: Phase 0 spike and a staging hello.
3. BS calendar correctness. Mitigation: spike against an official calendar, tests on month boundaries.
4. Abstractions guessed from one school. Mitigation: narrow interfaces, second-school fixture, review after school two.
5. Vendor lead times for gateway and SMS.
6. PDF and Devanagari rendering for receipts and marks cards.
7. Scope creep once the client sees progress. Mitigation: the out-of-scope list, and a change log in `DECISIONS.md`.

## Toolbox (proposed, confirmed in Phase 0)

Django with Django REST Framework and OpenAPI schema; PostgreSQL; a Postgres-backed queue (Procrastinate is the candidate); Next.js App Router with strict TypeScript; CSS-variable design tokens with accessible primitives; pytest and Hypothesis for the ledger; Playwright and axe for browser and accessibility tests; ruff, type checking and import-linter to enforce module boundaries.

## Out of scope for V1

OCR marks entry, facial-recognition attendance, a separate parent login, a gallery, a public enquiry form, malware scanning, late fees, a workflow engine, per-school portal layouts, real-time chat.
