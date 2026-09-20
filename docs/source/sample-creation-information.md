# Sample Creation Information: School Platform

Version 1 · 19 Sep 2026 (3 Ashwin 2083) · Status: design discussion complete for the sample, build not started

Sources: raw client spec (7 roles), Product Summary (19 Sep 2026), Product Design Document (17 Sep 2026, 31 pages), and the technical discussion that followed.

---

## 0. How to read this document

Every item carries one of four labels.

- **Decided**: stated by the product owner, or confirmed by the client in the design document.
- **Working assumption**: our recommendation from the discussion. Nobody has objected, but the client has not confirmed it. Safe to build against, easy to change.
- **Open**: needs a client decision. Do not build behaviour for it. List it on the Open points page and use the stated default.
- **Verify**: an outside fact (law, price, vendor, calendar data) that must be checked against Nepal sources before use.

---

## 1. Project in one page

- A school management platform for a Nepal-based client: one institution with a **School** (Nursery to Grade 10) and a **College** (Grade 11 and 12, three faculties). **Decided**
- Six roles: Student, Teacher, Co-ordinator, Accountant, Admin, Super Admin. **Decided**
- Under 2,000 people in total. Architecture is sized for that, with headroom to 5,000. **Decided**
- Core idea: the student is the golden record. One permanent SID and profile carries forward every year. Fees, attendance, marks and receipts belong to the year they happened in, and a closed year is never edited. **Decided**
- Data ownership: the Co-ordinator owns admissions, marks verification, results and student details. The Accountant owns fees and payments. Teachers own marks entry, attendance and content. Admin approves anything that changes money or the public site. **Decided**
- Every change goes into an audit log nobody can edit. **Decided**
- The interface is bilingual (English and Nepali, with a toggle) and shows **BS dates**. The Nepali toggle is deferred so the sample can stay focused. **Decided**

---

## 2. Business and operating model

- The build team is one person plus Claude. The production site will be built by **Claude Code** once the design discussion is complete. **Decided**
- The product owner will **own and operate** the site and charge the school a **yearly subscription**. **Decided**
- The product will be **sold to other schools**: same features, a different UI look, and a separate domain per school. **Decided**
- Because the operator is one person with no on-call team:
  - Use fully managed services (hosting, database, storage, backups). **Working assumption**
  - Money never touches the operator. The payment gateway merchant account must be in the school's name. **Working assumption**
  - Promise best-effort uptime rather than a hard SLA. **Working assumption**
- Contract points to settle before or with the pitch. **Working assumption**
  - The operator keeps the IP and can resell the platform.
  - Data ownership stays with the school, and the operator acts as data processor.
  - A breach process is defined.
  - The school consents to Super Admin access to student data, because students include minors. **Verify** against Nepal's Privacy Act.
  - Exit terms: a read-only window plus a full data export.
  - What "yearly" includes: hosting, backups, security fixes, support hours, and how branding changes and new Admin accounts are handled.
- SMS is the only cost that grows with activity. Price it usage-based or as a capped bundle. **Verify** real prices.

---

## 3. Scale and traffic

- Design target: comfortable at 5,000 users, sized for under 2,000. **Decided**
- Traffic is uneven:
  - Normal days are quiet.
  - Admissions: public pages and signup spike.
  - Results day: a few hundred people log in at once.
  - Fee due dates: payment activity clusters.
- The system should degrade gracefully, not assume constant traffic. Public pages are cached. Published results are precomputed.
- Principle: simple for V1, reliable at 5,000, with a clear path to grow. **Decided**
- Do not use microservices, Kubernetes, sharding, multiple databases or event-driven architecture.

---

## 4. Roles, scopes and permissions

| Role | Who | Scope |
|---|---|---|
| Student | Student, with parents sharing the same profile and login | Own record only |
| Teacher | Created by the Co-ordinator only | Own subject assignments. The Class Teacher also sees their own class |
| Co-ordinator | Runs admissions, results and setup | **One section** (School or College) |
| Accountant | Owns fees and payments | **One section** (School or College) |
| Admin | Director, Principal, trustees (one role) | **Whole institution**, fixed by the role |
| Super Admin | The build team (the operator) | Whole institution, hidden from the school |

- School and College have **separate administration** (their own Co-ordinators and Accountants). Admin is overall across both. **Decided**
- A person can hold both sections only through two explicit assignments. A Teacher has a home section, plus explicit assignments if they teach in the other. **Working assumption**
- Plan for **several Co-ordinators** per section so approvals do not stall on leave. **Working assumption**
- Admin and Principal are one role. Any one Admin can approve an item. Whoever acts first resolves it. **Decided**
- Default: every Admin can approve. A view-only trustee role (reports without approval rights) is **Open**, to be settled while testing with the client. It costs one row in the permission matrix.
- Super Admin actions are logged and shown to Admins as **"Support"**. **Decided**

**Permission mechanism (Working assumption)**
- One central permission layer, deny-by-default. Every permission is role + action + scope.
- The role-and-action matrix lives in the repository as a single table. Automated tests are generated from it.
- Three scopes only: institution-wide, own assignments, own record. Co-ordinator and Accountant add the section check.
- Key test: Student A tries to open Student B's fees, results, files and receipts. Also test that a College user gets nothing from School data.

---

## 5. The sample

### 5.1 Purpose
- It is a **sales pitch** to win the client's trust and show how the platform makes daily work simpler. **Decided**
- The audience is the Principal, Director and trustees. They ask "what gets easier for me, and can I trust you with our students' data?" **Working assumption**

### 5.2 Approach (Working assumption)
- A clickable prototype with realistic fake data and **no real backend**. State is held in memory and a refresh resets it.
- A **role switcher** at the top jumps between all six roles, plus the public site.
- Every screen carries a **"Sample, fake data"** label. Host it behind a password. Keep a screen recording as a backup.
- The prototype code is **throwaway**. Only the design system (theme tokens and components) and the screen flows carry into production. The data model and permissions are a fresh build.
- Time-box the build to two or three days.
- **Open**: where the sample is built (in chat or in Claude Code). Either way the code is throwaway.

### 5.3 In the sample (finalized and easy to show)
- **Public site:** School and College areas, notices, holidays, routines, vacancies, posts, contact page, and the admission form.
- **Student:** fees, receipts, voucher upload (faked), attendance, results and marks card, Top 20 (name and rank only), notes with watermark and no download, homework, and the daily activity log.
- **Teacher:** marks grid (component-wise), Class Teacher attendance, homework review and grading, notes upload (faked), and the daily activity log.
- **Co-ordinator:** the Pending review queue (Approve, Ask for changes, Reject), walk-in registration, marks verification, publishing a whole class, student search, and website drafts.
- **Accountant:** fee structure, voucher verification, cash entry, proposing discounts, and student search (Personal and Fees tabs only).
- **Admin:** approvals inbox, reports with an Excel export button, audit trail, staff accounts, and website edits.
- **Super Admin:** live theme, logo and name changes with a readability check, and Admin accounts.

### 5.4 Faked or left out on purpose
- Login and 2FA (screens only), real payments (a "gateway to be confirmed" note), SMS (an in-app bell instead), and real file uploads.
- Left out entirely: OCR marks entry, facial recognition, the Nepali toggle, and the parked items in section 10.

### 5.5 Demo story (about 10 minutes, in this order)
1. **Admin's morning screen.** Students, teachers, fees collected and remaining, a student-wise dues list, and the approvals inbox.
2. **Admission.** A student applies on a phone, the Co-ordinator approves in one tap, and the SID and confirmation appear.
3. **Fees.** A voucher is uploaded, the Accountant verifies it, the balance drops and a receipt appears. Then a discount goes through the Admin inbox.
4. **Results.** Teachers enter marks in one grid, the Co-ordinator verifies, the whole class is published, and the student sees a marks card and the Top 20.
5. **Finale.** Swap in the school's logo, name and colours live.

Also prepare a one-page **"What we improved and why"** (section 6.10) and a **"Decisions we need from you"** page (section 10).
- If Co-ordinators and accountants attend, add a two-minute "your daily screen" view per role.
- Do not quote a price live. Ask first what their current process costs them in staff time.

### 5.6 Build steps, each with a check
1. **Shell.** Role switcher, theme tokens, sample banner, BS date helper. *Check:* switching roles changes the menu, and a sample date shows the right BS month.
2. **Admin home.** Four numbers, dues list, approvals inbox. *Check:* approving a discount removes it from the inbox and the audit trail shows it.
3. **Admission.** Phone-sized signup form, Co-ordinator queue, approve, SID appears. *Check:* the same student shows up in the Student role afterward.
4. **Fees.** Voucher upload (faked), Accountant verifies, balance drops, receipt view. *Check:* the balance is identical on the Student, Accountant and Admin screens.
5. **Results.** Teacher marks grid, Co-ordinator verifies, publish class, marks card and Top 20. *Check:* the student sees nothing until publish.
6. **Theme swap.** Logo, name and colours change everywhere. *Check:* a strongly different theme breaks no screen.
7. **Rehearse.** Run the 10-minute story once end to end and record a backup video.

### 5.7 Fake data spec
- Generate the data set **before** any screens, so every step uses the same students.
- It should feel like the school: realistic Nepali names, NPR amounts with Nepali grouping (for example 12,50,000), and the real class structure.
- Placeholder classes: Nursery to Grade 10 (School), and Grade 11 and 12 with three faculties (College). Faculty names are placeholders (for example Science, Management, Humanities) until the client confirms.
- Use invented names only, with no real student data.
- Use placeholder school name, logo and colours until the client supplies them. Super Admin can change them live.
- SID format for fake students: admission year plus sequence, for example `2083-00123`.

### 5.8 Dates in the sample (BS)
- All dates on screen are **BS**. Month names in order: Baisakh, Jestha, Asar, Shrawan, Bhadra, Ashwin, Kartik, Mangsir, Poush, Magh, Falgun, Chaitra.
- Real date at time of writing: **3 Ashwin 2083 = Saturday 19 Sep 2026**, and 1 Ashwin = 17 Sep 2026 (from a public Nepali calendar).
- Saturday is Nepal's weekly holiday, so the week runs **Sunday to Friday**. Fix the sample's "today" to a working day, for example **Sunday 4 Ashwin 2083 (20 Sep 2026)**.
- BS month lengths vary (29 to 32 days) and are not a formula. **Do not calculate BS dates from memory.** In the sample, hard-code BS date strings in the fake data. In production, use a vetted BS table or library. **Verify.**
- Hand-check every date shown in the demo. A wrong month name in front of the Principal costs more trust than a missing feature.

### 5.9 Theme and design system (Working assumption)
- One design system built on **theme tokens** (colours, fonts, corner radius, spacing, logo). No hardcoded colours anywhere.
- Build the component library first (buttons, forms, tables, cards, status labels).
- Provide 2 or 3 strongly different theme presets, so the live swap is dramatic.
- Add an early "second theme" test page. A totally different theme must not break any screen.
- Mobile-first. Test a mobile-friendly BS date picker on a small screen.
- Enforce a **readability check** in the theme editor. Warn or block low contrast, including buttons and error states.

### 5.10 Risks and safeguards
- A polished demo signals "almost done". Settle scope, price and timeline in writing before or alongside the demo.
- Do not use real student data. Put the link behind a password.
- Show only what you will commit to. Say Nepali, OCR and face recognition are later versions.
- Send a one-page proposal right after the demo: scope, yearly subscription, and what is included.

---

## 6. Feature decisions by role

### 6.1 Student
- Signs up with the form. First, middle and last name, date of birth, phone, parent name and phone, previous school or college, joining year, School or College, class or faculty, year, "Referred by (if any)", certificate upload, email, password. **Decided**
- Cascading dropdowns, real-time validation and a duplicate check (phone, or name plus date of birth). **Decided**
- Email is verified before the application enters the queue. **Working assumption**
- The application goes to **Pending review**. On approval the SID is generated, an SMS and email go out, and login switches on. Status labels: Pending review, Needs your attention, Approved, Rejected. **Decided**
- Login is email plus password. An initial one-time password is editable on first login. Forgot-password uses an OTP to the registered email. **Decided**
- The student **cannot edit anything**. The student can **download own receipts, results, personal details and certificates**. **Decided**
- Dashboard: personal details, fees (total, discount, paid, remaining, history, next due), attendance (display only), results by terminal and year, Top 20 (name and rank only), notes and question papers, homework, and the daily activity log. **Decided**
- Notes and question papers **cannot be downloaded**. Protection is soft (right-click and print disabled, watermark with student name and ID). Tell the client plainly it is a deterrent, not a guarantee. **Decided**
- Attendance percentage is computed automatically, with an alert below a threshold. The threshold percentage is **Open** (75% as a placeholder).
- Leaving needs **zero dues**. After leaving, the student keeps read-only access to their own records. **Decided**
- Parents and student share one profile and one login. There is no separate parent account. **Decided**

### 6.2 Teacher
- Created by the **Co-ordinator only** (the spec also allowed Admin and Principal). Login credentials are generated and sent to the teacher. **Decided**
- One teacher can teach multiple subjects and classes. Subjects come from a dropdown of subjects the Co-ordinator created (no inline creation). **Decided**
- **Marks entry:** pick year, class, subject, terminal. The system lists SID and name. Marks are entered **component by component** in a bulk grid, with draft-save and auto-flagging of missing marks. Components are configurable per subject. The teacher can edit freely until the Co-ordinator verifies. **Decided**
- **Attendance:** one designated **Class Teacher** per class marks student attendance **once a day**, Present or Absent only. Mark-all-present is the default. Editable same day only. There are **no in and out times**. **Decided**
- **Content:** upload notes and question papers by year, class and subject. They go live immediately. To replace, delete and re-upload (no versioning). File types PDF, DOC, DOCX, JPG, PNG, up to 20 MB. **Decided**
- **Assignments:** deadline, instructions, optional attached file. Late is flagged automatically. The teacher reviews, gives marks and feedback. Resubmission is request-then-approve. **Decided**
- **Daily activity log:** mandatory per class per day, visible to students and parents, with a reminder if skipped. **Decided**
- The teacher sees their own attendance as a read-only monthly view. **Decided**

### 6.3 Co-ordinator
- The **only** role that approves students. Walk-ins registered by the Co-ordinator are **auto-approved**. A rejection is **final**, and the applicant must reapply. **Decided**
- Review screen: details beside the certificate, with Approve, Ask for changes (pick fields and give a reason), and Reject (reason required). **Decided**
- **Results inbox:** one card per class, subject and terminal, with statuses Waiting for teacher, Ready to verify, Verified, Published. Verify shows the grid read-only with missing or unusual marks highlighted, with Approve or Send back with a note, and bulk approve. **Decided**
- **Publish a whole class per terminal** (the spec said by subject). Publish stays disabled until every subject is Verified, and the inbox shows which subject is holding it up. **Decided**
- Each class has its own **grading scale**. A new class starts by copying another's scale. A class with no scale cannot be published. A scale change affects only unpublished results. **Decided**
- Marks cards use 2 or 3 ready-made templates, with the school logo, name and colours from Super Admin branding, and the Principal's signature and school seal. **Decided**
- Whole-class view: one sheet of students by subjects, with totals and rank, exportable. **Decided**
- **Top 20:** students see name and rank only, for their own year and terminal, after that class is published. Staff see the whole school. **Decided**, but visibility to other students is **Open** (many are minors).
- Setup: creates classes, courses and subjects, and adds mark components. A subject with marks or a teacher can be archived but not deleted. At year start, each class copies last year's subjects. **Decided**
- Picks one **Class Teacher** per class, and can reassign any time. There is no backup teacher. **Decided**
- Marks **teacher attendance** in a daily list pre-filled as Present. Exceptions are Absent or On leave. Past days stay editable with a reason recorded. **Decided**
- Search by name, SID or phone. The profile has tabs **Personal, Results, Attendance**, with a year picker. **No Fees tab.** Can correct personal details with a reason recorded. The SID can never be edited. **Decided**
- **Website:** drafts content (Notice, Holiday, Routine, Vacancy, Post). It goes live after Admin approval. **Decided**
- Two-factor login by SMS. **Decided**

### 6.4 Accountant
- Drafts the **yearly fee structure**. Items are One-time, Monthly, Yearly or Whole course, in **NPR**. The structure is fixed for the year and the same for every student in a class. **Admin approves** before it goes live. **Decided**
- A class and year with no live structure cannot take admissions. **Working assumption**
- Late fees and fines are out of scope for V1. **Decided**
- Registers students. They go to the Co-ordinator's Pending review queue. **Decided**
- The payable amount starts equal to the total fee. Any reduction is a **discount**. The Accountant enters an amount or percentage plus a reason. **Admin approves every discount**. Until approved, the payable stays at the full fee. **Decided**
- **Payments:** online (parked), voucher upload verified by the Accountant, or cash recorded at the counter. A verified payment reduces the balance and creates a numbered receipt. Partial payments are allowed and applied to the oldest due first. **Decided**
- A payment is **never deleted**. A mistake is reversed, and **Admin approves every reversal**. **Decided**
- **Refund:** initiated by the Accountant and approved by Admin. After approval the Accountant records how the money was returned. The ledger gets a negative refund entry. **Decided**
- The first payment is recorded only after the Co-ordinator approves the student. **Working assumption**
- Search shows only **Personal and Fees** tabs. Personal is read-only. **Decided**
- Two-factor login by SMS. **Decided**

### 6.5 Admin (Director, Principal, trustees)
- **Approvals inbox** with five kinds of item: website content, yearly fee structures, discounts, payment reversals, refunds. Each has Approve and Decline (a reason is required on decline). History tab. A reminder if still pending after two days. **Decided**
- Reports with Year and Class filters, a School/College filter chip, and **Export to Excel**: students, fees (total, paid, remaining, total discounts, student-wise dues list), and a results summary per class. Only published results appear. **Decided**
- Creates Co-ordinator and Accountant accounts. Accounts are deactivated, never deleted. Searches all students and teachers (read-only tabs). **Decided**
- **Audit trail:** an Activity screen (who did what, when, before and after, reason) and a separate **Sign-ins** tab that includes failed 2FA attempts. Filters, plus Excel export. Nobody can edit or delete an entry, including Super Admin. **Decided**
- Does **not** register students or create teachers. **Decided**
- Edits the website (own edits go live directly) and approves Co-ordinator drafts. **Decided**
- Two-factor login by SMS. **Decided**

### 6.6 Super Admin
- The build team's master role. Full access, with every action logged and shown to Admins as "Support". **Decided**
- **Branding:** logo, school name, font style, text colour and background colour, plus the Principal's signature and school seal. Free choice with a **readability check** and a live preview. **Decided**
- Creates Admin accounts (one per person) and resets lost 2FA access. **Decided**
- 2FA applies to Super Admin too. An authenticator app is preferred over SMS for this role. **Working assumption**

### 6.7 Website content
- Five content types: Notice, Holiday, Routine, Vacancy, Post. Each has a title, text, optional image or file, publish date and optional hide-after date. Expired items hide automatically. Preview before going live. **Decided**
- Routines come from the timetable. Vacancies show a contact email or phone. There is no job-application system in V1. **Decided**
- Flow: Draft, Waiting for approval, Live. An Urgent flag notifies Admin immediately. **Decided**
- One public site with a School area and a College area. **Working assumption**
- Contact page only (school phone, email, map). A gallery and an enquiry form are deferred. **Working assumption**

### 6.8 Year lifecycle and leaving
- The student profile (SID, personal details, parent details, certificates) carries forward automatically. Each year's records belong to that year. No edits to a previous year's data. **Decided**
- SID format: **admission year plus a sequence**, for example `2083-00123`, one sequence for the whole institution. It is assigned at approval and never changes. Class and roll number live on the yearly record. A Grade 10 student moving to 11 keeps the same SID. **Working assumption**
- Year rollover: one Co-ordinator screen per class. Each student is marked **Promote, Repeat or Leaving**, then Confirm. It needs the new year's fee structure to be live. **Decided**
- Unpaid balance from a locked year shows as **"Previous dues"** in the new year. Payments toward it are new entries in the current year. Reversals and refunds are new entries that point back. **Decided**
- Statuses: Active, Left (transfer or dropout), Graduated. Marking Left or Graduated needs **zero dues**. A returning student is reactivated on the same profile. Nothing is deleted. Forgiven dues are cleared through the discount flow (Waive dues, Admin approves). **Decided**
- Published marks cards are **snapshots**: they keep details and grades as they were that day. **Working assumption**
- Grade 10 to College handover: the School Co-ordinator marks Promote, and the College Co-ordinator receives the student, picks the faculty and confirms the enrollment. Default: School dues must be zero before the move. **Open**

### 6.9 Recheck of marks
- A recheck button exists on a published mark. The Co-ordinator is always notified and can edit and republish. The student is notified of any change. **Decided**
- Admin notification threshold: **Open**. Proposed default: notify Admin on every post-publish change, with a required reason, and skip the threshold in V1.

### 6.10 Where we differ from the client's written spec (present as "what we improved")
- Seven roles became six: Admin and Principal are one role.
- Only the Co-ordinator approves students. Admin and Accountant do not.
- Teachers are created by the Co-ordinator only. Admin does not register students or create teachers.
- Results publish for a whole class, not by subject.
- Discounts, fee structures, reversals, refunds and website content need Admin approval. The Accountant cannot type over the admission fee. Any reduction is a discount.
- Fee structure creation moves from the Co-ordinator to the Accountant. The Co-ordinator has no Fees view. The Accountant sees Personal and Fees only.
- Attendance is once a day by a Class Teacher. There are no in and out times.
- The SID is permanent and no longer encodes class or roll number.
- Students can download their own receipts, results and certificates (the spec said no downloads). Notes and question papers remain non-downloadable.
- The Co-ordinator drafts website content and Admin approves before it goes live.
- Top 20 is visible to students (name and rank only).
- Super Admin is the build team's role, not a school role.

---

## 7. Cross-role rules

**Approvals (one generic mechanism).** **Working assumption**
- The five types are website content, fee structure, discount, reversal and refund. Each request stores who asked, what, and a snapshot of the request.
- Approving and applying happen in **one transaction**. An approved discount writes its ledger entry atomically. Two Admins clicking at once, or a retried click, produce one result and the second gets "already resolved".
- A request goes stale if the thing it refers to changes (for example, an edited fee structure).
- Nobody approves their own request.

**Audit.**
- The audit log is insert-only, enforced by a database role. It records approvals, walk-ins, attendance edits, detail corrections, payments, discounts, reversals, refunds, result verification and publishing, website publishing, account changes, and Admins' own actions.
- Tell the client honestly what the audit guarantee does and does not mean while the build team holds Super Admin access.

**Ledger.**
- The balance is **never a stored field**. It is the sum of ledger entries: charge, discount, payment, reversal, refund, carried dues.
- Money is stored as **whole paisa integers**, never decimals.
- The ledger is append-only. Reversals and refunds point to the original entry.
- Receipts are numbered from a gapless sequence per section and year. They are generated from the ledger, can be regenerated, and are never edited.

**General.**
- No hard deletes. Accounts are deactivated, subjects archived, dues stay on record.
- Every piece of data has one owner (see section 1).

---

## 8. Backend technology and architecture

Each decision uses the form: Decision, Why, Rejected alternatives, Trade-off, Later.

### 8.1 Core shape (Working assumption)
- **Decision:** modular monolith with one PostgreSQL database. A background job queue backed by PostgreSQL. Private object storage for files. A CDN in front of public pages.
- **Why:** the data is relational with heavy cross-role rules (approvals, year locks, ledgers). Transactions and foreign keys do most of the work.
- **Rejected:** microservices, NoSQL, serverless-only, Redis (not needed under 2,000 users).
- **Trade-off:** one deployable to reason about. Module boundaries need discipline.
- **Later:** a read replica, then split out notifications or files if ever needed.

### 8.2 Stack and build method (Working assumption)
- **Decision:** **Django with PostgreSQL**. Server-rendered pages with light interactivity (HTMX or plain JS), one codebase and no separate API and front end. Excel and PDF generation through standard libraries.
- **Why:** mainstream and heavily documented, so AI-generated code is reliable. It ships with auth, permissions, migrations, an admin panel and form validation, which are the costly parts to get wrong.
- **Rejected:** Next.js or React with a separate API (two codebases, no benefit at this scale), and Laravel or Rails (fine, but no advantage).
- **Trade-off:** a less slick UI than a single-page app. Good for forms, dashboards and tables on slow mobile networks in Nepal.
- **Later:** if a mobile app is needed, add an API layer on top of the same business logic.

**Because Claude Code writes the software:**
- Put the design document in the repo as the source of truth: a project instruction file, a data-model document, and a decisions log.
- Build one small vertical slice at a time.
- Write tests **before** code for money and results logic (ledger, discounts, reversals, refunds, grading, year locks).
- Keep dependencies few and mainstream.
- Do not let generated code skip permission checks. Use the central layer only.

### 8.3 Hosting, operations and tenancy (Working assumption)
- **Decision:** fully managed services: a managed app platform, managed PostgreSQL with automated backups and point-in-time recovery, private object storage, and a CDN.
- **Region:** Nepal has no local cloud region, so host in Mumbai or Singapore. **Verify** latency and prices.
- **One codebase, one deployment per school.** Each school has its own database, storage, domain and configuration. There is no shared multi-tenant system.
- **Why:** separate domains and separate data come naturally. "Your data is never in the same database as another school's" is a selling point for minors' data.
- **Rejected:** shared multi-tenant (a permissions bug can leak across schools), separate forks per school (the worst option for a solo operator).
- **Trade-off:** each school adds a little hosting cost and one more deployment to update. Manageable up to a few dozen schools. Automate a "new school" setup when the second sale is near.
- **Operations minimum:**
  - Alerts to the operator's phone, and uptime monitoring.
  - A staging environment.
  - A quarterly **restore drill**.
  - A short runbook, for example "payments are failing".
  - Release order: staging, then the test school, then real schools.
  - Backward-compatible database migrations.
- Nothing school-specific in code. Names, grading, fee rules and gateway choice all live in configuration.

### 8.4 Theming across schools (Working assumption)
- **Decision:** a design system with theme tokens. Each school's look is a saved theme. Layout structure is shared.
- **Public site:** 2 or 3 layout variants to choose from, fully themeable.
- **Portal (student, teacher, staff, admin):** one layout for every school, changed only by branding. Portal layout requests are paid product changes for everyone, never per-school customization.
- Workflows are defaults with a few settings. Add a setting only when a second paying school actually asks. Do not build a generic workflow engine.
- The Super Admin branding area becomes the theme editor, with a saved theme per school and a live preview.

### 8.5 Data model spine (Working assumption)
- **Student** (permanent): SID, personal details, guardians, certificates.
- **Enrollment** (student, academic year, class): everything that belongs to a year. Attendance, marks, fees, submissions and receipts hang off Enrollment, never directly off Student.
- A closed year is a year whose enrollments reject writes.
- **Class** = academic year, level (Nursery to 10, then 11 and 12), faculty (11 and 12 only), optional section (A or B). School or College is derived from the level.
- Setup entities: academic year, class, terminal, subject offering (class, year, subject, mark components), teacher assignment, Class Teacher.
- Daily and academic entities:
  - Attendance (enrollment, date).
  - Marks (enrollment, subject, terminal, component), with status draft, under review, verified, published.
- Fees: fee structure (class, year, items, approval status), plus one append-only **ledger** per enrollment.
- Cross-cutting entities: generic approval request, insert-only audit log, content items (draft, waiting, live), and file records that point to private storage.
- Students in the College who take optional subjects need a student-to-subject choice, so marks grids list only the right students. **Open**
- Likely hot queries: search by name, SID or phone (indexed), a student's fees summary, class attendance for today, and the results view.
- Rank the Top 20 **per section**, since comparing a Grade 5 student with a Grade 12 student makes no sense. **Working assumption**

### 8.6 Dates (Decided)
- The database stores **AD** dates. **BS** is what users see and type everywhere: forms, reports, receipts, marks cards, audit trail, Excel exports.
- One date module owns all conversion. No screen converts on its own.
- Conversion uses a vetted BS table or library, tested against known official dates, including month and year boundaries. **Verify** the data range and who updates it each year.
- Academic year is defined in BS (for example 2083). The start month is **Open**.
- Monthly fees carry a BS year and month key plus a due date.
- Date of birth stores the AD date and the BS date as entered, so it matches certificates.
- Timestamps are stored in UTC and shown in **Nepal time (UTC+5:45)**. "Attendance locks at end of day" must use Nepal midnight, not server midnight.
- Week is Sunday to Friday. Nepali holidays are a content and configuration matter. **Open**

### 8.7 Payments (design ready, gateway parked)
- **Decision (Working assumption):** a payment attempt is its own record, created before the student is sent to the gateway. A ledger entry is written only when the **server confirms the payment directly** with the gateway. The browser return is never proof of payment. The amount comes from our attempt record, never the URL.
- Duplicate callbacks: the gateway reference is unique, so the first confirmation wins.
- Lost response or closed tab: the attempt stays pending, and a scheduled job checks it. The student sees "checking your payment".
- Amount mismatch: no auto-credit. It goes to an exceptions list for the Accountant.
- Overpayment: applied oldest-due-first, and any surplus is shown as a credit.
- Reconciliation: one daily job comparing gateway confirmations with ledger entries, plus one Exceptions screen. No finance dashboards in V1.
- Voucher uploads: an Accountant queue with the age of each item and a duplicate-reference warning.
- Cash: recorded immediately, plus a daily collection summary per Accountant that Admin can see.
- The gateway sits behind an interface so the next school can use another.
- **Open (parked):** which gateway (eSewa, Khalti or Fonepay), whether the school already has a merchant account, and one account or two (School and College). Default assumption is one account, with each payment tagged by section.
- Unverified estimates from the design document: setup cost of roughly Rs 20,000 to 25,000 per gateway, and per-transaction fees of about 1 to 4 percent. Some alternatives may offer free API access. API access requires a registered institution in Nepal. Khalti offers a "School Fee Payment" product. **Verify** all of this.
- Fees do not depend on the gateway. Voucher upload, cash and the ledger all work without it.

### 8.8 Files (Working assumption)
- All files (certificates, vouchers, homework, notes, receipts) live in **private storage**. Every open or download goes through a permission check and a **short-lived signed link**. Nothing has a permanent public URL.
- Checks on upload: file type by content (not extension), rename on save, 20 MB limit, serve from a separate storage domain.
- Slow networks: compress phone photos in the browser before uploading, show progress, allow retry.
- Signup uploads (before an account exists): stricter size limits, temporary storage, and automatic cleanup of uploads that never became an application.
- Watermarked notes: rendered on view with the student's name and ID, and cached briefly per student.
- Malware scanning: deferred in V1. Revisit if teachers upload arbitrary DOC files at volume.
- Retention proposal: keep homework submissions one year after the academic year closes, and keep grades forever. **Open**
- Public pages resize images on upload.

### 8.9 Notifications (Working assumption for channels; Decided for absence alerts)
- One notification record per event and recipient, with a unique key so retries never send twice. Delivery runs as a background job with retry and status tracking. SMS falls back to email on failure.
- **SMS:** 2FA codes, account approved, fee overdue, results published.
- **Email:** receipts and non-urgent updates.
- **In-app:** everything else, including homework, activity log and new notes.
- **Absence alerts stay in the website (in-app only).** **Decided.** Keep a per-event on/off switch so the school can enable absence SMS later without a code change. The trade-off: parents share the login, so an alert only helps if someone opens the site.
- Control SMS cost with a monthly budget and an alert to the operator at 80%. Batch reminders (for example, one overdue-fee run per day).
- No notification preferences in V1. Every message is transactional.
- **Verify** Nepal SMS providers and cost per message. Nepali SMS uses Unicode, so a message holds about 70 characters instead of 160, and long texts split into several billed parts. Keep templates very short.

### 8.10 Public site and signup (Working assumption)
- Public pages are server-rendered and cached at the CDN for a few minutes. Publishing content purges the cache, so a notice goes live within seconds.
- Signup is the only anonymous write path. Protections:
  - Rate limiting per IP and phone.
  - A CAPTCHA or similar check.
  - A submission token so double taps and refreshes create one application.
  - Draft saved in the browser, so a lost connection does not lose a long form.
  - Email verification before the application enters the queue.
  - Rate-limit the "email already taken" check, or check on submit, to prevent enumeration.

### 8.11 Bilingual interface (Decided; toggle deferred)
- English and Nepali from day one, with a toggle. The Nepali toggle is **deferred** so the sample can stay focused. Sample is English only.
- In production, every piece of screen text lives in a **translation catalog** and is never typed into a page, even while only English ships. Retrofitting later is painful.
- System text (buttons, labels, statuses, receipts) is translated once. School-written content (notices, posts) is stored as written, with optional English and Nepali versions and a fallback. No auto-translation of fees or results.
- Watch-outs: Devanagari font support in the theme editor and in generated PDFs, Nepali number grouping and digits choice, search in either script, and a fluent reviewer for school and accounting terms (a small glossary). Search across scripts by phonetic matching is a later feature.

### 8.12 Security and privacy (Working assumption unless noted)
- Role-based access control with least privilege and a single deny-by-default layer (section 4).
- Students are minors in many cases. Treat their data as sensitive. **Verify** Nepal's Individual Privacy Act 2075 (2018) and Regulation (2020), and the Ministry of Education's student-data guidance.
- Rate limiting and lockout on all logins and OTPs. Input validation everywhere.
- Staff 2FA by SMS (codes expire in a few minutes, "remember this device for 30 days", "send by email instead" fallback). **Decided.** Super Admin uses an authenticator app.
- Encryption in transit and at rest through the managed services. Secure backups. Data retention policy. **Verify** and finish.
- Super Admin access to student data: agreed up front with the client, always logged, shown as "Support", used only for recovery and support.
- Always ask: "What happens if an unauthorized user tries to access this?"

### 8.13 Reliability
- Assume slow internet, refreshes, duplicate submissions, interrupted uploads and failed payments.
- Use idempotency keys, transactions and defined failure states for important operations. Always ask: "What if the server finishes but the user never gets the response?"
- Attendance and marks grids support draft-save and retry.

### 8.14 Performance
- Cache public pages. Precompute published results as snapshots, so results day is one read per student.
- Index the hot queries in section 8.5. Optimize only after finding a real bottleneck.
- Set page-weight budgets and test on low-end phones and slow networks. Host fonts ourselves.

### 8.15 Monitoring and cost control
- Application logs, error tracking, uptime monitoring, and alerts sent to a named person. Track failed notifications, authentication failures and payment exceptions.
- Product metrics: admissions applications, active users, notification delivery.
- Use the smallest managed app and database tiers that fit under 2,000 users. **Verify** current prices. Cost should be mostly flat, except SMS.

### 8.16 Growth path
- **V1 (under 2,000, headroom to 5,000):** the setup above.
- **25,000 to 100,000 users:** a read replica, caching for hot reads, move notifications and files into separate workers, add Redis only if measured need appears.
- **Large scale:** only with evidence. No pre-emptive distributed systems.

---

## 9. Facts to verify before relying on them

- BS conversion data (range, update process) and Nepali holidays.
- Nepal SMS providers, cost per message, and Devanagari billing.
- Payment gateway sandbox behaviour, server-side verification, fees, and merchant requirements.
- Nepal's Individual Privacy Act 2075 for minors' data and for build-team access, plus Ministry of Education guidance.
- Hosting region latency and prices, and current prices of managed services.
- For later versions only: OCR marks entry and facial recognition (Nepal vendor costs, and the guardian-consent gap for minors' biometric data needs a legal check).

---

## 10. Open points (show on the sample's "Decisions we need from you" page)

| # | Question | Default used in the sample |
|---|---|---|
| 1 | What does "Admission reference" capture: a referral, an entrance-test number or an agent code? | Optional box "Referred by (if any)" |
| 2 | Does the college run by year or by semester? | Yearly, with terminals |
| 3 | Does "course wise" fee mean one payment, or a course total in instalments? | Shown as a billing type only |
| 4 | Academic year start month and holiday calendar | Placeholder dates |
| 5 | Which payment gateway, is there a merchant account, and one account or two? | Not shown (parked) |
| 6 | Which discount reasons does the school use? | Scholarship, Sibling, Staff child, Other |
| 7 | When is a refund allowed? | Any refund needs Admin approval |
| 8 | Is the client comfortable showing the Top 20 to other students (many are minors)? | Shown, name and rank only |
| 9 | Grade 10 to College move: must School dues be zero? | Yes |
| 10 | Optional subjects in College | Not modelled in the sample |
| 11 | At what marks change does a recheck also go to Admin? | Every post-publish change notifies Admin |
| 12 | View-only trustee role, or all Admins can approve? | All Admins approve |
| 13 | Does the client understand branding changes and new Admin accounts go through the build team? | Confirm at the pitch |
| 14 | Does the client agree to build-team access to student data, with every action logged and shown to Admins? | Confirm at the pitch |
| 15 | Attendance alert threshold percentage | 75% placeholder |
| 16 | Homework retention period | One year after the year closes |
| 17 | Certificate upload: accepted file types and max size | PDF, DOC, DOCX, JPG, PNG, 20 MB |
| 18 | Faculty names for Grade 11 and 12 | Placeholders |
| 19 | Do parents get absence SMS later? | In-app only |
| 20 | Nepali toggle timing, and who reviews the translations | Deferred |
| 21 | Who runs first-week support and staff training | To agree |

---

## 11. Deferred features

- OCR photo-based marks entry (V2). Handwritten-digit accuracy is a real risk, and a manual review step is needed either way.
- Facial-recognition attendance (V2 or V3). Adds a parental-consent workflow, a retention policy and real regulatory exposure.
- A separate parent login. A gallery. A public enquiry form. Malware scanning.
- A gateway integration, until the client decides.
- A generic workflow engine, and any per-school portal customization.
- Late fees and fines.

---

## 12. Still to design after the sample

1. **Existing school data:** import of students, balances and old results, the switch-over date (ideally the start of an academic year), and whether to run in parallel.
2. **Security details:** session and password rules, encryption, backup security, retention, and Super Admin safeguards.
3. **Production operations:** monitoring, restore drills, staging, releases, and the runbook.
4. **Year rollover and leaving screens** in detail, including the Grade 10 to 11 handover.
5. **Results engine:** grading scales, marks card PDF generation, rechecks, and snapshots.
6. **Reports and Excel export**, and search behaviour.
7. **How Claude Code builds it:** the repo instruction file, the permission matrix as tests, ledger tests, the decisions log, and milestones.
8. **Accessibility and low-end phones:** page-weight budgets, slow-network behaviour, and contrast.
9. **Business:** pricing and cost model, contract terms, support and go-live plan, and the privacy law check.

**Suggested production build order:**
1. Foundation: roles, login and 2FA, audit log, branding.
2. Academic core: setup, admissions, student profile, attendance.
3. Fees ledger and payments.
4. Marks and results.
5. Notes, homework, and public website content.
