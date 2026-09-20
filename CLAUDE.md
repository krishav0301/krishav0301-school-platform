# School Platform: Claude Code instructions

Read at the start of every session:
1. `docs/DECISIONS.md`. It wins over anything older, including the originals in `docs/source/`.
2. `docs/build-plan.md`. The phases and their order.
3. `docs/source/sample-creation-information.md`. The original domain rules. Its "sample mode", School + College structure and stack sections are **superseded** (see DECISIONS.md). The domain rules in section 6 below are carried over from it.

If this file and `DECISIONS.md` disagree, stop and ask.

**Current phase: Phase 0 (Groundwork).** Update this line when a phase closes.

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
- End every task with: what changed, what you tested, what is not done, and any `OPEN:` items touched.
- **Local state hides CI failures.** Leftover generated files (`.next`, route types) and the development environment made two CI bugs invisible on the first push. When a change touches CI, generated files or settings, replay the workflow steps in a fresh clone of the pushed commit before calling it green. Generated output must not depend on which routes or files happen to exist.

## 4. Stack (D-005)

- **Backend:** Django, Django REST Framework, OpenAPI schema. **PostgreSQL only, in development too.** Never SQLite: locks, triggers and constraints behave differently.
- **Frontend:** Next.js (App Router), strict TypeScript, a typed API client generated from the OpenAPI schema. One domain, so cookies are same-site.
- **Modular monolith.** Modules: `core` (config, theme, dates, permissions), `accounts`, `admissions`, `academics`, `attendance`, `results`, `fees`, `approvals`, `audit`, `content`, `files`, `notifications`. Each has `models`, `services` (all writes), `selectors` (all reads), `api`, `tests`. Modules call each other's services, never each other's tables.
- Background jobs run from a **PostgreSQL-backed queue**. No Redis.
- Files go to **private object storage** behind short-lived signed links. A CDN serves public pages only.
- Managed hosting, region Mumbai or Singapore, one deployment per school with its own database, storage, domain and configuration.
- Excel and PDF through standard libraries. BS dates through a vetted library or table only.
- Never introduce microservices, Kubernetes, sharding, multiple databases, or event infrastructure beyond the Postgres outbox.
- **Sessions and CSRF (D-016):** every API route ends in a slash (the web proxy adds it). Set `CSRF_TRUSTED_ORIGINS` to the web origin in every environment. Never set `USE_X_FORWARDED_HOST`. The web client re-reads the `csrftoken` cookie on every request, because login rotates it. Server-side calls must forward the session cookie explicitly.
- **Jobs (D-015):** Procrastinate behind `core.jobs`. Write the outbox event in the same transaction as the business write, and drain it from a job.
- **Documents (D-017):** HTML rendered by Chromium with a self-hosted Noto Sans Devanagari. The database is the record, never the PDF.

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
- The role-and-action matrix lives in one file. Generate permission tests from it. A test fails if any route lacks a declared permission.
- Required tests: Student A cannot open Student B's fees, results, files or receipts. A section-scoped user gets nothing from the other section. Every role tries every sensitive action. Run them under both scope configurations.
- Files are served only after a permission check, through a short-lived signed link.

## 6. Domain rules

**Structure**
- A **Programme** (for example BBS, +2 Science) has an affiliation (NEB, PU, TU) and an ordered list of **levels**. +2: Grade 11, Grade 12. Bachelor's: Year 1 to Year 4. A **Class** is academic year + programme + level + optional section label (for example Morning or Evening). Each level is one academic year, assessed by terminals (D-006).

**Student and years**
- The **Student** is permanent (SID, personal details, guardians, documents). The yearly **Enrollment** (student, academic year, class) holds attendance, marks, fees, submissions and receipts. Never attach year data directly to Student.
- A closed year rejects all writes. Corrections are **new entries in the current year** that point back.
- SID = admission year + sequence, for example `2083-00123`. One sequence for the institution, assigned at approval, never changes, never editable. Use a locked counter row. Class and roll number belong to the enrollment.
- No hard deletes. Deactivate or archive.
- Left or Graduated only with **zero dues**.

**Admissions**
- Only the **Co-ordinator** approves students. Walk-ins the Co-ordinator registers are auto-approved. Rejection is final. "Ask for changes" is the fix-it path.
- Duplicate check on phone, or name plus date of birth.
- "Referred by (if any)" is an optional free-text box.

**Fees and money**
- The balance is **never stored**. It is the sum of an **append-only ledger** (charge, discount, payment, reversal, refund, carried dues). Append-only is enforced by a database trigger.
- Money is **whole paisa integers**. Never floats or decimals. Currency NPR, shown with Nepali grouping (12,50,000).
- A payment is never edited or deleted. Mistakes are reversed. Reversals and refunds are new entries pointing to the original.
- Payments apply to the oldest due first. Partial payments allowed. Late fees are out of scope.
- The gateway reference is unique, so repeated callbacks cannot double-credit.
- Receipts come from a gapless sequence per section and year (locked counter), are generated from the ledger, and are never edited.
- The Accountant owns fees. The Co-ordinator has **no Fees view**. The Accountant's student profile shows only Personal and Fees.

**Approvals (Admin)**
- Five types: website content, yearly fee structure, discount, payment reversal, refund. Any one Admin can approve.
- Approve-and-apply is **one transaction** with a row lock. A second click or retry returns "already resolved". Nothing is applied twice.
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
- Insert-only audit log, enforced by database privileges: no update or delete for anyone, including Super Admin. Every service write emits an event in the same transaction. Sign-ins and failed 2FA go in a separate Sign-ins view.

**Dates**
- Store **AD** dates. Show and accept **BS** everywhere. One date module owns all conversion.
- Timestamps in UTC, shown in Nepal time (UTC+5:45). Day boundaries use Nepal midnight.
- The week is Sunday to Friday. Saturday is the weekly holiday.
- Never generate BS conversion data from memory. Convert with `nepali-datetime` inside the date module, and only for **verified BS years** (a list, currently 2000 to 2083). Beyond that the libraries disagree, so refuse the conversion and block entering dates in unverified years (D-014, `docs/spikes/bs-dates.md`). Test month and year boundaries and the round trip.

## 7. Security, reliability and quality

- Validate all input. Rate-limit and lock out logins and OTPs. Rate-limit the "email already taken" check.
- Signup is the only anonymous write path: rate limiting, CAPTCHA or similar, a submission token against double submits, email verification before the application enters the queue, strict upload limits, temporary storage with cleanup.
- Uploads: check type by content, rename on save, 20 MB limit (PDF, DOC, DOCX, JPG, PNG), serve from a separate storage domain.
- Notes and question papers: soft protection only (watermark with student name and ID, right-click and print disabled). Never claim it is a hard guarantee.
- Staff 2FA by SMS (codes expire in minutes, remember device 30 days, email fallback). Super Admin uses an authenticator app.
- Important operations are idempotent (idempotency keys), transactional and have defined failure states. Ask: "What if the server finishes but the user never gets the response?"
- Notifications: one record per event, recipient and channel with a unique key, sent from a background job with retry. SMS only for 2FA codes, account approved, fee overdue and results published. Absence alerts are in-app only, with a per-event switch. Keep SMS templates very short.
- All UI text goes through a **translation catalog**. Do not build the Nepali toggle yet.
- UI is built from theme tokens only. **No hardcoded colours or fonts.** Host fonts ourselves. Mobile-first, low page weight, readable contrast, visible keyboard focus. Animate transform and opacity only, and respect reduced motion.

**Testing (required before a slice is done)**
- Tests **before** code for the ledger, discounts, reversals, refunds, grading, year locks and approvals. Use property-based tests for ledger invariants.
- Permission matrix tests and cross-scope tests on every change.
- Failure paths: duplicate submit, repeated callback, interrupted upload, stale approval.
- The second-school test and the second-theme snapshot test.
- Migrations are backward compatible. Release order: staging, then the test school, then real schools.

## 8. Operations (production)

- The operator is not on call. Prefer managed services and boring choices.
- Build in: error tracking, uptime monitoring, alerts to a named person, staging, automated backups with point-in-time recovery, and a quarterly restore drill.
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

## 10. Out of scope

OCR marks entry, facial-recognition attendance, a separate parent login, a gallery, a public enquiry form, malware scanning, late fees and fines, a generic workflow engine, per-school portal layouts, Nepali translation, real gateway integration before Phase 9, and anything not in the documents.

## 11. Definition of done

A slice is done when: the rule is implemented as written, the section 7 tests pass, permissions are covered by the matrix, the second-school test passes, `docs/DECISIONS.md` is updated, no open point was decided silently, and the final message lists what is not done.
