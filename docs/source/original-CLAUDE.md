# School Platform: Claude Code Instructions

Read `docs/sample-creation-information.md` before starting any task. It is the source of truth for decisions. If this file and that document disagree, stop and ask.

## 1. What we are building

A school management platform for a Nepal-based institution with a **School** (Nursery to Grade 10) and a **College** (Grade 11 and 12, three faculties). Under 2,000 users, with headroom to 5,000. It will be sold to other schools later: same features, a different look, a separate domain and a separate deployment for each school.

The owner is one person who will also operate it. You are the only developer. Optimize for correctness, simplicity and low operating effort.

## 2. Two modes: check which one you are in

**Sample mode** (a clickable prototype for a sales pitch):
- No real backend, no real login, payments, SMS or file uploads. Fake data held in memory. A role switcher jumps between all roles. Refresh resets everything.
- Every screen shows a visible "Sample, fake data" label.
- English only. BS dates only.
- Hard-code BS dates in the fake data. Never calculate BS dates.
- The code is **throwaway**. Do not build production architecture into it.
- Follow the build steps in section 5 of the information document.

**Production mode**: everything from section 4 onward applies in full.

If it is unclear which mode a task is in, ask.

## 3. How to work

- Work in **small vertical slices** (one flow end to end), and stop after each for review.
- Before building a feature, restate the rule you are implementing and where it is written in the information document. If it is not written there, ask.
- **Do not decide open points** (section 8). Use the stated default, mark the spot with `OPEN:` in the code, and list it in the final message.
- Keep a `docs/DECISIONS.md` log. Append a line for every decision made while building.
- Prefer boring, mainstream libraries. Add a dependency only with a reason. Never write your own crypto, date conversion tables or payment verification.
- Do not add features that are not in the information document. Put suggestions in your final message instead.
- End every task with: what changed, what you tested, what is not done, and any `OPEN:` items touched.

## 4. Production stack (working assumptions, change only with approval)

- **Django + PostgreSQL**, one codebase. Server-rendered pages, with light interactivity through HTMX or plain JS. No separate front-end app and no separate API layer in V1.
- **Modular monolith.** One module per area: accounts, admissions, academics, attendance, marks and results, fees, approvals, audit, content, files, notifications. Modules talk through functions, not each other's tables.
- Background jobs run from a **PostgreSQL-backed queue**. No Redis in V1.
- Files go to **private object storage** behind signed, short-lived links. A CDN serves public pages only.
- Managed hosting: managed app platform, managed PostgreSQL with point-in-time recovery, region Mumbai or Singapore. One deployment per school, each with its own database, storage, domain and configuration.
- Excel export and PDF generation through standard libraries. BS dates through a vetted BS table or library only.
- Never introduce microservices, Kubernetes, sharding, multiple databases or event-driven infrastructure.

## 5. Roles and scopes

Six roles: **Student, Teacher, Co-ordinator, Accountant, Admin, Super Admin**. Admin and Principal are one role (Director, Principal, trustees).

| Role | Scope |
|---|---|
| Student (parents share the login) | Own record only. Read-only, cannot edit anything |
| Teacher | Own subject assignments. Class Teacher also sees own class |
| Co-ordinator | One section (School or College) |
| Accountant | One section (School or College) |
| Admin | Whole institution, always |
| Super Admin | Whole institution. Build team. Hidden from the school. Actions shown as "Support" |

**Permission rules (non-negotiable):**
- One central permission layer, **deny by default**. Every permission is role + action + scope. Never check permissions in individual views.
- The role-and-action matrix lives in one file in the repo. Generate permission tests from it.
- Required tests: Student A cannot open Student B's fees, results, files or receipts. A School user gets nothing from College data, and the reverse. Every role tries every sensitive action.
- Files are served only after a permission check, through a short-lived signed link. No permanent public file URLs.

## 6. Domain rules

**Student and years**
- The **Student** is permanent (SID, personal details, guardians, certificates). The yearly **Enrollment** (student, academic year, class) holds attendance, marks, fees, submissions and receipts. Never attach year data directly to Student.
- A closed year rejects all writes. Corrections are **new entries in the current year** that point back to the original.
- SID = admission year + sequence (for example `2083-00123`), one sequence for the institution, assigned at approval, never changes, never editable. Class and roll number belong to the enrollment.
- No hard deletes anywhere. Deactivate or archive.
- A student can be marked Left or Graduated only with **zero dues**.

**Admissions**
- Only the **Co-ordinator** approves students. Walk-ins the Co-ordinator registers are auto-approved. Rejection is final. "Ask for changes" is the fix-it path.
- Duplicate check on phone, or name plus date of birth.
- Admission reference is an optional free-text box "Referred by (if any)".

**Fees and money**
- The balance is **never stored**. It is the sum of an **append-only ledger** (charge, discount, payment, reversal, refund, carried dues).
- Money is stored as **whole paisa integers**. Never floats or decimals. Currency is NPR, shown with Nepali grouping (12,50,000).
- A payment is never edited or deleted. Mistakes are reversed. Reversals and refunds are new ledger entries pointing to the original.
- Payments are applied to the oldest due first. Partial payments are allowed. Late fees are out of scope.
- The gateway reference must be unique, so repeated callbacks cannot double-credit.
- Receipts are numbered from a gapless sequence per section and year, generated from the ledger, and never edited.
- The Accountant owns fees. The Co-ordinator has **no Fees view**. The Accountant's student profile shows only Personal and Fees.

**Approvals (Admin)**
- Five types: website content, yearly fee structure, discount, payment reversal, refund. Any one Admin can approve.
- Approve-and-apply happens in **one transaction**. A second click or a retry returns "already resolved". Nothing is applied twice.
- A request goes stale if the thing it refers to changes. Nobody approves their own request.

**Attendance**
- Students: once a day, by the class's designated Class Teacher, Present or Absent only. Same-day edits only. No in and out times.
- Teachers: marked by the Co-ordinator in a daily list pre-filled Present. Past days are editable with a reason recorded.

**Marks and results**
- Marks are entered per component in a bulk grid. Teachers can edit until the Co-ordinator verifies.
- Statuses: Draft, Under review, Verified, Published. Results publish for a **whole class per terminal**, and Publish stays disabled until every subject is Verified.
- Each class has its own grading scale. A class with no scale cannot be published. A scale change affects only unpublished results.
- Published marks cards are **snapshots**. They keep details and grades as they were that day.
- Top 20: name and rank only for students, ranked **per section**, only after that class is published.

**Audit**
- Insert-only audit log, enforced by a database role, with no update or delete for anyone including Super Admin. Log every action listed in the information document, plus sign-ins and failed 2FA in a separate Sign-ins view.

**Dates**
- Store **AD** dates. Show and accept **BS** everywhere (forms, reports, receipts, marks cards, exports). One date module owns all conversion.
- Store timestamps in UTC and show Nepal time (UTC+5:45). Day boundaries, such as "attendance locks at end of day", use Nepal midnight.
- The week is Sunday to Friday. Saturday is the weekly holiday.
- Never generate BS conversion data from memory. Use a vetted table and test it against known official dates.

## 7. Security, reliability and quality

- Validate all input. Rate-limit and lock out logins and OTPs. Rate-limit the "email already taken" check.
- Signup (the only anonymous write path): rate limiting, CAPTCHA or similar, a submission token against double submits, email verification before the application enters the queue, strict upload limits and temporary storage with cleanup.
- Uploads: check type by content, rename on save, 20 MB limit (PDF, DOC, DOCX, JPG, PNG), and serve from a separate storage domain.
- Notes and question papers: soft protection only (watermark with student name and ID, right-click and print disabled). Do not claim it is a hard guarantee.
- Staff 2FA by SMS (codes expire in minutes, remember device for 30 days, email fallback). Super Admin uses an authenticator app.
- Important operations are idempotent, transactional and have defined failure states. For each, ask: "What if the server finishes but the user never gets the response?"
- Notifications: one record per event and recipient with a unique key, sent from a background job with retry. SMS only for 2FA codes, account approved, fee overdue and results published. Absence alerts are **in-app only**, with a per-event switch. Keep SMS templates very short.
- All UI text goes through a **translation catalog**, never typed into templates, even while only English ships. Do not build the Nepali toggle yet.
- UI is built from theme tokens only. **No hardcoded colours or fonts.** Portal layout is identical for every school. Only the public site may have layout variants (2 or 3). Nothing school-specific in code. Names, grading, fee rules and gateway choice are configuration.
- Mobile-first. Test on small screens and slow networks. Keep page weight low. Host fonts ourselves. Keep contrast readable and keyboard focus visible.

**Testing (required before a slice is done)**
- Write tests **before** code for ledger, discounts, reversals, refunds, grading, year locks and approvals.
- Run the permission matrix tests and the cross-section tests on every change.
- Test failure paths, not just the happy path: duplicate submit, repeated callback, interrupted upload, stale approval.
- Add a "second theme" test page. A very different theme must not break any screen.
- Database migrations must be backward compatible. Release order: staging, then the test school, then real schools.

## 8. Open points: do not decide, use the default and mark `OPEN:`

| Topic | Default |
|---|---|
| Payment gateway, merchant account, one or two accounts | Not built. Keep a gateway interface only |
| Grade 10 to College move: dues | Must be zero |
| Optional subjects in College | Not modelled |
| Recheck notification threshold | Notify Admin on every post-publish change, with a required reason |
| Top 20 visible to other students | Shown, name and rank only |
| View-only trustee role | Not built. All Admins approve |
| Semester vs year for College | Yearly, with terminals |
| Academic year start month, holidays | Config placeholders |
| Discount reasons | Scholarship, Sibling, Staff child, Other |
| Refund rules | Every refund needs Admin approval |
| Attendance alert threshold | 75% placeholder |
| Homework retention | One year after the year closes |
| Faculty names | Placeholders |

## 9. Out of scope (do not build)

OCR marks entry, facial-recognition attendance, a separate parent login, a gallery, a public enquiry form, malware scanning, late fees and fines, a generic workflow engine, per-school portal customization, Nepali translation, real gateway integration, and anything not in the information document.

## 10. Operations reminders (production)

- The operator is not on call. Prefer managed services and boring choices.
- Build in: error tracking, uptime monitoring, alerts to a named person, staging, automated backups with point-in-time recovery, and a quarterly restore drill.
- Money never touches the operator. The gateway merchant account is in the school's name.
- If a change affects fees, results, permissions or the audit log, say so at the top of your final message and list the tests that cover it.

## 11. Definition of done

A slice is done when: the rule is implemented as written, the tests in section 7 pass, permissions are covered by the matrix, `docs/DECISIONS.md` is updated, no open point was decided silently, and the final message lists what is not done.
