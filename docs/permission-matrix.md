# Permission matrix

Status: **enforced by the code since Phase 1, slice 4 (D-025).** The tables below are generated from `apps/api/src/core/permissions/matrix.ts`, which is the single place permissions are decided. Change the code, run `npm run gen:permissions` in `apps/api`, and commit both. CI fails if they differ.

Deny by default: a role that is not listed for an action is denied, and so is any action that is not in the matrix.

## Reading it

Roles: **STU** Student (parents share the login), **TEA** Teacher, **COO** Co-ordinator, **ACC** Accountant, **ADM** Admin (Principal, Director, trustees), **SUP** Super Admin (build team, shown to the school as "Support").

Cells say how far a role's permission reaches:
- `—` denied
- `✓` everything, the whole institution
- `inst` the whole institution. If the person's role assignment is limited to one section, only that section (D-004)
- `read` like `inst`, but the role may only look
- `own` the person's own record only
- `assigned` only their assigned subjects or classes
- `class` their own class only (the Class Teacher)
- words such as `teachers` or `sid+name` are a restriction the handler must enforce
- `public` anyone, signed in or not

Phase is the build phase where the action first exists. The action id in code font is what a route declares.

<!-- BEGIN GENERATED: tables (run `npm run gen:permissions` in apps/api; do not edit by hand) -->

### Access and accounts

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Sign in, reset own password (`auth.sign_in`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1 |
| Correct your own name and phone (staff; a student's details are corrected by the Co-ordinator) (`account.profile.edit`) | — | own | own | own | own | own | 8 |
| Create Admin account (`accounts.admin.create`) | — | — | — | — | — | ✓ | 1 |
| Create Co-ordinator or Accountant (`accounts.staff.create`) | — | — | — | — | ✓ | ✓ | 1 |
| Create Teacher (`accounts.teacher.create`) | — | — | inst | — | — | ✓ | 3 |
| Deactivate or reactivate an account (`accounts.deactivate`) | — | — | teachers | — | co-ordinators, accountants | ✓ | 1 |
| View the staff list (`accounts.staff.view`) | — | — | teachers | — | read | ✓ | 3 |
| Change which sections a Co-ordinator's or Accountant's access reaches (`accounts.staff.access`) | — | — | — | — | ✓ | ✓ | 3 |
| Give a person a new temporary password (`accounts.password.issue`) | — | — | teachers | — | co-ordinators, accountants | ✓ | 3 |
| Reset lost 2FA (`accounts.reset_2fa`) | — | — | — | — | — | ✓ | 1 |
| Change branding, signature, seal (`branding.manage`) | — | — | — | — | — | ✓ | 1 |
| Switch persona (demo mode only, logged) (`demo.switch_persona`) | — | — | — | — | — | ✓ | 1 |

### Public website

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| View public site (anyone, no sign-in) (`site.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2 |
| Draft content (notice, holiday, routine, vacancy, post) (`content.draft`) | — | — | inst | — | ✓ | ✓ | 2 |
| Publish content directly (`content.publish`) | — | — | — | — | ✓ | ✓ | 2 |

### Setup

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Manage academic years, classes, terminals (`setup.structure.manage`) | — | — | inst | — | — | ✓ | 3 |
| Manage sections, programmes and their levels (and a programme's grading policy) (`setup.programmes.manage`) | — | — | — | — | ✓ | ✓ | 3 |
| View academic years, programmes, levels, classes, terminals (`setup.structure.view`) | — | — | inst | — | read | ✓ | 3 |
| View subjects, offerings, mark components, elective groups (`setup.subjects.view`) | — | — | inst | — | read | ✓ | 3 |
| Manage subjects, offerings, mark components, elective groups (`setup.subjects.manage`) | — | — | inst | — | — | ✓ | 3 |
| View teacher assignments and Class Teachers (`setup.assignments.view`) | — | — | inst | — | read | ✓ | 3 |
| Assign teachers to subjects; pick the Class Teacher (`setup.assignments.manage`) | — | — | inst | — | — | ✓ | 3 |

### Admissions and students

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Submit an application (anonymous, rate limited) (`admissions.apply`) | public | — | — | — | — | — | 4 |
| Register a walk-in (auto-approved) (`admissions.walkin.register`) | — | — | inst | — | — | ✓ | 4 |
| Register a student (goes to the review queue) (`admissions.student.register`) | — | — | — | inst | — | — | 4 |
| Review queue: approve, ask for changes, reject (`admissions.review`) | — | — | inst | — | — | ✓ | 4 |
| Search students (`students.search`) | — | sid+name (assigned) | inst | inst | inst | ✓ | 4 |
| View personal details (`students.personal.view`) | own | — | inst | read | read | ✓ | 4 |
| Correct personal details (reason required; SID never editable) (`students.personal.correct`) | — | — | inst | — | — | ✓ | 4 |
| Mark Left or Graduated (zero dues only) (`students.status.set`) | — | — | inst | — | — | ✓ | 8 |
| Year rollover: Promote, Repeat, Leaving (`students.rollover`) | — | — | inst | — | — | ✓ | 8 |

### Daily school life

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Mark student attendance (once a day, same-day edits) (`attendance.student.mark`) | — | class | — | — | — | — | 5 |
| View student attendance (`attendance.student.view`) | own | class | inst | — | read | ✓ | 5 |
| Mark teacher attendance (past days editable with reason) (`attendance.teacher.mark`) | — | — | inst | — | — | ✓ | 5 |
| View teacher attendance (`attendance.teacher.view`) | — | own | inst | — | read | ✓ | 5 |
| Write daily activity log (`activity.write`) | — | assigned | — | — | — | — | 5 |
| Read daily activity log (`activity.read`) | own class | assigned | inst | — | read | ✓ | 5 |
| Upload or delete notes and question papers (`notes.manage`) | — | assigned | — | — | — | — | 5 |
| View notes and question papers (watermarked, no download) (`notes.view`) | own class | assigned | — | — | — | — | 5 |
| Create and grade assignments (`assignments.manage`) | — | assigned | — | — | — | — | 5 |
| Submit an assignment (`assignments.submit`) | own | — | — | — | — | — | 5 |

### Fees and money

The Co-ordinator has **no** fees access at all.

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Draft yearly fee structure (`fees.structure.draft`) | — | — | — | inst | — | — | 6 |
| Approve fee structure (`fees.structure.approve`) | — | — | — | — | ✓ | — | 6 |
| Generate the year's charges from a live fee structure (`fees.charges.generate`) | — | — | — | inst | — | — | 6 |
| View fees, dues, ledger (`fees.view`) | own | — | — | inst | read | ✓ | 6 |
| Upload a payment voucher (`fees.voucher.upload`) | own | — | — | — | — | — | 6 |
| Pay online through the gateway (demo adapter only until Phase 9) (`fees.online.pay`) | own | — | — | — | — | — | 6 |
| Verify or reject a voucher (`fees.voucher.verify`) | — | — | — | inst | — | — | 6 |
| Record cash payment (`fees.cash.record`) | — | — | — | inst | — | — | 6 |
| Propose a discount (`fees.discount.propose`) | — | — | — | inst | — | — | 6 |
| Approve a discount (`fees.discount.approve`) | — | — | — | — | ✓ | — | 6 |
| Request a payment reversal (`fees.reversal.request`) | — | — | — | inst | — | — | 6 |
| Approve a reversal (`fees.reversal.approve`) | — | — | — | — | ✓ | — | 6 |
| Request a refund (`fees.refund.request`) | — | — | — | inst | — | — | 6 |
| Approve a refund (`fees.refund.approve`) | — | — | — | — | ✓ | — | 6 |
| Record how an approved refund was paid (`fees.refund.record`) | — | — | — | inst | — | — | 6 |
| View and download receipts (`fees.receipts.view`) | own | — | — | inst | read | ✓ | 6 |
| Send overdue reminders (email) (`fees.reminders.send`) | — | — | — | inst | — | — | 6 |

### Marks and results

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Record each student's elective picks (D-056) (`results.electives.set`) | — | — | inst | — | — | ✓ | 7 |
| Enter marks (until verified) (`marks.enter`) | — | assigned | — | — | — | — | 7 |
| Verify, send back, bulk approve (`marks.verify`) | — | — | inst | — | — | ✓ | 7 |
| Publish a whole class (all subjects verified) (`results.publish`) | — | — | inst | — | — | ✓ | 7 |
| View published results and marks card (`results.view`) | own | — | inst | — | read | ✓ | 7 |
| Top 20 (`results.top20.view`) | name and rank only, own section, published | — | inst | — | inst | ✓ | 7 |
| Request a recheck (`results.recheck.request`) | own | — | — | — | — | — | 7 |
| Edit and republish after recheck (`results.recheck.edit`) | — | — | inst | — | — | ✓ | 7 |

### Oversight

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Approvals inbox: decide (never your own request) (`approvals.decide`) | — | — | — | — | ✓ | ✓ | 3 |
| Send a draft for approval (`approvals.request`) | — | — | inst | — | ✓ | ✓ | 3 |
| View your own approval requests (`approvals.view.own`) | — | — | own | — | — | — | 3 |
| View activity audit trail and sign-ins (`audit.view`) | — | — | — | — | ✓ | ✓ | 1 |
| The Principal's dashboard: the whole school at a glance (counts, trends, what needs attention, recent activity) (`dashboard.overview.view`) | — | — | — | — | ✓ | ✓ | 7 |
| Edit or delete an audit entry (`audit.edit`) | — | — | — | — | — | — | 1 |
| Test mailbox: read the emails the site would have sent (only where email is not really sent; never in production) (`dev.mailbox.view`) | — | — | — | — | ✓ | ✓ | 7 |
| Reports and Excel export (students) (`reports.students`) | — | — | inst | — | inst | ✓ | 4 |
| Reports and Excel export (fees) (`reports.fees`) | — | — | — | inst | inst | ✓ | 6 |
| Reports and Excel export (results) (`reports.results`) | — | — | inst | — | inst | ✓ | 7 |

<!-- END GENERATED -->

## How it is enforced

1. Every route declares an action, or says it is public, or says any signed-in user. A route that does not is caught by a test, and an action that is not in the matrix fails when the route is defined.
2. A route with an action answers **401** if you are not signed in and **403** if none of your roles grants it. The handler never runs.
3. The handler receives a **grant**: how far the person's permission reaches (institution, certain sections, own record, assigned, class, plus any restriction). The handler must build its queries from it. That is what keeps Student A out of Student B's fees and a section-scoped Co-ordinator out of the other section.
4. The signed access cookie can be up to 30 minutes old, so money, approval and publish actions also re-check the person's assignments inside their own database batch.

## How it is tested

1. **One test per row**, generated from the matrix: every role against every action, and the reach of each grant.
2. **Rules stated independently**, written by hand from the requirements and not derived from the table: exactly who may approve a refund, verify a voucher, publish results, or edit the audit log (nobody); that the Co-ordinator has no fees access; that a Student can do only a fixed list of things, each on their own record. If a cell is edited wrongly, these fail.
3. **Scope, both ways**: every institution-reach action for a whole-institution Co-ordinator and Accountant, and again limited to one section, proving a +2 person gets nothing from the Bachelor's section (D-004).
4. **Over HTTP**: one route per action, every role calling every action: 403 where denied, handler never run, 401 with no cookie or an expired one, and a forged token refused.
5. Data-level checks (Student A cannot open Student B's record) are added with each module that stores such data, using the grant.

## Open questions

- Should a Teacher see a student's phone or guardian details? Assumed no (SID and name only).
- Does the Admin need to *start* an approval type of their own (for example a discount), or only decide? Assumed only decide.
- Optional subjects (`OPEN`) will change who appears in marks grids, not this matrix.
