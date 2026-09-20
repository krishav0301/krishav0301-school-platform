# Permission matrix

Status: draft for PM review, 2026-09-20. This becomes the single file the code reads, and tests are generated from it. Deny by default: any pair not listed as allowed is denied.

## Reading it

Roles: **STU** Student (parents share the login), **TEA** Teacher, **COO** Co-ordinator, **ACC** Accountant, **ADM** Admin (Principal, Director, trustees), **SUP** Super Admin (build team, shown to the school as "Support").

Cells:
- `—` denied
- `own` own record only
- `assigned` only their assigned subjects or classes
- `class` their class only (Class Teacher)
- `sid+name` sees only SID and name
- `read` read-only
- `inst` the whole institution (a section-scoped assignment narrows this to one section; see D-004)
- `✓` allowed

Phase = the build phase where the action first exists.

## Access and accounts

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Sign in, reset own password | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1 |
| Create Admin account | — | — | — | — | — | ✓ | 1 |
| Create Co-ordinator or Accountant | — | — | — | — | ✓ | ✓ | 1 |
| Create Teacher | — | — | ✓ | — | — | ✓ | 3 |
| Deactivate or reactivate an account | — | — | teachers | — | co-ordinators, accountants | ✓ | 1 |
| Reset lost 2FA | — | — | — | — | — | ✓ | 1 |
| Change branding, signature, seal | — | — | — | — | — | ✓ | 1 |
| Switch persona (demo mode only, logged) | — | — | — | — | — | ✓ | 1 |

## Public website

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| View public site (anyone, no sign-in) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2 |
| Draft content (notice, holiday, routine, vacancy, post) | — | — | ✓ | — | ✓ | ✓ | 2 |
| Publish content directly | — | — | — | — | ✓ | ✓ | 2 |
| Approve a Co-ordinator's draft | — | — | — | — | ✓ | ✓ | 3 |

## Setup

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Manage academic years, programmes, levels, classes, terminals | — | — | inst | — | — | ✓ | 3 |
| Manage subjects, mark components, grading policy | — | — | inst | — | — | ✓ | 3 |
| Assign teachers to subjects; pick the Class Teacher | — | — | inst | — | — | ✓ | 3 |

## Admissions and students

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Submit an application (anonymous, rate limited) | public | — | — | — | — | — | 4 |
| Register a walk-in (auto-approved) | — | — | inst | — | — | ✓ | 4 |
| Register a student (goes to the review queue) | — | — | — | inst | — | — | 4 |
| Review queue: approve, ask for changes, reject | — | — | inst | — | — | ✓ | 4 |
| Search students | — | sid+name (assigned) | inst | inst | inst | ✓ | 4 |
| View personal details | own | — | inst | read | read | ✓ | 4 |
| Correct personal details (reason required; SID never editable) | — | — | inst | — | — | ✓ | 4 |
| Mark Left or Graduated (zero dues only) | — | — | inst | — | — | ✓ | 8 |
| Year rollover: Promote, Repeat, Leaving | — | — | inst | — | — | ✓ | 8 |

## Daily school life

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Mark student attendance (once a day, same-day edits) | — | class | — | — | — | — | 5 |
| View student attendance | own | class | inst | — | read | ✓ | 5 |
| Mark teacher attendance (past days editable with reason) | — | — | inst | — | — | ✓ | 5 |
| View teacher attendance | — | own | inst | — | read | ✓ | 5 |
| Write daily activity log | — | assigned | — | — | — | — | 5 |
| Read daily activity log | own class | assigned | inst | — | read | ✓ | 5 |
| Upload or delete notes and question papers | — | assigned | — | — | — | — | 5 |
| View notes and question papers (watermarked, no download) | own class | assigned | — | — | — | — | 5 |
| Create and grade assignments | — | assigned | — | — | — | — | 5 |
| Submit an assignment | own | — | — | — | — | — | 5 |

## Fees and money

The Co-ordinator has **no** fees access at all.

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Draft yearly fee structure | — | — | — | inst | — | — | 6 |
| Approve fee structure | — | — | — | — | ✓ | — | 6 |
| View fees, dues, ledger | own | — | — | inst | read | ✓ | 6 |
| Upload a payment voucher | own | — | — | — | — | — | 6 |
| Verify or reject a voucher | — | — | — | inst | — | — | 6 |
| Record cash payment | — | — | — | inst | — | — | 6 |
| Propose a discount | — | — | — | inst | — | — | 6 |
| Approve a discount | — | — | — | — | ✓ | — | 6 |
| Request a payment reversal | — | — | — | inst | — | — | 6 |
| Approve a reversal | — | — | — | — | ✓ | — | 6 |
| Request a refund | — | — | — | inst | — | — | 6 |
| Approve a refund | — | — | — | — | ✓ | — | 6 |
| Record how an approved refund was paid | — | — | — | inst | — | — | 6 |
| View and download receipts | own | — | — | inst | read | ✓ | 6 |

## Marks and results

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Enter marks (until verified) | — | assigned | — | — | — | — | 7 |
| Verify, send back, bulk approve | — | — | inst | — | — | ✓ | 7 |
| Publish a whole class (all subjects verified) | — | — | inst | — | — | ✓ | 7 |
| View published results and marks card | own | — | inst | — | read | ✓ | 7 |
| Top 20 | name and rank only, own section, published | — | inst | — | inst | ✓ | 7 |
| Request a recheck | own | — | — | — | — | — | 7 |
| Edit and republish after recheck | — | — | inst | — | — | ✓ | 7 |

## Oversight

| Action | STU | TEA | COO | ACC | ADM | SUP | Phase |
|---|---|---|---|---|---|---|---|
| Approvals inbox: decide (never your own request) | — | — | — | — | ✓ | ✓ | 3 |
| View activity audit trail and sign-ins | — | — | — | — | ✓ | ✓ | 1 |
| Edit or delete an audit entry | — | — | — | — | — | — | 1 |
| Reports and Excel export (students) | — | — | inst | — | inst | ✓ | 4 |
| Reports and Excel export (fees) | — | — | — | inst | inst | ✓ | 6 |
| Reports and Excel export (results) | — | — | inst | — | inst | ✓ | 7 |

## How tests are generated

1. **Every cell** becomes a test. For each role and action, a request is expected to succeed if the cell allows it, and to be denied if it does not.
2. **Cross-record tests:** Student A tries to open Student B's fees, results, files and receipts. A Teacher tries a subject they do not teach.
3. **Cross-scope tests:** run twice, once with the Co-ordinator and Accountant on `inst`, once split per section, to prove that D-004 works. A section-scoped user gets nothing from the other section.
4. **Route coverage:** a test fails if any API route has no action declared (already in place).
5. **Sensitive actions:** every role tries every action in Fees and Oversight.

## Open questions on this matrix

- Should a Teacher see a student's phone or guardian details? Assumed no (SID and name only).
- Does the Admin need to *start* an approval type of their own (for example a discount), or only decide? Assumed only decide.
- Optional subjects (`OPEN`) will change who appears in marks grids, not this matrix.
