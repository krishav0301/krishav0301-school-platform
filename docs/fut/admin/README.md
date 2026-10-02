# Admin (Principal) functional user test (FUT)

Royal Softech College on the school platform. Every operation the Admin (the Principal) can do, run through the real screens, with a screenshot of each step. Run on 2026-10-02 (16 Ashwin 2083) against commit `091a6e5` (main after PR #28) with the F-02 fix, on a fresh local school.

## Summary

- **180 steps** with a screenshot each, in 12 areas, plus **15 server checks** of things the Principal must not do.
- **157 steps behaved as expected**; 23 steps carry one of the findings below.
- **19 findings**: 1 high, 5 medium, 12 low, 1 cosmetic (some are gaps rather than faults).
- **One blocking bug was found and fixed during the test (F-02):** the Principal could not add any programme. The fix and its regression test are in the same commit as this document.
- **Every forbidden action was refused by the server** (403), including approving one's own request. Permission is never left to the screens alone.

## How the test was run

- **School:** a fresh local copy (`wrangler dev`, local D1), the Royal Softech pack provisioned, no sections or programmes to start with (D-087, D-095).
- **The Principal:** Rajendra Prasad Shah, made with `npm run dev:user`. Every step was done in a real browser (Chromium through Playwright) on the real screens, signed in with a password and an authenticator code.
- **The rest of the school:** where a step needs someone else's work first (a Co-ordinator hiring teachers, a teacher marking attendance, the Accountant recording a payment), it was done through the same API their screens use, signed in as those people with their own first-sign-in password change. Those steps are listed as preconditions; they are not part of the Principal's test.
- **Screens:** 1440 px wide unless noted. Times are Nepal time. All names, emails and phone numbers are made up.
- **Re-running:** the scripts are in [`scripts/`](scripts/). `run-all.sh` runs every area in order on a fresh school (see the note at the top of `scripts/lib.cjs`).

### Test data

| What | Made by | Detail |
|---|---|---|
| Sections | Principal (02) | +2 (Grade 11–12), Bachelor's, Master's (renamed Master's Degrees, then switched off) |
| Programmes | Principal (03) | +2 Science, +2 Management (NEB, NEB GPA); BBS (TU), BIT (PU) (percentage and division); MBS made and deleted |
| Co-ordinators | Principal (04) | Sita Sharma (whole school); Hari Prasad Yadav (Bachelor's, then +2 and Bachelor's) |
| Accountants | Principal (04) | Gita Thapa (whole school); Ramesh Shrestha (+2 only; switched off and on again) |
| Year, terminals, classes | Co-ordinator (precondition) | 2083; First terminal, Second terminal, Final; +2 Science Grade 11 A, Grade 12 A, BBS Year 1 |
| Teachers | Co-ordinator (precondition) | Bikash Chaudhary, Anita Mandal, Suresh Karki, Kamala Rai (+2); Puja Singh, Rajan Sah (Bachelor's) |
| Students | Co-ordinator (precondition) | 17 walk-ins: 8 in Grade 11, 4 in Grade 12, 5 in BBS Year 1 (SIDs 2083-00001 to 2083-00017) |
| Daily life | Teachers, Co-ordinator (precondition) | Today's registers (Grade 11 two absent, BBS one absent, Grade 12 not marked), a teacher on leave, activity log entries |
| Results | Teachers, Co-ordinator (precondition) | Grade 11 and BBS Year 1 first terminal published; Grade 11 second terminal partly entered |
| Fees | Accountant (precondition) | Three fee structures sent for approval; charges, cash payments (one sent twice), a bank voucher, an overpayment, a payment on the wrong student; two discounts, a refund and a reversal requested |
| Website drafts | Co-ordinator (precondition) | A notice and an event sent for approval |

## 1. Sign-in and two-step sign-in

First sign-in of a new Principal: wrong input, setting up the authenticator app, recovery codes.

| # | Step | Result | Page |
|---|---|---|---|
| [01-01](#01-01-portal-redirects-to-sign-in) | Opening the portal while signed out goes to the sign-in page | Pass | `/sign-in` |
| [01-02](#01-02-sign-in-empty) | Sign in with nothing typed: both fields are asked for | Pass | `/sign-in` |
| [01-03](#01-03-sign-in-wrong-password) | A wrong password: a plain message that does not say which part is wrong | Pass | `/sign-in` |
| [01-04](#01-04-sign-in-show-password) | Show password reveals what was typed before signing in | Pass | `/sign-in` |
| [01-05](#01-05-two-step-setup) | First sign-in of a Principal: two-step sign-in must be set up (QR code and setup key) | Pass | `/sign-in` |
| [01-06](#01-06-two-step-setup-wrong-code) | A wrong code from the app is refused | Pass | `/sign-in` |
| [01-07](#01-07-recovery-codes) | Ten recovery codes are shown once (blurred here would be wise in a real school) | Pass | `/sign-in` |
| [01-08](#01-08-first-dashboard-empty-school) | Signed in: the Principal's dashboard on a brand-new school with no data | Pass | `/portal` |

<a id="01-01-portal-redirects-to-sign-in"></a>
**01-01** Opening the portal while signed out goes to the sign-in page

![Opening the portal while signed out goes to the sign-in page](screens/01-01-portal-redirects-to-sign-in.jpg)

<a id="01-02-sign-in-empty"></a>
**01-02** Sign in with nothing typed: both fields are asked for

![Sign in with nothing typed: both fields are asked for](screens/01-02-sign-in-empty.jpg)

<a id="01-03-sign-in-wrong-password"></a>
**01-03** A wrong password: a plain message that does not say which part is wrong

![A wrong password: a plain message that does not say which part is wrong](screens/01-03-sign-in-wrong-password.jpg)

<a id="01-04-sign-in-show-password"></a>
**01-04** Show password reveals what was typed before signing in

![Show password reveals what was typed before signing in](screens/01-04-sign-in-show-password.jpg)

<a id="01-05-two-step-setup"></a>
**01-05** First sign-in of a Principal: two-step sign-in must be set up (QR code and setup key)

![First sign-in of a Principal: two-step sign-in must be set up (QR code and setup key)](screens/01-05-two-step-setup.jpg)

<a id="01-06-two-step-setup-wrong-code"></a>
**01-06** A wrong code from the app is refused

![A wrong code from the app is refused](screens/01-06-two-step-setup-wrong-code.jpg)

<a id="01-07-recovery-codes"></a>
**01-07** Ten recovery codes are shown once (blurred here would be wise in a real school)

![Ten recovery codes are shown once (blurred here would be wise in a real school)](screens/01-07-recovery-codes.jpg)

<a id="01-08-first-dashboard-empty-school"></a>
**01-08** Signed in: the Principal's dashboard on a brand-new school with no data

![Signed in: the Principal's dashboard on a brand-new school with no data](screens/01-08-first-dashboard-empty-school.jpg)

## 2. Programs: sections

The Principal builds the school's sections (D-095). No section is built in: a new school starts with none.

| # | Step | Result | Page |
|---|---|---|---|
| [02-01](#02-01-programs-empty) | Programs (Academic Structure) on a new school: no sections yet, one action to start | Pass | `/portal/setup/programmes` |
| [02-02](#02-02-section-name-required) | Add a Section with no name: the name is asked for | Pass | `/portal/setup/programmes` |
| [02-03](#02-03-section-name-typed) | Add a Section: typing the section's name | Pass | `/portal/setup/programmes` |
| [02-04](#02-04-first-section-added) | The first section is added, with no programmes in it yet | Pass | `/portal/setup/programmes` |
| [02-05](#02-05-three-sections) | Three sections: +2, Bachelor's and Master's | Pass | `/portal/setup/programmes` |
| [02-06](#02-06-section-duplicate-name) | A second section with the same name is refused ("That already exists."); the message shows on the page behind the dialog (finding F-01) | See F-01 | `/portal/setup/programmes` |

<a id="02-01-programs-empty"></a>
**02-01** Programs (Academic Structure) on a new school: no sections yet, one action to start

![Programs (Academic Structure) on a new school: no sections yet, one action to start](screens/02-01-programs-empty.jpg)

<a id="02-02-section-name-required"></a>
**02-02** Add a Section with no name: the name is asked for

![Add a Section with no name: the name is asked for](screens/02-02-section-name-required.jpg)

<a id="02-03-section-name-typed"></a>
**02-03** Add a Section: typing the section's name

![Add a Section: typing the section's name](screens/02-03-section-name-typed.jpg)

<a id="02-04-first-section-added"></a>
**02-04** The first section is added, with no programmes in it yet

![The first section is added, with no programmes in it yet](screens/02-04-first-section-added.jpg)

<a id="02-05-three-sections"></a>
**02-05** Three sections: +2, Bachelor's and Master's

![Three sections: +2, Bachelor's and Master's](screens/02-05-three-sections.jpg)

<a id="02-06-section-duplicate-name"></a>
**02-06** A second section with the same name is refused ("That already exists."); the message shows on the page behind the dialog (finding F-01)

![A second section with the same name is refused ("That already exists."); the message shows on the page behind the dialog (finding F-01)](screens/02-06-section-duplicate-name.jpg)

## 3. Programs: programmes, levels and grading

Programmes inside sections, their levels, the grading policy, rename, switch off and on, delete.

| # | Step | Result | Page |
|---|---|---|---|
| [03-01](#03-01-programme-name-required) | Add a Programme with no name: the name is asked for | Pass | `/portal/setup/programmes` |
| [03-02](#03-02-programme-form-filled) | Add a Programme: name and affiliation | See F-02 | `/portal/setup/programmes` |
| [03-03](#03-03-programme-added) | The programme is added to the +2 section, with no levels yet | Pass | `/portal/setup/programmes` |
| [03-04](#03-04-level-name-required) | Add a Level with no name: the name is asked for | Pass | `/portal/setup/programmes` |
| [03-05](#03-05-levels-added) | +2 Science now has Grade 11 and Grade 12 | Pass | `/portal/setup/programmes` |
| [03-06](#03-06-full-structure) | The full structure: 3 sections, 5 programmes, 11 levels | Pass | `/portal/setup/programmes` |
| [03-07](#03-07-programme-edit) | Edit a programme: name, affiliation and grading (results cannot be published until grading is set) | Pass | `/portal/setup/programmes` |
| [03-08](#03-08-grading-set) | Grading set: NEB GPA for +2, percentage and division for the bachelor's and master's programmes | Pass | `/portal/setup/programmes` |
| [03-09](#03-09-level-options) | A level's options: rename, switch off, delete (delete only while nothing is attached) | Pass | `/portal/setup/programmes` |
| [03-10](#03-10-level-renamed) | The level is renamed to Year 1 | Pass | `/portal/setup/programmes` |
| [03-11](#03-11-level-switched-off) | The level is switched off: it stays, marked Switched off, and nothing is lost | Pass | `/portal/setup/programmes` |
| [03-12](#03-12-level-delete-confirm) | Delete asks once more, because it cannot be undone | Pass | `/portal/setup/programmes` |
| [03-13](#03-13-programme-deleted) | The empty MBS programme is deleted | Pass | `/portal/setup/programmes` |
| [03-14](#03-14-section-edit) | Edit a section: rename, switch off, delete | Pass | `/portal/setup/programmes` |
| [03-15](#03-15-section-switched-off) | Master's Degrees is renamed and switched off: kept, but no longer offered | Pass | `/portal/setup/programmes` |
| [03-16](#03-16-section-in-use-no-delete) | A section with programmes cannot be deleted: it says why and suggests switching it off | Pass | `/portal/setup/programmes` |

<a id="03-01-programme-name-required"></a>
**03-01** Add a Programme with no name: the name is asked for

![Add a Programme with no name: the name is asked for](screens/03-01-programme-name-required.jpg)

<a id="03-02-programme-form-filled"></a>
**03-02** Add a Programme: name and affiliation

![Add a Programme: name and affiliation](screens/03-02-programme-form-filled.jpg)

<a id="03-03-programme-added"></a>
**03-03** The programme is added to the +2 section, with no levels yet

![The programme is added to the +2 section, with no levels yet](screens/03-03-programme-added.jpg)

<a id="03-04-level-name-required"></a>
**03-04** Add a Level with no name: the name is asked for

![Add a Level with no name: the name is asked for](screens/03-04-level-name-required.jpg)

<a id="03-05-levels-added"></a>
**03-05** +2 Science now has Grade 11 and Grade 12

![+2 Science now has Grade 11 and Grade 12](screens/03-05-levels-added.jpg)

<a id="03-06-full-structure"></a>
**03-06** The full structure: 3 sections, 5 programmes, 11 levels

![The full structure: 3 sections, 5 programmes, 11 levels](screens/03-06-full-structure.jpg)

<a id="03-07-programme-edit"></a>
**03-07** Edit a programme: name, affiliation and grading (results cannot be published until grading is set)

![Edit a programme: name, affiliation and grading (results cannot be published until grading is set)](screens/03-07-programme-edit.jpg)

<a id="03-08-grading-set"></a>
**03-08** Grading set: NEB GPA for +2, percentage and division for the bachelor's and master's programmes

![Grading set: NEB GPA for +2, percentage and division for the bachelor's and master's programmes](screens/03-08-grading-set.jpg)

<a id="03-09-level-options"></a>
**03-09** A level's options: rename, switch off, delete (delete only while nothing is attached)

![A level's options: rename, switch off, delete (delete only while nothing is attached)](screens/03-09-level-options.jpg)

<a id="03-10-level-renamed"></a>
**03-10** The level is renamed to Year 1

![The level is renamed to Year 1](screens/03-10-level-renamed.jpg)

<a id="03-11-level-switched-off"></a>
**03-11** The level is switched off: it stays, marked Switched off, and nothing is lost

![The level is switched off: it stays, marked Switched off, and nothing is lost](screens/03-11-level-switched-off.jpg)

<a id="03-12-level-delete-confirm"></a>
**03-12** Delete asks once more, because it cannot be undone

![Delete asks once more, because it cannot be undone](screens/03-12-level-delete-confirm.jpg)

<a id="03-13-programme-deleted"></a>
**03-13** The empty MBS programme is deleted

![The empty MBS programme is deleted](screens/03-13-programme-deleted.jpg)

<a id="03-14-section-edit"></a>
**03-14** Edit a section: rename, switch off, delete

![Edit a section: rename, switch off, delete](screens/03-14-section-edit.jpg)

<a id="03-15-section-switched-off"></a>
**03-15** Master's Degrees is renamed and switched off: kept, but no longer offered

![Master's Degrees is renamed and switched off: kept, but no longer offered](screens/03-15-section-switched-off.jpg)

<a id="03-16-section-in-use-no-delete"></a>
**03-16** A section with programmes cannot be deleted: it says why and suggests switching it off

![A section with programmes cannot be deleted: it says why and suggests switching it off](screens/03-16-section-in-use-no-delete.jpg)

## 4. People & Access: Co-ordinators and Accountants

The Principal gives access to Co-ordinators and Accountants (never teachers), chooses where it reaches, and manages it (D-099).

| # | Step | Result | Page |
|---|---|---|---|
| [04-01](#04-01-people-empty) | People & Access on a new school: counts at zero, How access works, no staff yet | Pass | `/portal/people` |
| [04-02](#04-02-how-access-works) | How access works, opened: who gives access to whom | Pass | `/portal/people` |
| [04-03](#04-03-add-step-role) | Add a person, step 1 Role: only Co-ordinator or Accountant; teachers are added by a Co-ordinator | Pass | `/portal/people` |
| [04-04](#04-04-add-role-required) | Next without a role: Choose a role | Pass | `/portal/people` |
| [04-05](#04-05-add-details-invalid) | Step 2 Details: a one-letter name, a bad email and a too-short phone are each explained | Pass | `/portal/people` |
| [04-06](#04-06-add-details-filled) | Step 2 Details filled in | Pass | `/portal/people` |
| [04-07](#04-07-add-access-none-chosen) | Step 3 Access: Selected sections with none ticked is refused | Pass | `/portal/people` |
| [04-08](#04-08a-add-access-whole) | Step 3 Access: the whole school | Pass | `/portal/people` |
| [04-08](#04-08b-add-access-sections) | Step 3 Access: only the sections chosen (the switched-off Master's Degrees is not offered) | Pass | `/portal/people` |
| [04-09](#04-09-add-review) | Step 4 Review: everything once more before the account is made | Pass | `/portal/people` |
| [04-10](#04-10-temporary-password) | The temporary password is shown once, to give to the person; they must change it at first sign-in | Pass | `/portal/people` |
| [04-11](#04-11-four-staff) | Four staff: two Co-ordinators and two Accountants, whole school or one section each | Pass | `/portal/people` |
| [04-12](#04-12-duplicate-email) | An email already in use is refused, and nothing typed is lost | Pass | `/portal/people` |
| [04-13](#04-13-manage-access) | Manage access: the person, role, account, sign-in, where their access reaches, and what the role can do | Pass | `/portal/people` |
| [04-14](#04-14-manage-access-changed) | Adding +2 to Hari's sections: Save access is now available | Pass | `/portal/people` |
| [04-15](#04-15-access-saved) | Access saved: Hari now reaches +2 and Bachelor's | Pass | `/portal/people` |
| [04-16](#04-16-switched-off) | Ramesh is switched off: kept, marked Inactive, cannot sign in; nothing is deleted | Pass | `/portal/people` |
| [04-17](#04-17-row-menu-inactive) | The row's More menu for a switched-off person | Pass | `/portal/people` |
| [04-18](#04-18-switched-on) | Ramesh is switched on again; he can sign in once more | Pass | `/portal/people` |
| [04-19](#04-19-new-temporary-password) | Manage access › New temporary password for Gita: shown once, on the page, to give her in person | Pass | `/portal/people` |
| [04-20](#04-20-search) | Search 'hari': only Hari Prasad Yadav | Pass | `/portal/people` |
| [04-21](#04-21-search-none) | A search that matches nobody says so | Pass | `/portal/people` |
| [04-22](#04-22-filter-role) | Filter Role: Accountants only | Pass | `/portal/people` |
| [04-23](#04-23-filter-access) | Filter Access: the first section choice | Pass | `/portal/people` |
| [04-24](#04-24-teaching-empty) | Teaching tab before any teacher exists: teachers are added by a Co-ordinator | Pass | `/portal/people` |

<a id="04-01-people-empty"></a>
**04-01** People & Access on a new school: counts at zero, How access works, no staff yet

![People & Access on a new school: counts at zero, How access works, no staff yet](screens/04-01-people-empty.jpg)

<a id="04-02-how-access-works"></a>
**04-02** How access works, opened: who gives access to whom

![How access works, opened: who gives access to whom](screens/04-02-how-access-works.jpg)

<a id="04-03-add-step-role"></a>
**04-03** Add a person, step 1 Role: only Co-ordinator or Accountant; teachers are added by a Co-ordinator

![Add a person, step 1 Role: only Co-ordinator or Accountant; teachers are added by a Co-ordinator](screens/04-03-add-step-role.jpg)

<a id="04-04-add-role-required"></a>
**04-04** Next without a role: Choose a role

![Next without a role: Choose a role](screens/04-04-add-role-required.jpg)

<a id="04-05-add-details-invalid"></a>
**04-05** Step 2 Details: a one-letter name, a bad email and a too-short phone are each explained

![Step 2 Details: a one-letter name, a bad email and a too-short phone are each explained](screens/04-05-add-details-invalid.jpg)

<a id="04-06-add-details-filled"></a>
**04-06** Step 2 Details filled in

![Step 2 Details filled in](screens/04-06-add-details-filled.jpg)

<a id="04-07-add-access-none-chosen"></a>
**04-07** Step 3 Access: Selected sections with none ticked is refused

![Step 3 Access: Selected sections with none ticked is refused](screens/04-07-add-access-none-chosen.jpg)

<a id="04-08a-add-access-whole"></a>
**04-08** Step 3 Access: the whole school

![Step 3 Access: the whole school](screens/04-08a-add-access-whole.jpg)

<a id="04-08b-add-access-sections"></a>
**04-08** Step 3 Access: only the sections chosen (the switched-off Master's Degrees is not offered)

![Step 3 Access: only the sections chosen (the switched-off Master's Degrees is not offered)](screens/04-08b-add-access-sections.jpg)

<a id="04-09-add-review"></a>
**04-09** Step 4 Review: everything once more before the account is made

![Step 4 Review: everything once more before the account is made](screens/04-09-add-review.jpg)

<a id="04-10-temporary-password"></a>
**04-10** The temporary password is shown once, to give to the person; they must change it at first sign-in

![The temporary password is shown once, to give to the person; they must change it at first sign-in](screens/04-10-temporary-password.jpg)

<a id="04-11-four-staff"></a>
**04-11** Four staff: two Co-ordinators and two Accountants, whole school or one section each

![Four staff: two Co-ordinators and two Accountants, whole school or one section each](screens/04-11-four-staff.jpg)

<a id="04-12-duplicate-email"></a>
**04-12** An email already in use is refused, and nothing typed is lost

![An email already in use is refused, and nothing typed is lost](screens/04-12-duplicate-email.jpg)

<a id="04-13-manage-access"></a>
**04-13** Manage access: the person, role, account, sign-in, where their access reaches, and what the role can do

![Manage access: the person, role, account, sign-in, where their access reaches, and what the role can do](screens/04-13-manage-access.jpg)

<a id="04-14-manage-access-changed"></a>
**04-14** Adding +2 to Hari's sections: Save access is now available

![Adding +2 to Hari's sections: Save access is now available](screens/04-14-manage-access-changed.jpg)

<a id="04-15-access-saved"></a>
**04-15** Access saved: Hari now reaches +2 and Bachelor's

![Access saved: Hari now reaches +2 and Bachelor's](screens/04-15-access-saved.jpg)

<a id="04-16-switched-off"></a>
**04-16** Ramesh is switched off: kept, marked Inactive, cannot sign in; nothing is deleted

![Ramesh is switched off: kept, marked Inactive, cannot sign in; nothing is deleted](screens/04-16-switched-off.jpg)

<a id="04-17-row-menu-inactive"></a>
**04-17** The row's More menu for a switched-off person

![The row's More menu for a switched-off person](screens/04-17-row-menu-inactive.jpg)

<a id="04-18-switched-on"></a>
**04-18** Ramesh is switched on again; he can sign in once more

![Ramesh is switched on again; he can sign in once more](screens/04-18-switched-on.jpg)

<a id="04-19-new-temporary-password"></a>
**04-19** Manage access › New temporary password for Gita: shown once, on the page, to give her in person

![Manage access › New temporary password for Gita: shown once, on the page, to give her in person](screens/04-19-new-temporary-password.jpg)

<a id="04-20-search"></a>
**04-20** Search 'hari': only Hari Prasad Yadav

![Search 'hari': only Hari Prasad Yadav](screens/04-20-search.jpg)

<a id="04-21-search-none"></a>
**04-21** A search that matches nobody says so

![A search that matches nobody says so](screens/04-21-search-none.jpg)

<a id="04-22-filter-role"></a>
**04-22** Filter Role: Accountants only

![Filter Role: Accountants only](screens/04-22-filter-role.jpg)

<a id="04-23-filter-access"></a>
**04-23** Filter Access: the first section choice

![Filter Access: the first section choice](screens/04-23-filter-access.jpg)

<a id="04-24-teaching-empty"></a>
**04-24** Teaching tab before any teacher exists: teachers are added by a Co-ordinator

![Teaching tab before any teacher exists: teachers are added by a Co-ordinator](screens/04-24-teaching-empty.jpg)

## 5. Approvals: fee structures and website drafts

Requests from the Accountant and the Co-ordinator, approved or declined with a reason.

**Precondition (P1):** the Co-ordinator set up the year, classes, subjects, teachers and 17 students; teachers marked attendance, wrote the activity log and entered marks; results were published; the Accountant sent three fee structures; the Co-ordinator sent two website drafts.

| # | Step | Result | Page |
|---|---|---|---|
| [05-01](#05-01-dashboard-with-requests) | The dashboard once the school is running: counts, attendance, and five requests needing the Principal | See F-04, F-05, F-11 | `/portal` |
| [05-02](#05-02-approvals-inbox) | Approvals inbox: three fee structures from the Accountant and two website drafts from the Co-ordinator | Pass | `/portal/approvals` |
| [05-03](#05-03-fee-structure-approved) | Grade 11 fee structure approved: it leaves the inbox and becomes the live structure | Pass | `/portal/approvals` |
| [05-04](#05-04-decline-opened) | Decline opens a box for the reason; the Decline button stays disabled until a reason is written | Pass | `/portal/approvals` |
| [05-05](#05-05-fee-structure-declined) | BBS Year 1 fee structure declined with a reason; it goes back to the Accountant | Pass | `/portal/approvals` |
| [05-06](#05-06-notice-approved) | Grade 12 fees and the Co-ordinator's notice approved; the notice is published on the website at once | Pass | `/portal/approvals` |
| [05-07](#05-07-inbox-empty) | Every request decided: the inbox is empty and the menu badge is gone | See F-03 | `/portal/approvals` |

<a id="05-01-dashboard-with-requests"></a>
**05-01** The dashboard once the school is running: counts, attendance, and five requests needing the Principal

![The dashboard once the school is running: counts, attendance, and five requests needing the Principal](screens/05-01-dashboard-with-requests.jpg)

<a id="05-02-approvals-inbox"></a>
**05-02** Approvals inbox: three fee structures from the Accountant and two website drafts from the Co-ordinator

![Approvals inbox: three fee structures from the Accountant and two website drafts from the Co-ordinator](screens/05-02-approvals-inbox.jpg)

<a id="05-03-fee-structure-approved"></a>
**05-03** Grade 11 fee structure approved: it leaves the inbox and becomes the live structure

![Grade 11 fee structure approved: it leaves the inbox and becomes the live structure](screens/05-03-fee-structure-approved.jpg)

<a id="05-04-decline-opened"></a>
**05-04** Decline opens a box for the reason; the Decline button stays disabled until a reason is written

![Decline opens a box for the reason; the Decline button stays disabled until a reason is written](screens/05-04-decline-opened.jpg)

<a id="05-05-fee-structure-declined"></a>
**05-05** BBS Year 1 fee structure declined with a reason; it goes back to the Accountant

![BBS Year 1 fee structure declined with a reason; it goes back to the Accountant](screens/05-05-fee-structure-declined.jpg)

<a id="05-06-notice-approved"></a>
**05-06** Grade 12 fees and the Co-ordinator's notice approved; the notice is published on the website at once

![Grade 12 fees and the Co-ordinator's notice approved; the notice is published on the website at once](screens/05-06-notice-approved.jpg)

<a id="05-07-inbox-empty"></a>
**05-07** Every request decided: the inbox is empty and the menu badge is gone

![Every request decided: the inbox is empty and the menu badge is gone](screens/05-07-inbox-empty.jpg)

## 6. Approvals: money requests

Discounts, a refund, a payment reversal and a corrected fee structure. Approve-and-apply happens once, even from two tabs.

**Precondition (P2):** the Accountant charged the approved fee structures, recorded payments and a verified voucher, and sent two discounts, a refund, a reversal and the corrected BBS fee structure for approval.

| # | Step | Result | Page |
|---|---|---|---|
| [06-01](#06-01-money-requests) | The Accountant's requests: two discounts, a refund, a payment reversal and the corrected BBS fee structure | See F-06 | `/portal/approvals` |
| [06-02](#06-02-discount-approved) | Sita Chaudhary's discount approved: it is added to her fee account in the same step | Pass | `/portal/approvals` |
| [06-03](#06-03-discount-decline-reason) | Declining Rohan Sah's 50% discount, with the reason the Accountant will see | Pass | `/portal/approvals` |
| [06-04](#06-04-refund-approved) | Puja Yadav's refund approved; the Accountant can now record how it was paid | Pass | `/portal/approvals` |
| [06-05](#06-05-refund-already-decided) | The same refund approved again from a second, older tab: refused as already decided; nothing is applied twice | See F-07 | `/portal/approvals` |
| [06-06](#06-06-all-decided) | The reversal and the corrected BBS structure approved; nothing is waiting | Pass | `/portal/approvals` |

<a id="06-01-money-requests"></a>
**06-01** The Accountant's requests: two discounts, a refund, a payment reversal and the corrected BBS fee structure

![The Accountant's requests: two discounts, a refund, a payment reversal and the corrected BBS fee structure](screens/06-01-money-requests.jpg)

<a id="06-02-discount-approved"></a>
**06-02** Sita Chaudhary's discount approved: it is added to her fee account in the same step

![Sita Chaudhary's discount approved: it is added to her fee account in the same step](screens/06-02-discount-approved.jpg)

<a id="06-03-discount-decline-reason"></a>
**06-03** Declining Rohan Sah's 50% discount, with the reason the Accountant will see

![Declining Rohan Sah's 50% discount, with the reason the Accountant will see](screens/06-03-discount-decline-reason.jpg)

<a id="06-04-refund-approved"></a>
**06-04** Puja Yadav's refund approved; the Accountant can now record how it was paid

![Puja Yadav's refund approved; the Accountant can now record how it was paid](screens/06-04-refund-approved.jpg)

<a id="06-05-refund-already-decided"></a>
**06-05** The same refund approved again from a second, older tab: refused as already decided; nothing is applied twice

![The same refund approved again from a second, older tab: refused as already decided; nothing is applied twice](screens/06-05-refund-already-decided.jpg)

<a id="06-06-all-decided"></a>
**06-06** The reversal and the corrected BBS structure approved; nothing is waiting

![The reversal and the corrected BBS structure approved; nothing is waiting](screens/06-06-all-decided.jpg)

## 7. Reading the school: attendance, classwork, fees, results, reports

Everything the Principal reads but does not change.

| # | Step | Result | Page |
|---|---|---|---|
| [07-01](#07-01-attendance-classes) | Attendance: today's register for each class; Grade 12 has not been marked yet | Pass | `/portal/attendance` |
| [07-02](#07-02-attendance-class) | A class's register for today (two absent) and the year so far; the Principal can look but not mark | Pass | `/portal/attendance/class?id=daedf06dcee94d2a0bc6893e4c4ff8f7` |
| [07-03](#07-03-attendance-not-marked) | Grade 12: no register marked yet today | Pass | `/portal/attendance/class?id=080a4f2cbc4ce347bd60c68c24daf5d1` |
| [07-04](#07-04-teacher-attendance) | Teacher attendance for today, marked by the Co-ordinator (Suresh Karki on leave); read only for the Principal | Pass | `/portal/attendance/teachers` |
| [07-05](#07-05a-incomplete-date) | A date with only the day filled in (no month or year) is refused, but the message says the day is not in the verified calendar (finding F-19) | See F-19 | `/portal/attendance/teachers` |
| [07-05](#07-05b-teacher-attendance-other-day) | Another day, 15 Ashwin 2083: nothing was marked that day | Pass | `/portal/attendance/teachers` |
| [07-06](#07-06-unverified-year) | 1 Baisakh 2090, outside the verified calendar (2000 to 2083), is refused | Pass | `/portal/attendance/teachers` |
| [07-07](#07-07-classwork) | Classwork: today's activity log for each class | Pass | `/portal/classwork` |
| [07-08](#07-08-classwork-class) | Grade 11's activity log today: what each subject teacher wrote, and the subjects with nothing yet | Pass | `/portal/classwork/class?id=daedf06dcee94d2a0bc6893e4c4ff8f7` |
| [07-09](#07-09-fees-find) | Fees: find a student's fee account by name, SID or phone | Pass | `/portal/fees` |
| [07-10](#07-10-fees-search) | Searching 'Sita': the matching student | Pass | `/portal/fees` |
| [07-11](#07-11-fee-account-discount) | Sita Chaudhary's fee account: charges, her cash payment and the approved 10% discount; the balance is worked out, never stored | Pass | `/portal/fees/student?id=30d515cbc43ccd140b245a15df9c29a2` |
| [07-12](#07-12-fee-account-refund) | Puja Yadav (found by SID): overpaid, with the approved refund | Pass | `/portal/fees/student?id=e838ebbbbddb9b39aee3c880a4b041f2` |
| [07-13](#07-13-fee-account-reversal) | Nabin Thakur: the wrong payment and its approved reversal, both kept in the ledger | Pass | `/portal/fees/student?id=fee0ef79302feab3630b105ea5a23ac4` |
| [07-14](#07-14-fee-account-receipts) | Aarav Mandal: a cash payment (sent twice, recorded once) and a verified bank voucher, each with a receipt | Pass | `/portal/fees/student?id=82296920a0c77f9c97e279f5a35898bd` |
| [07-15](#07-15-receipt) | A receipt, generated from the ledger, never edited | See F-18 | `/portal/fees/receipt?id=97615db160f9e834b512cdb992ee3a62` |
| [07-16](#07-16-fees-search-none) | A search that finds nobody | Pass | `/portal/fees` |
| [07-17](#07-17-fee-structures) | Fee structures for the year: live (approved) ones | Pass | `/portal/fees/structures` |
| [07-18](#07-18-fee-structure) | The Grade 11 fee structure: monthly, yearly and one-time items; read only for the Principal | Pass | `/portal/fees/structure?id=8d6a970b53c236146e4ae3f0e6486bea` |
| [07-19](#07-19-dues) | Dues: what each student owes and how much is overdue, with a CSV download | See F-10 | `/portal/fees/dues` |
| [07-20](#07-20-results-changes) | Results: changes after publishing (rechecks); none yet | Pass | `/portal/results` |
| [07-21](#07-21-class-sheets) | Class sheets: choose a class and a published terminal | Pass | `/portal/results/sheets` |
| [07-22](#07-22-class-sheet) | Grade 11, first terminal: every student's NEB grades and GPA, ranked; ties share a rank | Pass | `/portal/results/sheets` |
| [07-23](#07-23-top20) | Top 20, ranked per section, only from published results | Pass | `/portal/results/top20` |
| [07-24](#07-24-reports) | Reports: everything the Principal reads but does not change, in one place | Pass | `/portal/reports` |
| [07-25](#07-25-setup) | Academic years: the current year and its dates (read only for the Principal) | Pass | `/portal/setup` |
| [07-26](#07-26-classes) | Classes this year (read only) | Pass | `/portal/setup/classes` |
| [07-27](#07-27-terminals) | Terminals of the year (read only) | Pass | `/portal/setup/terminals` |
| [07-28](#07-28-subjects) | The school's subjects (read only) | Pass | `/portal/setup/subjects` |
| [07-29](#07-29-curriculum) | Curriculum: what each level studies, credit hours and marks (read only) | Pass | `/portal/setup/curriculum` |
| [07-30](#07-30-teaching) | Teaching: who teaches what, and each Class Teacher | Pass | `/portal/people/teaching` |
| [07-31](#07-31-student-search) | Find a student: 'Rai' finds Suman Rai | See F-09 | `/portal/admissions/search` |
| [07-33](#07-33-register-tab-not-allowed) | The Register tab beside Student search, opened by the Principal | See F-08 | `/portal/admissions/register` |

<a id="07-01-attendance-classes"></a>
**07-01** Attendance: today's register for each class; Grade 12 has not been marked yet

![Attendance: today's register for each class; Grade 12 has not been marked yet](screens/07-01-attendance-classes.jpg)

<a id="07-02-attendance-class"></a>
**07-02** A class's register for today (two absent) and the year so far; the Principal can look but not mark

![A class's register for today (two absent) and the year so far; the Principal can look but not mark](screens/07-02-attendance-class.jpg)

<a id="07-03-attendance-not-marked"></a>
**07-03** Grade 12: no register marked yet today

![Grade 12: no register marked yet today](screens/07-03-attendance-not-marked.jpg)

<a id="07-04-teacher-attendance"></a>
**07-04** Teacher attendance for today, marked by the Co-ordinator (Suresh Karki on leave); read only for the Principal

![Teacher attendance for today, marked by the Co-ordinator (Suresh Karki on leave); read only for the Principal](screens/07-04-teacher-attendance.jpg)

<a id="07-05a-incomplete-date"></a>
**07-05** A date with only the day filled in (no month or year) is refused, but the message says the day is not in the verified calendar (finding F-19)

![A date with only the day filled in (no month or year) is refused, but the message says the day is not in the verified calendar (finding F-19)](screens/07-05a-incomplete-date.jpg)

<a id="07-05b-teacher-attendance-other-day"></a>
**07-05** Another day, 15 Ashwin 2083: nothing was marked that day

![Another day, 15 Ashwin 2083: nothing was marked that day](screens/07-05b-teacher-attendance-other-day.jpg)

<a id="07-06-unverified-year"></a>
**07-06** 1 Baisakh 2090, outside the verified calendar (2000 to 2083), is refused

![1 Baisakh 2090, outside the verified calendar (2000 to 2083), is refused](screens/07-06-unverified-year.jpg)

<a id="07-07-classwork"></a>
**07-07** Classwork: today's activity log for each class

![Classwork: today's activity log for each class](screens/07-07-classwork.jpg)

<a id="07-08-classwork-class"></a>
**07-08** Grade 11's activity log today: what each subject teacher wrote, and the subjects with nothing yet

![Grade 11's activity log today: what each subject teacher wrote, and the subjects with nothing yet](screens/07-08-classwork-class.jpg)

<a id="07-09-fees-find"></a>
**07-09** Fees: find a student's fee account by name, SID or phone

![Fees: find a student's fee account by name, SID or phone](screens/07-09-fees-find.jpg)

<a id="07-10-fees-search"></a>
**07-10** Searching 'Sita': the matching student

![Searching 'Sita': the matching student](screens/07-10-fees-search.jpg)

<a id="07-11-fee-account-discount"></a>
**07-11** Sita Chaudhary's fee account: charges, her cash payment and the approved 10% discount; the balance is worked out, never stored

![Sita Chaudhary's fee account: charges, her cash payment and the approved 10% discount; the balance is worked out, never stored](screens/07-11-fee-account-discount.jpg)

<a id="07-12-fee-account-refund"></a>
**07-12** Puja Yadav (found by SID): overpaid, with the approved refund

![Puja Yadav (found by SID): overpaid, with the approved refund](screens/07-12-fee-account-refund.jpg)

<a id="07-13-fee-account-reversal"></a>
**07-13** Nabin Thakur: the wrong payment and its approved reversal, both kept in the ledger

![Nabin Thakur: the wrong payment and its approved reversal, both kept in the ledger](screens/07-13-fee-account-reversal.jpg)

<a id="07-14-fee-account-receipts"></a>
**07-14** Aarav Mandal: a cash payment (sent twice, recorded once) and a verified bank voucher, each with a receipt

![Aarav Mandal: a cash payment (sent twice, recorded once) and a verified bank voucher, each with a receipt](screens/07-14-fee-account-receipts.jpg)

<a id="07-15-receipt"></a>
**07-15** A receipt, generated from the ledger, never edited

![A receipt, generated from the ledger, never edited](screens/07-15-receipt.jpg)

<a id="07-16-fees-search-none"></a>
**07-16** A search that finds nobody

![A search that finds nobody](screens/07-16-fees-search-none.jpg)

<a id="07-17-fee-structures"></a>
**07-17** Fee structures for the year: live (approved) ones

![Fee structures for the year: live (approved) ones](screens/07-17-fee-structures.jpg)

<a id="07-18-fee-structure"></a>
**07-18** The Grade 11 fee structure: monthly, yearly and one-time items; read only for the Principal

![The Grade 11 fee structure: monthly, yearly and one-time items; read only for the Principal](screens/07-18-fee-structure.jpg)

<a id="07-19-dues"></a>
**07-19** Dues: what each student owes and how much is overdue, with a CSV download

![Dues: what each student owes and how much is overdue, with a CSV download](screens/07-19-dues.jpg)

<a id="07-20-results-changes"></a>
**07-20** Results: changes after publishing (rechecks); none yet

![Results: changes after publishing (rechecks); none yet](screens/07-20-results-changes.jpg)

<a id="07-21-class-sheets"></a>
**07-21** Class sheets: choose a class and a published terminal

![Class sheets: choose a class and a published terminal](screens/07-21-class-sheets.jpg)

<a id="07-22-class-sheet"></a>
**07-22** Grade 11, first terminal: every student's NEB grades and GPA, ranked; ties share a rank

![Grade 11, first terminal: every student's NEB grades and GPA, ranked; ties share a rank](screens/07-22-class-sheet.jpg)

<a id="07-23-top20"></a>
**07-23** Top 20, ranked per section, only from published results

![Top 20, ranked per section, only from published results](screens/07-23-top20.jpg)

<a id="07-24-reports"></a>
**07-24** Reports: everything the Principal reads but does not change, in one place

![Reports: everything the Principal reads but does not change, in one place](screens/07-24-reports.jpg)

<a id="07-25-setup"></a>
**07-25** Academic years: the current year and its dates (read only for the Principal)

![Academic years: the current year and its dates (read only for the Principal)](screens/07-25-setup.jpg)

<a id="07-26-classes"></a>
**07-26** Classes this year (read only)

![Classes this year (read only)](screens/07-26-classes.jpg)

<a id="07-27-terminals"></a>
**07-27** Terminals of the year (read only)

![Terminals of the year (read only)](screens/07-27-terminals.jpg)

<a id="07-28-subjects"></a>
**07-28** The school's subjects (read only)

![The school's subjects (read only)](screens/07-28-subjects.jpg)

<a id="07-29-curriculum"></a>
**07-29** Curriculum: what each level studies, credit hours and marks (read only)

![Curriculum: what each level studies, credit hours and marks (read only)](screens/07-29-curriculum.jpg)

<a id="07-30-teaching"></a>
**07-30** Teaching: who teaches what, and each Class Teacher

![Teaching: who teaches what, and each Class Teacher](screens/07-30-teaching.jpg)

<a id="07-31-student-search"></a>
**07-31** Find a student: 'Rai' finds Suman Rai

![Find a student: 'Rai' finds Suman Rai](screens/07-31-student-search.jpg)

<a id="07-33-register-tab-not-allowed"></a>
**07-33** The Register tab beside Student search, opened by the Principal

![The Register tab beside Student search, opened by the Principal](screens/07-33-register-tab-not-allowed.jpg)

## 8. Website Content

All seven kinds of content, scheduling, hide-after, holidays, validation, filters, search, edit, take down, archive, and the public website (D-098).

| # | Step | Result | Page |
|---|---|---|---|
| [08-01](#08-01-website-content) | Website Content: the published notice (approved earlier) and the declined event, back as a draft | Pass | `/portal/content` |
| [08-02](#08-02-new-content-types) | New content: seven types, each with its own icon | Pass | `/portal/content` |
| [08-03](#08-03-new-content-empty) | Publish with nothing filled in: the type, title and content are asked for | Pass | `/portal/content` |
| [08-04](#08-04-news-form) | A News item: bold text and a bulleted list from the toolbar, marked urgent, with the live preview | See F-12 | `/portal/content` |
| [08-05](#08-05-news-published) | Published at once: it is on the website now | Pass | `/portal/content` |
| [08-06](#08-06-holiday-end-before-start) | A holiday that ends (2 Bhadra) before it starts (24 Ashwin) is refused | Pass | `/portal/content` |
| [08-07](#08-07-holiday-form) | Holiday from 24 Ashwin to 2 Kartik 2083; it hides itself after the last day | Pass | `/portal/content` |
| [08-08](#08-08-hide-after-before-publish) | Hide after 10 Ashwin, before today's publish date, is refused | Pass | `/portal/content` |
| [08-09](#08-09-vacancy-form) | A vacancy with a contact, shown until 30 Kartik | Pass | `/portal/content` |
| [08-10](#08-10-event-scheduled-form) | An event set to publish on 18 Ashwin at 09:00, Nepal time | Pass | `/portal/content` |
| [08-11](#08-11-event-scheduled) | Scheduled: it goes on the website by itself at that date and time | Pass | `/portal/content` |
| [08-12](#08-12-information-draft) | Information saved as a draft: kept, not on the website | Pass | `/portal/content` |
| [08-13](#08-13-unverified-year) | A publish date in BS 2090, outside the verified calendar, is refused | Pass | `/portal/content` |
| [08-14](#08-14-list-all) | All items: summary counts, published, scheduled and draft, urgent marked | Pass | `/portal/content` |
| [08-15](#08-15-filter-type) | Type filter: Holiday | Pass | `/portal/content` |
| [08-16](#08-16-filter-scheduled) | Status filter: Scheduled | Pass | `/portal/content` |
| [08-17](#08-17-filter-draft) | Status filter: Draft | Pass | `/portal/content` |
| [08-18](#08-18-search) | Search 'teacher': the vacancy | Pass | `/portal/content` |
| [08-19](#08-19-edit-declined-draft) | Editing the event the Principal declined: the date, time and venue added | Pass | `/portal/content` |
| [08-20](#08-20-row-menu) | A published item's menu: take down or archive | Pass | `/portal/content` |
| [08-21](#08-21-taken-down) | Taken down: it is a draft again, with Undo | Pass | `/portal/content` |
| [08-22](#08-22-archived) | The routine archived: off the website, kept in the archive | Pass | `/portal/content` |
| [08-23](#08-23-public-home) | The public website's home page with the latest updates | Pass | `/` |
| [08-24](#08-24-public-notices) | Notices and updates on the public website: urgent news, the holiday, the vacancy and the quiz; the scheduled meeting and the draft are not shown | Pass | `/notices` |

<a id="08-01-website-content"></a>
**08-01** Website Content: the published notice (approved earlier) and the declined event, back as a draft

![Website Content: the published notice (approved earlier) and the declined event, back as a draft](screens/08-01-website-content.jpg)

<a id="08-02-new-content-types"></a>
**08-02** New content: seven types, each with its own icon

![New content: seven types, each with its own icon](screens/08-02-new-content-types.jpg)

<a id="08-03-new-content-empty"></a>
**08-03** Publish with nothing filled in: the type, title and content are asked for

![Publish with nothing filled in: the type, title and content are asked for](screens/08-03-new-content-empty.jpg)

<a id="08-04-news-form"></a>
**08-04** A News item: bold text and a bulleted list from the toolbar, marked urgent, with the live preview

![A News item: bold text and a bulleted list from the toolbar, marked urgent, with the live preview](screens/08-04-news-form.jpg)

<a id="08-05-news-published"></a>
**08-05** Published at once: it is on the website now

![Published at once: it is on the website now](screens/08-05-news-published.jpg)

<a id="08-06-holiday-end-before-start"></a>
**08-06** A holiday that ends (2 Bhadra) before it starts (24 Ashwin) is refused

![A holiday that ends (2 Bhadra) before it starts (24 Ashwin) is refused](screens/08-06-holiday-end-before-start.jpg)

<a id="08-07-holiday-form"></a>
**08-07** Holiday from 24 Ashwin to 2 Kartik 2083; it hides itself after the last day

![Holiday from 24 Ashwin to 2 Kartik 2083; it hides itself after the last day](screens/08-07-holiday-form.jpg)

<a id="08-08-hide-after-before-publish"></a>
**08-08** Hide after 10 Ashwin, before today's publish date, is refused

![Hide after 10 Ashwin, before today's publish date, is refused](screens/08-08-hide-after-before-publish.jpg)

<a id="08-09-vacancy-form"></a>
**08-09** A vacancy with a contact, shown until 30 Kartik

![A vacancy with a contact, shown until 30 Kartik](screens/08-09-vacancy-form.jpg)

<a id="08-10-event-scheduled-form"></a>
**08-10** An event set to publish on 18 Ashwin at 09:00, Nepal time

![An event set to publish on 18 Ashwin at 09:00, Nepal time](screens/08-10-event-scheduled-form.jpg)

<a id="08-11-event-scheduled"></a>
**08-11** Scheduled: it goes on the website by itself at that date and time

![Scheduled: it goes on the website by itself at that date and time](screens/08-11-event-scheduled.jpg)

<a id="08-12-information-draft"></a>
**08-12** Information saved as a draft: kept, not on the website

![Information saved as a draft: kept, not on the website](screens/08-12-information-draft.jpg)

<a id="08-13-unverified-year"></a>
**08-13** A publish date in BS 2090, outside the verified calendar, is refused

![A publish date in BS 2090, outside the verified calendar, is refused](screens/08-13-unverified-year.jpg)

<a id="08-14-list-all"></a>
**08-14** All items: summary counts, published, scheduled and draft, urgent marked

![All items: summary counts, published, scheduled and draft, urgent marked](screens/08-14-list-all.jpg)

<a id="08-15-filter-type"></a>
**08-15** Type filter: Holiday

![Type filter: Holiday](screens/08-15-filter-type.jpg)

<a id="08-16-filter-scheduled"></a>
**08-16** Status filter: Scheduled

![Status filter: Scheduled](screens/08-16-filter-scheduled.jpg)

<a id="08-17-filter-draft"></a>
**08-17** Status filter: Draft

![Status filter: Draft](screens/08-17-filter-draft.jpg)

<a id="08-18-search"></a>
**08-18** Search 'teacher': the vacancy

![Search 'teacher': the vacancy](screens/08-18-search.jpg)

<a id="08-19-edit-declined-draft"></a>
**08-19** Editing the event the Principal declined: the date, time and venue added

![Editing the event the Principal declined: the date, time and venue added](screens/08-19-edit-declined-draft.jpg)

<a id="08-20-row-menu"></a>
**08-20** A published item's menu: take down or archive

![A published item's menu: take down or archive](screens/08-20-row-menu.jpg)

<a id="08-21-taken-down"></a>
**08-21** Taken down: it is a draft again, with Undo

![Taken down: it is a draft again, with Undo](screens/08-21-taken-down.jpg)

<a id="08-22-archived"></a>
**08-22** The routine archived: off the website, kept in the archive

![The routine archived: off the website, kept in the archive](screens/08-22-archived.jpg)

<a id="08-23-public-home"></a>
**08-23** The public website's home page with the latest updates

![The public website's home page with the latest updates](screens/08-23-public-home.jpg)

<a id="08-24-public-notices"></a>
**08-24** Notices and updates on the public website: urgent news, the holiday, the vacancy and the quiz; the scheduled meeting and the draft are not shown

![Notices and updates on the public website: urgent news, the holiday, the vacancy and the quiz; the scheduled meeting and the draft are not shown](screens/08-24-public-notices.jpg)

## 9. Own account: profile, password, sign-out, recovery code, password reset, lockout

The Principal's own account and its security rules.

| # | Step | Result | Page |
|---|---|---|---|
| [09-01](#09-01-settings) | Settings: your profile, change your password, sign out | Pass | `/portal/settings` |
| [09-02](#09-02-profile-name-required) | Saving the profile with no name is refused | Pass | `/portal/settings` |
| [09-03](#09-03-profile-saved) | Name and phone saved | Pass | `/portal/settings` |
| [09-04](#09-04-password-wrong-current) | Change password with a wrong current password is refused | Pass | `/portal/settings` |
| [09-05](#09-05-password-common) | A common new password is refused | Pass | `/portal/settings` |
| [09-06](#09-06-password-school-name) | A new password containing the school's name is refused | Pass | `/portal/settings` |
| [09-07](#09-07-password-too-short) | A new password under 10 characters is refused | Pass | `/portal/settings` |
| [09-08](#09-08-password-changed) | The password is changed | Pass | `/portal/settings` |
| [09-09](#09-09-signed-out) | Signed out: back on the sign-in page | Pass | `/sign-in` |
| [09-10](#09-10-portal-after-sign-out) | Opening a portal page after signing out asks to sign in again | Pass | `/sign-in` |
| [09-11](#09-11-old-password-refused) | The old password no longer works | Pass | `/sign-in` |
| [09-12](#09-12-code-step) | The new password works; the authenticator code is asked for | Pass | `/sign-in` |
| [09-13](#09-13-code-wrong) | A wrong code is refused | Pass | `/sign-in` |
| [09-14](#09-14-recovery-code) | Signing in with one of the saved recovery codes instead | Pass | `/sign-in` |
| [09-14](#09-14b-throttled-after-five-failures) | Found in the clean run: five failed sign-in steps for one email within 15 minutes (a wrong password, the old password, a wrong code) lock the email, and even a correct recovery code is refused until the lock lifts. This is the lockout rule working as written (CLAUDE.md section 4). | Pass | `/sign-in` |
| [09-15](#09-15-signed-in-with-recovery) | Signed in with a recovery code; that code is now used up | Pass | `/portal` |
| [09-16](#09-16-recovery-code-reused) | The same recovery code a second time is refused: each works once | Pass | `/sign-in` |
| [09-17](#09-17-forgot-password) | Forgot your password: ask for a reset link | Pass | `/reset-password` |
| [09-18](#09-18-reset-sent) | The same answer whether or not the email has an account, so nobody can probe for accounts | Pass | `/reset-password` |
| [09-19](#09-19-mailbox-reset-email) | The test mailbox (only where email is not really sent) shows the reset email | Pass | `/portal/mailbox` |
| [09-20](#09-20-reset-new-password) | The reset link opens Choose a new password | Pass | `/reset-password#token=cVJQi3XypnYcBNj6SWVNcL0TpbdJhR3qINPqVckJCB4` |
| [09-21](#09-21-reset-weak) | A new password with the school's name in it is refused here too | Pass | `/reset-password#token=cVJQi3XypnYcBNj6SWVNcL0TpbdJhR3qINPqVckJCB4` |
| [09-22](#09-22-reset-done) | Password changed; sign in with the new one | Pass | `/reset-password` |
| [09-23](#09-23-reset-link-reused) | The same reset link opened again: refused, the link expired or was already used | Pass | `/reset-password#token=cVJQi3XypnYcBNj6SWVNcL0TpbdJhR3qINPqVckJCB4` |
| [09-24](#09-24-lockout) | Six wrong tries for one email (even an unknown one): Too many attempts, wait a few minutes | Pass | `/sign-in` |
| [09-25](#09-25-signed-in-new-password) | Signed in with the reset password and the authenticator code | Pass | `/portal` |

<a id="09-01-settings"></a>
**09-01** Settings: your profile, change your password, sign out

![Settings: your profile, change your password, sign out](screens/09-01-settings.jpg)

<a id="09-02-profile-name-required"></a>
**09-02** Saving the profile with no name is refused

![Saving the profile with no name is refused](screens/09-02-profile-name-required.jpg)

<a id="09-03-profile-saved"></a>
**09-03** Name and phone saved

![Name and phone saved](screens/09-03-profile-saved.jpg)

<a id="09-04-password-wrong-current"></a>
**09-04** Change password with a wrong current password is refused

![Change password with a wrong current password is refused](screens/09-04-password-wrong-current.jpg)

<a id="09-05-password-common"></a>
**09-05** A common new password is refused

![A common new password is refused](screens/09-05-password-common.jpg)

<a id="09-06-password-school-name"></a>
**09-06** A new password containing the school's name is refused

![A new password containing the school's name is refused](screens/09-06-password-school-name.jpg)

<a id="09-07-password-too-short"></a>
**09-07** A new password under 10 characters is refused

![A new password under 10 characters is refused](screens/09-07-password-too-short.jpg)

<a id="09-08-password-changed"></a>
**09-08** The password is changed

![The password is changed](screens/09-08-password-changed.jpg)

<a id="09-09-signed-out"></a>
**09-09** Signed out: back on the sign-in page

![Signed out: back on the sign-in page](screens/09-09-signed-out.jpg)

<a id="09-10-portal-after-sign-out"></a>
**09-10** Opening a portal page after signing out asks to sign in again

![Opening a portal page after signing out asks to sign in again](screens/09-10-portal-after-sign-out.jpg)

<a id="09-11-old-password-refused"></a>
**09-11** The old password no longer works

![The old password no longer works](screens/09-11-old-password-refused.jpg)

<a id="09-12-code-step"></a>
**09-12** The new password works; the authenticator code is asked for

![The new password works; the authenticator code is asked for](screens/09-12-code-step.jpg)

<a id="09-13-code-wrong"></a>
**09-13** A wrong code is refused

![A wrong code is refused](screens/09-13-code-wrong.jpg)

<a id="09-14-recovery-code"></a>
**09-14** Signing in with one of the saved recovery codes instead

![Signing in with one of the saved recovery codes instead](screens/09-14-recovery-code.jpg)

<a id="09-14b-throttled-after-five-failures"></a>
**09-14** Found in the clean run: five failed sign-in steps for one email within 15 minutes (a wrong password, the old password, a wrong code) lock the email, and even a correct recovery code is refused until the lock lifts. This is the lockout rule working as written (CLAUDE.md section 4).

![Found in the clean run: five failed sign-in steps for one email within 15 minutes (a wrong password, the old password, a wrong code) lock the email, and even a correct recovery code is refused until the lock lifts. This is the lockout rule working as written (CLAUDE.md section 4).](screens/09-14b-throttled-after-five-failures.png)

<a id="09-15-signed-in-with-recovery"></a>
**09-15** Signed in with a recovery code; that code is now used up

![Signed in with a recovery code; that code is now used up](screens/09-15-signed-in-with-recovery.jpg)

<a id="09-16-recovery-code-reused"></a>
**09-16** The same recovery code a second time is refused: each works once

![The same recovery code a second time is refused: each works once](screens/09-16-recovery-code-reused.jpg)

<a id="09-17-forgot-password"></a>
**09-17** Forgot your password: ask for a reset link

![Forgot your password: ask for a reset link](screens/09-17-forgot-password.jpg)

<a id="09-18-reset-sent"></a>
**09-18** The same answer whether or not the email has an account, so nobody can probe for accounts

![The same answer whether or not the email has an account, so nobody can probe for accounts](screens/09-18-reset-sent.jpg)

<a id="09-19-mailbox-reset-email"></a>
**09-19** The test mailbox (only where email is not really sent) shows the reset email

![The test mailbox (only where email is not really sent) shows the reset email](screens/09-19-mailbox-reset-email.jpg)

<a id="09-20-reset-new-password"></a>
**09-20** The reset link opens Choose a new password

![The reset link opens Choose a new password](screens/09-20-reset-new-password.jpg)

<a id="09-21-reset-weak"></a>
**09-21** A new password with the school's name in it is refused here too

![A new password with the school's name in it is refused here too](screens/09-21-reset-weak.jpg)

<a id="09-22-reset-done"></a>
**09-22** Password changed; sign in with the new one

![Password changed; sign in with the new one](screens/09-22-reset-done.jpg)

<a id="09-23-reset-link-reused"></a>
**09-23** The same reset link opened again: refused, the link expired or was already used

![The same reset link opened again: refused, the link expired or was already used](screens/09-23-reset-link-reused.jpg)

<a id="09-24-lockout"></a>
**09-24** Six wrong tries for one email (even an unknown one): Too many attempts, wait a few minutes

![Six wrong tries for one email (even an unknown one): Too many attempts, wait a few minutes](screens/09-24-lockout.jpg)

<a id="09-25-signed-in-new-password"></a>
**09-25** Signed in with the reset password and the authenticator code

![Signed in with the reset password and the authenticator code](screens/09-25-signed-in-new-password.jpg)

## 10. What the Principal must not do

Other roles' pages opened by address, and the server's answer to forbidden actions.

| # | Step | Result | Page |
|---|---|---|---|
| [10-01](#10-01-admissions-queue) | The Co-ordinator's admissions queue, opened by address | See F-14 | `/portal/admissions` |
| [10-02](#10-02-register-form) | Register a student (the Accountant's), opened by address | See F-14 | `/portal/admissions/register` |
| [10-03](#10-03-vouchers) | The Accountant's voucher checks, opened by address | See F-14 | `/portal/fees/vouchers` |
| [10-04](#10-04-results-review) | The Co-ordinator's marks review, opened by address | See F-14 | `/portal/results/review` |
| [10-05](#10-05-attendance-mine) | A teacher's own attendance page, opened by address | See F-14 | `/portal/attendance/mine` |
| [10-06](#10-06-classes-read-only) | Classes: the Principal can look; adding and changing is the Co-ordinator's | Pass | `/portal/setup/classes` |
| [10-07](#10-07-own-request) | The Principal's own request in the inbox: it cannot be approved by the person who sent it | See F-13 | `/portal/approvals` |
| [10-08](#10-08-own-request-approve-refused) | Approving one's own request is refused by the server; the message shown is misleading (finding F-13) | See F-13 | `/portal/approvals` |

<a id="10-01-admissions-queue"></a>
**10-01** The Co-ordinator's admissions queue, opened by address

![The Co-ordinator's admissions queue, opened by address](screens/10-01-admissions-queue.jpg)

<a id="10-02-register-form"></a>
**10-02** Register a student (the Accountant's), opened by address

![Register a student (the Accountant's), opened by address](screens/10-02-register-form.jpg)

<a id="10-03-vouchers"></a>
**10-03** The Accountant's voucher checks, opened by address

![The Accountant's voucher checks, opened by address](screens/10-03-vouchers.jpg)

<a id="10-04-results-review"></a>
**10-04** The Co-ordinator's marks review, opened by address

![The Co-ordinator's marks review, opened by address](screens/10-04-results-review.jpg)

<a id="10-05-attendance-mine"></a>
**10-05** A teacher's own attendance page, opened by address

![A teacher's own attendance page, opened by address](screens/10-05-attendance-mine.jpg)

<a id="10-06-classes-read-only"></a>
**10-06** Classes: the Principal can look; adding and changing is the Co-ordinator's

![Classes: the Principal can look; adding and changing is the Co-ordinator's](screens/10-06-classes-read-only.jpg)

<a id="10-07-own-request"></a>
**10-07** The Principal's own request in the inbox: it cannot be approved by the person who sent it

![The Principal's own request in the inbox: it cannot be approved by the person who sent it](screens/10-07-own-request.jpg)

<a id="10-08-own-request-approve-refused"></a>
**10-08** Approving one's own request is refused by the server; the message shown is misleading (finding F-13)

![Approving one's own request is refused by the server; the message shown is misleading (finding F-13)](screens/10-08-own-request-approve-refused.jpg)

### The server's answers

Each request below was sent with the Principal's own signed-in browser cookies, as a screen would send it.

| What the Principal tried | Request | Answer |
|---|---|---|
| Create a teacher (the Co-ordinator's) | `POST /api/teachers` | 403 forbidden |
| Create another Admin (Support only) | `POST /api/staff` | 400 (refused: the role must be Co-ordinator or Accountant) |
| Switch off a teacher (the Co-ordinator's) | `PATCH /api/staff/{id}` | 403 forbidden |
| New temporary password for a teacher | `POST /api/staff/{id}/temporary-password` | 403 forbidden |
| Make an academic year (the Co-ordinator's) | `POST /api/academics/years` | 403 forbidden |
| Make a class (the Co-ordinator's) | `POST /api/academics/classes` | 403 forbidden |
| Register a walk-in student | `POST /api/admissions/walk-ins` | 403 forbidden |
| Mark a class register | `PUT /api/attendance/classes/{id}/today` | 403 forbidden |
| Record a cash payment (the Accountant's) | `POST /api/fees/payments/cash` | 403 forbidden |
| Propose a discount (the Accountant's) | `POST /api/fees/enrollments/{id}/discounts` | 403 forbidden |
| Publish a class's results (the Co-ordinator's) | `POST /api/results/classes/{id}/publish` | 403 forbidden |
| Enter marks (a teacher's) | `PUT /api/results/classes/{id}/subjects/{id}/terminals/{id}` | 403 forbidden |
| Send own draft for approval | `POST /api/approvals` | 201 (allowed; see F-13) |
| Approve own request | `POST /api/approvals/{id}/approve` | 403 forbidden |
| Withdraw own request | `POST /api/approvals/{id}/withdraw` | 403 forbidden |

## 11. Phone and large text

The main screens at 375 px, and at 320 px with text at 200% (no sideways scrolling).

| # | Step | Result | Page |
|---|---|---|---|
| [11-01](#11-01-phone-dashboard) | Phone (375 px): the dashboard | See F-15 | `/portal` |
| [11-02](#11-02-phone-more) | Phone: the More tab lists the places that do not fit in the tab bar | Pass | `/portal/more` |
| [11-03](#11-03-phone-people) | Phone: People & Access | Pass | `/portal/people` |
| [11-04](#11-04-phone-website) | Phone: Website Content | Pass | `/portal/content` |
| [11-05](#11-05-phone-approvals) | Phone: Approvals | Pass | `/portal/approvals` |
| [11-06](#11-06-phone-programs) | Phone: Programs | Pass | `/portal/setup/programmes` |
| [11-07](#11-07-phone-dues) | Phone: Dues | Pass | `/portal/fees/dues` |
| [11-08](#11-08-phone-sheets) | Phone: Class sheets | See F-15 | `/portal/results/sheets` |
| [11-09](#11-09-320-dashboard) | 320 px wide, text at 200%: the dashboard | Pass | `/portal` |
| [11-10](#11-10-320-people) | 320 px wide, text at 200%: People & Access | Pass | `/portal/people` |
| [11-11](#11-11-320-website) | 320 px wide, text at 200%: Website Content (FINDING: the page scrolls sideways by 10 px) | See F-17 | `/portal/content` |
| [11-12](#11-12-320-sign-in) | 320 px wide, text at 200%: the sign-in page scrolls sideways by 14 px (finding F-16) | See F-16 | `/sign-in` |

<a id="11-01-phone-dashboard"></a>
**11-01** Phone (375 px): the dashboard

![Phone (375 px): the dashboard](screens/11-01-phone-dashboard.jpg)

<a id="11-02-phone-more"></a>
**11-02** Phone: the More tab lists the places that do not fit in the tab bar

![Phone: the More tab lists the places that do not fit in the tab bar](screens/11-02-phone-more.jpg)

<a id="11-03-phone-people"></a>
**11-03** Phone: People & Access

![Phone: People & Access](screens/11-03-phone-people.jpg)

<a id="11-04-phone-website"></a>
**11-04** Phone: Website Content

![Phone: Website Content](screens/11-04-phone-website.jpg)

<a id="11-05-phone-approvals"></a>
**11-05** Phone: Approvals

![Phone: Approvals](screens/11-05-phone-approvals.jpg)

<a id="11-06-phone-programs"></a>
**11-06** Phone: Programs

![Phone: Programs](screens/11-06-phone-programs.jpg)

<a id="11-07-phone-dues"></a>
**11-07** Phone: Dues

![Phone: Dues](screens/11-07-phone-dues.jpg)

<a id="11-08-phone-sheets"></a>
**11-08** Phone: Class sheets

![Phone: Class sheets](screens/11-08-phone-sheets.jpg)

<a id="11-09-320-dashboard"></a>
**11-09** 320 px wide, text at 200%: the dashboard

![320 px wide, text at 200%: the dashboard](screens/11-09-320-dashboard.jpg)

<a id="11-10-320-people"></a>
**11-10** 320 px wide, text at 200%: People & Access

![320 px wide, text at 200%: People & Access](screens/11-10-320-people.jpg)

<a id="11-11-320-website"></a>
**11-11** 320 px wide, text at 200%: Website Content (FINDING: the page scrolls sideways by 10 px)

![320 px wide, text at 200%: Website Content (FINDING: the page scrolls sideways by 10 px)](screens/11-11-320-website.jpg)

<a id="11-12-320-sign-in"></a>
**11-12** 320 px wide, text at 200%: the sign-in page scrolls sideways by 14 px (finding F-16)

![320 px wide, text at 200%: the sign-in page scrolls sideways by 14 px (finding F-16)](screens/11-12-320-sign-in.jpg)

## 12. End of the run

People & Access and the dashboard once the school year is under way.

| # | Step | Result | Page |
|---|---|---|---|
| [12-01](#12-01-people-after-year) | People & Access after the year started: 6 teaching staff; the staff who signed in show when | Pass | `/portal/people` |
| [12-02](#12-02-teaching) | Teaching: every teacher with their subjects, section and programme, who added them, status and last sign-in | Pass | `/portal/people` |
| [12-03](#12-03-teaching-section) | Teaching filtered to the Bachelor's section | Pass | `/portal/people` |
| [12-04](#12-04-teaching-search) | Searching teachers: 'bikash' finds Bikash Chaudhary, with Mathematics and Physics | Pass | `/portal/people` |
| [12-05](#12-05-view-teaching) | View teaching: the Teaching report, read only for the Principal | Pass | `/portal/people/teaching` |
| [12-06](#12-06-dashboard-end) | The dashboard at the end of the test: fees collected, attendance, website updated, recent activity | Pass | `/portal` |
| [12-07](#12-07-glance-fees) | Institution at a glance: the Fees tab | Pass | `/portal` |
| [12-07](#12-07-glance-programs) | Institution at a glance: the Programs tab | Pass | `/portal` |
| [12-07](#12-07-glance-results) | Institution at a glance: the Results tab | Pass | `/portal` |

<a id="12-01-people-after-year"></a>
**12-01** People & Access after the year started: 6 teaching staff; the staff who signed in show when

![People & Access after the year started: 6 teaching staff; the staff who signed in show when](screens/12-01-people-after-year.jpg)

<a id="12-02-teaching"></a>
**12-02** Teaching: every teacher with their subjects, section and programme, who added them, status and last sign-in

![Teaching: every teacher with their subjects, section and programme, who added them, status and last sign-in](screens/12-02-teaching.jpg)

<a id="12-03-teaching-section"></a>
**12-03** Teaching filtered to the Bachelor's section

![Teaching filtered to the Bachelor's section](screens/12-03-teaching-section.jpg)

<a id="12-04-teaching-search"></a>
**12-04** Searching teachers: 'bikash' finds Bikash Chaudhary, with Mathematics and Physics

![Searching teachers: 'bikash' finds Bikash Chaudhary, with Mathematics and Physics](screens/12-04-teaching-search.jpg)

<a id="12-05-view-teaching"></a>
**12-05** View teaching: the Teaching report, read only for the Principal

![View teaching: the Teaching report, read only for the Principal](screens/12-05-view-teaching.jpg)

<a id="12-06-dashboard-end"></a>
**12-06** The dashboard at the end of the test: fees collected, attendance, website updated, recent activity

![The dashboard at the end of the test: fees collected, attendance, website updated, recent activity](screens/12-06-dashboard-end.jpg)

<a id="12-07-glance-fees"></a>
**12-07** Institution at a glance: the Fees tab

![Institution at a glance: the Fees tab](screens/12-07-glance-fees.jpg)

<a id="12-07-glance-programs"></a>
**12-07** Institution at a glance: the Programs tab

![Institution at a glance: the Programs tab](screens/12-07-glance-programs.jpg)

<a id="12-07-glance-results"></a>
**12-07** Institution at a glance: the Results tab

![Institution at a glance: the Results tab](screens/12-07-glance-results.jpg)

## Findings

Severity: **High** blocks the Principal's work; **Medium** gives wrong or missing information on a real task; **Low** is confusing but has a way round; **Cosmetic** is appearance only.

| ID | Severity | Where | What happens | Steps |
|---|---|---|---|---|
| F-01 | Low | Programs › Add a Section | A duplicate section name is refused ("That already exists."), but the message shows on the page behind the open dialog, dimmed by the backdrop; the dialog itself stays unchanged. | 02-06 |
| F-02 | High (fixed) | Programs › Add a Programme | Adding any programme failed with "That is not allowed. Check what you entered." The form sent gradingPolicy: null, which the API's strict body refuses. Fixed in apps/web/src/setup/client.ts; regression test in setup-client.test.ts. | 03-02 |
| F-03 | Low | Approvals › menu badge | After the Principal decides every request, the inbox says "Nothing is waiting for a decision" but the menu badge still shows the old count until the page is reloaded. | 05-07 |
| F-04 | Low | Overview › Recent activity | An admission entry reads "Application approved; student <32-character internal id> created" instead of naming the student and their SID. | 05-01 |
| F-05 | Cosmetic | Overview › Institution at a glance | The attendance chart's top axis label is cut: "00%" instead of "100%". | 05-01 |
| F-06 | Medium | Approvals › Discount | A discount request does not show its reason (Scholarship, Sibling, Staff child, Other). Sita Chaudhary's 10% Sibling discount shows only "Discount of NPR 4,450.00 for Sita Chaudhary", and the Accountant's note ("Her brother Rohit is in Grade 12") is not shown. An "Other" discount shows its note but not the reason. The Principal approves money without seeing why. | 06-01 |
| F-07 | Low | Approvals › deciding twice | Approving a refund from a second, older tab after it was already approved is refused correctly (nothing is applied twice), but the message says "That changed since it was sent. Send it again to reconsider it." The request was not changed; it was already decided. The web client maps every 409 to "stale" (apps/web/src/approvals/client.ts:59), assuming an already-decided request cannot be reached, which two open tabs disprove. | 06-05 |
| F-08 | Medium | Find a student › Register tab | The Principal sees a Register tab beside Student search, and it opens the full "Register a student" form. The Principal may not register students (admissions.student.register is the Accountant's), and the server refuses the request (403 forbidden, checked directly), but the form should not be offered. | 07-33 |
| F-09 | Low | Find a student › result | A search result cannot be opened. The Principal has read access to a student's personal details (students.personal.view, and GET /api/students/{id} answers 200), but the result card is not a link, so the record cannot be seen from any screen. | 07-31 |
| F-10 | Low | Fees › Dues | Students in a class whose fee structure has not been charged yet (BBS Year 1) show a green "Paid up". Nothing was charged, so "Paid up" overstates it. | 07-19 |
| F-11 | Medium (gap) | Audit trail and Sign-ins | The Principal has audit.view, but no screen lists the audit trail or the sign-ins (CLAUDE.md section 6: "Sign-ins and failed 2FA go in a separate Sign-ins view"). Only the newest few entries appear under Recent activity on the dashboard. | 05-01 |
| F-12 | Low | Website › text toolbar | Pressing Bulleted list (or Numbered list) on an empty line does nothing and gives no sign why; a list is made only from lines selected first. The hint under the box says to select words first, but a list button that silently does nothing is easy to miss. | 08-04 |
| F-13 | Medium | Approvals › own request | The Principal can send their own draft for approval (POST /api/approvals answers 201), and it appears in their own inbox with Approve and Decline. Approving it is refused, which is correct (never your own request), but the message says "You no longer have permission to see this. Sign in again." The Principal also cannot withdraw it (403), so in a school with one Principal the request stays in the inbox, with the badge, until another Admin or Support decides it. | 10-07, 10-08 |
| F-14 | Low | Other roles' pages opened by address | Pages that belong to other roles answer in four different ways when the Principal opens them by address: Vouchers to check says "You do not have access to this page" (right); the marks review says "This could not be loaded. Check your connection and try again" (a refusal shown as a network problem); My attendance shows an empty teacher calendar; the admissions queue shows the Register form (F-08). The server refuses every action in all of them. | 10-01 to 10-05 |
| F-15 | Low | Phone tab bar | At 375 px the bottom tab bar does not fit on one row: "More" wraps to a second row on its own, and the Approvals badge sits under its label, so the bar takes two rows of the screen. | 11-01, 11-08 |
| F-16 | Low | Sign-in page at 320 px | At 320 px wide with text at 200%, the sign-in page scrolls sideways by 14 px (the house rule in D-030 is no sideways scroll). The portal pages checked the same way do not. | 11-12 |
| F-17 | Low | Website Content at 320 px | At 320 px wide with text at 200%, the "Waiting for approval" status label on a row does not wrap and pushes the page 10 px sideways. | 11-11 |
| F-18 | Medium | Fees › Receipt | The receipt number starts with the section's internal key: "s7e402b08e9-2083-00007". Since sections are made by the Admin with generated keys (D-095), every receipt a family keeps carries this code. The receipt date is also shown as 2083-06-16 rather than 16 Ashwin 2083 as elsewhere. | 07-15 |
| F-19 | Low | Dates › half-filled date | A date with only the day filled in is refused with "That day is not in the verified calendar", which suggests a calendar problem rather than asking for the month and year. | 07-05a |

Only F-02 was fixed in this round, because it blocked the test. The others are for the PM to schedule: most are small and local to one screen; F-11 is a missing screen, and F-18 touches how receipt numbers are formed, which belongs to the fees rules.

## What the Principal can do, and where it was tested

From the permission matrix (`apps/api/src/core/permissions/matrix.ts`), every action the Admin holds:

| Permission | What | Tested in |
|---|---|---|
| `auth.sign_in` | Sign in, reset own password | 01, 09 |
| `account.profile.edit` | Correct own name and phone | 09-01 to 09-03 |
| `accounts.staff.create` | Create a Co-ordinator or Accountant | 04-03 to 04-12 |
| `accounts.deactivate` | Switch off or on (Co-ordinators, Accountants) | 04-16 to 04-18; teachers refused in 10 |
| `accounts.staff.view` | View the staff list | 04, 12-01 to 12-05 |
| `accounts.staff.access` | Change where access reaches | 04-13 to 04-15 |
| `accounts.password.issue` | New temporary password (Co-ordinators, Accountants) | 04-19; teachers refused in 10 |
| `content.draft / content.publish` | Draft and publish website content | 08 |
| `setup.programmes.manage` | Sections, programmes, levels, grading | 02, 03 |
| `setup.structure.view / subjects.view / assignments.view` | View years, classes, terminals, subjects, curriculum, teaching | 07-25 to 07-30, 12-05 |
| `students.search / students.personal.view` | Find a student, view personal details | 07-31 (record view not reachable, F-09) |
| `attendance.student.view / attendance.teacher.view` | View attendance | 07-01 to 07-06 |
| `activity.read` | Read the activity log | 07-07, 07-08 |
| `fees.structure.approve` | Approve a fee structure | 05-03, 05-06, 06-06 |
| `fees.view / fees.receipts.view` | Fees, dues, ledger, receipts | 07-09 to 07-19 |
| `fees.discount.approve / reversal.approve / refund.approve` | Approve money requests | 06 |
| `results.view / results.top20.view` | Published results, class sheets, Top 20 | 07-20 to 07-23 |
| `approvals.decide / approvals.request` | Decide requests; send own draft | 05, 06, 10-07, 10-08 |
| `audit.view` | Activity and sign-ins | 05-01, 12-06 (dashboard only; F-11) |
| `dashboard.overview.view` | The Principal's dashboard | 01-08, 05-01, 12-06, 12-07 |
| `dev.mailbox.view` | Test mailbox | 09-19 |
| `reports.students / fees / results` | Reports and exports | 07-19 (dues CSV), 07-22 (results CSV), 07-24 |

## Not covered

- **Uploads** (vouchers with files, notes): uploads are off until R2 is enabled (D-020).
- **Real email and SMS:** only the development mailbox exists; nothing is really sent.
- **A second Admin:** approving another Admin's request needs a second Admin account, which only Support can make.
- **The year lifecycle** (closing a year, promotion): Phase 8, not built.
- **Support (Super Admin)** and the other roles' own screens: separate FUTs.
