# Co-ordinator functional user test (FUT)

Royal Softech College on the school platform. Every operation a Co-ordinator can do, end to end through the real screens, with a screenshot of each step. **Second run**, on 3 October 2026 (17 Ashwin 2083) against commit `ef145bc` on a fresh local school, after the first run's findings were fixed and the Co-ordinator's screens were redesigned in the Principal's design language (D-106). The Principal's FUT is in [`../admin/`](../admin/README.md).

## Summary

- **156 steps** with a screenshot each, in 17 areas, plus **19 server checks** (things she must not do, and what a one-section Co-ordinator can reach).
- **156 steps behaved as expected**.
- **All 12 findings of the first run are fixed**, and each is checked again here at the step named in [Findings](#findings).
- **No new findings** in this run.
- **Every forbidden action was refused by the server**, and the Bachelor's-only Co-ordinator could reach nothing of +2. Permission is never left to the screens alone.

## How the test was run

- **School:** a fresh local copy (`wrangler dev`, local D1), the Royal Softech pack provisioned. The Principal had made the sections (+2, Bachelor's), the programmes with their levels and grading (+2 Science and +2 Management: NEB GPA; BBS: percentage and division), and three staff: Co-ordinator Sita Sharma (whole school, the person under test), Co-ordinator Hari Prasad Yadav (Bachelor's only) and Accountant Gita Thapa (precondition P0).
- **The Co-ordinator:** every step was done in a real browser (Chromium through Playwright) on the real screens, signed in as Sita Sharma.
- **Everyone else:** work only another person can do (applicants, the Accountant, teachers, students, the Principal) was done through the same API their screens use, signed in as those people, each with their own first-sign-in password change. These are listed as preconditions P0 to P5 where they happen; they are not part of the Co-ordinator's test.
- **Observed:** the messages on screen at each step (notices, errors) were recorded as they appeared and are quoted under each screenshot.
- **Screens:** 1440 px wide unless noted. Times are Nepal time. All names, emails, phone numbers and passwords are made up.
- **Re-running:** the scripts are in [`scripts/`](scripts/); `run-all.sh` runs every area and precondition in order on a fresh school.

### Test data

| What | Made by | Detail |
|---|---|---|
| Year, terminals | Co-ordinator (02) | 2083, 1 Baisakh to 30 Chaitra; First terminal, Second terminal, Final |
| Subjects | Co-ordinator (02) | English, Nepali, Physics, Chemistry, Mathematics, Biology, Computer Science, Business English, Financial Accounting, Micro Economics, Moral Education |
| Curriculum | Co-ordinator (03) | +2 Science Grade 11: five subjects for all and a Science option (Biology or Computer Science, pick 1), theory and practical marks; Grade 12: five subjects; BBS Year 1: three subjects |
| Classes | Co-ordinator (04) | +2 Science Grade 11 A and B, Grade 12 A, BBS Year 1 (a +2 Management class made and deleted) |
| Teachers | Co-ordinator (05, 06) | Bikash Chaudhary, Anita Mandal, Suresh Karki, Kamala Rai (+2); Puja Singh, Rajan Sah (Bachelor's); Class Teachers Bikash (11 A), Kamala (11 B), Anita (12 A), Puja (BBS 1) |
| Students | Co-ordinator (07, 08) | 14 walk-ins (a second registration of Aarav Mandal was stopped as a duplicate) and two approved from the queue (Pooja Sharma, Ritu Gupta): 2083-00001 to 2083-00016 |
| Applications | Public, Accountant (P1) | Pooja Sharma (approved), Rajesh Yadav (changes asked), Sunil Thapa (rejected), Sita Choudhary (possible duplicate, rejected), Ritu Gupta from the Accountant (approved) |
| Results | Teachers (P3), Co-ordinator (12) | Grade 11 A and BBS Year 1 first terminal published; two rechecks |

## 1. First sign-in

The Principal made Sita Sharma a Co-ordinator for the whole school. She signs in with the temporary password and must choose her own.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [01-01](#01-01-sign-in) | The sign-in page | – | Pass |
| [01-02](#01-02-wrong-password) | A wrong password is refused without saying which part is wrong | The email or password is not correct. Check them and try again. | Pass |
| [01-03](#01-03-choose-own-password) | First sign-in with the temporary password from the Principal: she must choose her own password | – | Pass |
| [01-04](#01-04-same-as-temporary) | The temporary password itself is refused | That is your temporary password. Choose a different one. | Pass |
| [01-05](#01-05-too-short) | Under 10 characters is refused | Use at least 10 characters. | Pass |
| [01-06](#01-06-common) | A common password is refused | That password is too common. Choose a less common one. | Pass |
| [01-07](#01-07-email-name) | A password containing her email name is refused | Do not use your email name in your password. | Pass |
| [01-08](#01-08-school-name) | A password containing the school's name is refused | Do not use your school's name in your password. | Pass |
| [01-09](#01-09-dashboard-first) | Signed in: the Co-ordinator's dashboard on a school that has programmes but no year, classes or teachers yet | – | Pass |

<a id="01-01-sign-in"></a>
**01-01** The sign-in page

![The sign-in page](screens/01-01-sign-in.jpg)

<a id="01-02-wrong-password"></a>
**01-02** A wrong password is refused without saying which part is wrong

![A wrong password is refused without saying which part is wrong](screens/01-02-wrong-password.jpg)

<a id="01-03-choose-own-password"></a>
**01-03** First sign-in with the temporary password from the Principal: she must choose her own password

![First sign-in with the temporary password from the Principal: she must choose her own password](screens/01-03-choose-own-password.jpg)

<a id="01-04-same-as-temporary"></a>
**01-04** The temporary password itself is refused

![The temporary password itself is refused](screens/01-04-same-as-temporary.jpg)

<a id="01-05-too-short"></a>
**01-05** Under 10 characters is refused

![Under 10 characters is refused](screens/01-05-too-short.jpg)

<a id="01-06-common"></a>
**01-06** A common password is refused

![A common password is refused](screens/01-06-common.jpg)

<a id="01-07-email-name"></a>
**01-07** A password containing her email name is refused

![A password containing her email name is refused](screens/01-07-email-name.jpg)

<a id="01-08-school-name"></a>
**01-08** A password containing the school's name is refused

![A password containing the school's name is refused](screens/01-08-school-name.jpg)

<a id="01-09-dashboard-first"></a>
**01-09** Signed in: the Co-ordinator's dashboard on a school that has programmes but no year, classes or teachers yet

![Signed in: the Co-ordinator's dashboard on a school that has programmes but no year, classes or teachers yet](screens/01-09-dashboard-first.jpg)

## 2. Setup: the year, terminals and subjects

The academic year with its dates, its three terminals, and the school's list of subjects.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [02-01](#02-01-years-empty) | Academic years: none yet | – | Pass |
| [02-02](#02-02-year-empty-form) | Add a year with nothing filled in: each field is asked for | Enter the year as four digits, for example 2083. / Enter the first day of the year. / Enter the last day of the year. | Pass |
| [02-03](#02-03-year-ends-before-start) | A year whose last day is before its first day is refused | The last day must come after the first day. | Pass |
| [02-04](#02-04-year-unverified) | BS 2090 is outside the verified calendar (2000 to 2083) and is refused | The calendar for that year has not been checked yet. | Pass |
| [02-05](#02-05-year-form) | Year 2083: from 1 Baisakh 2083 to 30 Chaitra 2083 | – | Pass |
| [02-06](#02-06-year-added) | Year 2083 added as a draft: it is not the current year until made so | Added. | Pass |
| [02-07](#02-07-year-duplicate) | The same year twice is refused | That already exists. / Added. | Pass |
| [02-08](#02-08-year-current) | 2083 made the current year | Made the current year. | Pass |
| [02-09](#02-09-terminals-empty) | Terminals of 2083: none yet | – | Pass |
| [02-10](#02-10-terminal-name-required) | Add a terminal with no name: refused | Enter a name. | Pass |
| [02-11](#02-11-terminals) | Three terminals, numbered in order | Added. | Pass |
| [02-12](#02-12-subjects-empty) | Subjects: the school's list, empty | – | Pass |
| [02-13](#02-13-subjects) | Eleven subjects, most with a short code | Added. | Pass |
| [02-14](#02-14-subject-duplicate) | A second subject called English is refused | That already exists. / Added. | Pass |

<a id="02-01-years-empty"></a>
**02-01** Academic years: none yet

![Academic years: none yet](screens/02-01-years-empty.jpg)

<a id="02-02-year-empty-form"></a>
**02-02** Add a year with nothing filled in: each field is asked for

![Add a year with nothing filled in: each field is asked for](screens/02-02-year-empty-form.jpg)

<a id="02-03-year-ends-before-start"></a>
**02-03** A year whose last day is before its first day is refused

![A year whose last day is before its first day is refused](screens/02-03-year-ends-before-start.jpg)

<a id="02-04-year-unverified"></a>
**02-04** BS 2090 is outside the verified calendar (2000 to 2083) and is refused

![BS 2090 is outside the verified calendar (2000 to 2083) and is refused](screens/02-04-year-unverified.jpg)

<a id="02-05-year-form"></a>
**02-05** Year 2083: from 1 Baisakh 2083 to 30 Chaitra 2083

![Year 2083: from 1 Baisakh 2083 to 30 Chaitra 2083](screens/02-05-year-form.jpg)

<a id="02-06-year-added"></a>
**02-06** Year 2083 added as a draft: it is not the current year until made so

![Year 2083 added as a draft: it is not the current year until made so](screens/02-06-year-added.jpg)

<a id="02-07-year-duplicate"></a>
**02-07** The same year twice is refused

![The same year twice is refused](screens/02-07-year-duplicate.jpg)

<a id="02-08-year-current"></a>
**02-08** 2083 made the current year

![2083 made the current year](screens/02-08-year-current.jpg)

<a id="02-09-terminals-empty"></a>
**02-09** Terminals of 2083: none yet

![Terminals of 2083: none yet](screens/02-09-terminals-empty.jpg)

<a id="02-10-terminal-name-required"></a>
**02-10** Add a terminal with no name: refused

![Add a terminal with no name: refused](screens/02-10-terminal-name-required.jpg)

<a id="02-11-terminals"></a>
**02-11** Three terminals, numbered in order

![Three terminals, numbered in order](screens/02-11-terminals.jpg)

<a id="02-12-subjects-empty"></a>
**02-12** Subjects: the school's list, empty

![Subjects: the school's list, empty](screens/02-12-subjects-empty.jpg)

<a id="02-13-subjects"></a>
**02-13** Eleven subjects, most with a short code

![Eleven subjects, most with a short code](screens/02-13-subjects.jpg)

<a id="02-14-subject-duplicate"></a>
**02-14** A second subject called English is refused

![A second subject called English is refused](screens/02-14-subject-duplicate.jpg)

## 3. Setup: curriculum

What each level studies: subjects, credit hours, how each is marked, and an elective group.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [03-01](#03-01-curriculum-first-level) | Curriculum: the first level, +2 Science Grade 11, opens straight away | – | Pass |
| [03-02](#03-02-curriculum-level-empty) | +2 Science Grade 11: no elective groups and no subjects yet | – | Pass |
| [03-03](#03-03-subject-not-chosen) | Add a subject without choosing one: Choose a subject | Choose a subject. | Pass |
| [03-04](#03-04-elective-group) | An elective group, Science option: each student picks 1 | Added. | Pass |
| [03-05](#03-05-mark-zero) | In Physics's panel, a mark component with a maximum of 0 is refused | Added. / Enter the maximum marks as a number such as 75. | Pass |
| [03-05b](#03-05b-subject-panel) | Biology's panel: its code and credit hours, its elective group, theory and practical marks, and Switch off | Added. | Pass |
| [03-06](#03-06-grade11-curriculum) | Grade 11: five subjects everyone takes, Biology or Computer Science as the Science option, credit hours, and theory and practical marks | Added. | Pass |
| [03-07](#03-07-bbs-curriculum) | BBS Year 1: three subjects, each marked out of 100 | Added. | Pass |
| [03-08](#03-08-subject-switched-off) | Mathematics switched off on Grade 11: kept, and its panel and row say Switched off | Switched off. | Pass |

<a id="03-01-curriculum-first-level"></a>
**03-01** Curriculum: the first level, +2 Science Grade 11, opens straight away

![Curriculum: the first level, +2 Science Grade 11, opens straight away](screens/03-01-curriculum-first-level.jpg)

<a id="03-02-curriculum-level-empty"></a>
**03-02** +2 Science Grade 11: no elective groups and no subjects yet

![+2 Science Grade 11: no elective groups and no subjects yet](screens/03-02-curriculum-level-empty.jpg)

<a id="03-03-subject-not-chosen"></a>
**03-03** Add a subject without choosing one: Choose a subject

![Add a subject without choosing one: Choose a subject](screens/03-03-subject-not-chosen.jpg)

<a id="03-04-elective-group"></a>
**03-04** An elective group, Science option: each student picks 1

![An elective group, Science option: each student picks 1](screens/03-04-elective-group.jpg)

<a id="03-05-mark-zero"></a>
**03-05** In Physics's panel, a mark component with a maximum of 0 is refused

![In Physics's panel, a mark component with a maximum of 0 is refused](screens/03-05-mark-zero.jpg)

<a id="03-05b-subject-panel"></a>
**03-05b** Biology's panel: its code and credit hours, its elective group, theory and practical marks, and Switch off

![Biology's panel: its code and credit hours, its elective group, theory and practical marks, and Switch off](screens/03-05b-subject-panel.jpg)

<a id="03-06-grade11-curriculum"></a>
**03-06** Grade 11: five subjects everyone takes, Biology or Computer Science as the Science option, credit hours, and theory and practical marks

![Grade 11: five subjects everyone takes, Biology or Computer Science as the Science option, credit hours, and theory and practical marks](screens/03-06-grade11-curriculum.jpg)

<a id="03-07-bbs-curriculum"></a>
**03-07** BBS Year 1: three subjects, each marked out of 100

![BBS Year 1: three subjects, each marked out of 100](screens/03-07-bbs-curriculum.jpg)

<a id="03-08-subject-switched-off"></a>
**03-08** Mathematics switched off on Grade 11: kept, and its panel and row say Switched off

![Mathematics switched off on Grade 11: kept, and its panel and row say Switched off](screens/03-08-subject-switched-off.jpg)

## 4. Setup: classes

The year's classes, a duplicate, switching off and deleting.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [04-01](#04-01-classes-empty) | Classes of 2083: none yet | – | Pass |
| [04-02](#04-02-class-no-level) | Add a class without a level: refused | Choose a Level. | Pass |
| [04-03](#04-03-class-form) | Grade 11 of +2 Science, label A (a label like Morning or A is optional) | – | Pass |
| [04-04](#04-04-classes) | Five classes for 2083 | Added. | Pass |
| [04-05](#04-05-class-duplicate) | Grade 11 A a second time is refused | That already exists. / Added. | Pass |
| [04-06](#04-06-class-switched-off) | The Management class switched off: kept, marked Switched off, not offered for new students | Switched off. | Pass |
| [04-07](#04-07-class-delete-confirm) | Delete asks once more, because it cannot be undone (offered only while nothing is attached) | Switched on. | Pass |
| [04-08](#04-08-class-deleted) | The empty Management class is deleted; four classes remain | Deleted. | Pass |

<a id="04-01-classes-empty"></a>
**04-01** Classes of 2083: none yet

![Classes of 2083: none yet](screens/04-01-classes-empty.jpg)

<a id="04-02-class-no-level"></a>
**04-02** Add a class without a level: refused

![Add a class without a level: refused](screens/04-02-class-no-level.jpg)

<a id="04-03-class-form"></a>
**04-03** Grade 11 of +2 Science, label A (a label like Morning or A is optional)

![Grade 11 of +2 Science, label A (a label like Morning or A is optional)](screens/04-03-class-form.jpg)

<a id="04-04-classes"></a>
**04-04** Five classes for 2083

![Five classes for 2083](screens/04-04-classes.jpg)

<a id="04-05-class-duplicate"></a>
**04-05** Grade 11 A a second time is refused

![Grade 11 A a second time is refused](screens/04-05-class-duplicate.jpg)

<a id="04-06-class-switched-off"></a>
**04-06** The Management class switched off: kept, marked Switched off, not offered for new students

![The Management class switched off: kept, marked Switched off, not offered for new students](screens/04-06-class-switched-off.jpg)

<a id="04-07-class-delete-confirm"></a>
**04-07** Delete asks once more, because it cannot be undone (offered only while nothing is attached)

![Delete asks once more, because it cannot be undone (offered only while nothing is attached)](screens/04-07-class-delete-confirm.jpg)

<a id="04-08-class-deleted"></a>
**04-08** The empty Management class is deleted; four classes remain

![The empty Management class is deleted; four classes remain](screens/04-08-class-deleted.jpg)

## 5. People: teachers

The Co-ordinator adds the teachers (only teachers), switches one off and on, and gives a new temporary password.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [05-01](#05-01-staff-empty) | Staff, as the Co-ordinator sees it: only teachers, none yet | – | Pass |
| [05-02](#05-02-add-teacher-form) | Add a person: the role is fixed to Teacher; name, email, phone and home section | – | Pass |
| [05-03](#05-03-add-teacher-empty) | Sent empty: the name and email are asked for | Enter the person's full name. / Enter a valid email address. / Choose the Section this teacher belongs to. | Pass |
| [05-04](#05-04-add-teacher-invalid) | A one-letter name and an incomplete email are each explained | Enter the person's full name. / Enter a valid email address. / Choose the Section this teacher belongs to. | Pass |
| [05-05](#05-05-teacher-temporary-password) | Bikash Chaudhary added: the temporary password is shown once, to give him in person | Temporary password for Bikash Chaudhary (password) Give this to Bikash Chaudhary in person or by phone. It is shown once and cannot be looked up again. They … | Pass |
| [05-06](#05-06-six-teachers) | Six teachers: four for +2 and two for Bachelor's, none signed in yet | – | Pass |
| [05-07](#05-07-teacher-duplicate-email) | An email already in use is refused | Someone already uses that email address. | Pass |
| [05-07b](#05-07b-staff-search) | Search narrows the list as she types: Kamala Rai | – | Pass |
| [05-07c](#05-07c-manage-panel) | Manage Kamala Rai: her details, a new temporary password, and Switch off | – | Pass |
| [05-08](#05-08-teacher-switched-off) | Kamala Rai switched off: kept, marked Switched off, signed out and unable to sign in | Kamala Rai was switched off, and signed out. | Pass |
| [05-09](#05-09-teacher-switched-on) | Kamala Rai switched on again | Kamala Rai was switched on. | Pass |
| [05-10](#05-10-teacher-new-password) | A new temporary password for Suresh Karki, shown once (the old one stops working) | Temporary password for Suresh Karki (password) Give this to Suresh Karki in person or by phone. It is shown once and cannot be looked up again. They must cho… | Pass |

<a id="05-01-staff-empty"></a>
**05-01** Staff, as the Co-ordinator sees it: only teachers, none yet

![Staff, as the Co-ordinator sees it: only teachers, none yet](screens/05-01-staff-empty.jpg)

<a id="05-02-add-teacher-form"></a>
**05-02** Add a person: the role is fixed to Teacher; name, email, phone and home section

![Add a person: the role is fixed to Teacher; name, email, phone and home section](screens/05-02-add-teacher-form.jpg)

<a id="05-03-add-teacher-empty"></a>
**05-03** Sent empty: the name and email are asked for

![Sent empty: the name and email are asked for](screens/05-03-add-teacher-empty.jpg)

<a id="05-04-add-teacher-invalid"></a>
**05-04** A one-letter name and an incomplete email are each explained

![A one-letter name and an incomplete email are each explained](screens/05-04-add-teacher-invalid.jpg)

<a id="05-05-teacher-temporary-password"></a>
**05-05** Bikash Chaudhary added: the temporary password is shown once, to give him in person

![Bikash Chaudhary added: the temporary password is shown once, to give him in person](screens/05-05-teacher-temporary-password.jpg)

<a id="05-06-six-teachers"></a>
**05-06** Six teachers: four for +2 and two for Bachelor's, none signed in yet

![Six teachers: four for +2 and two for Bachelor's, none signed in yet](screens/05-06-six-teachers.jpg)

<a id="05-07-teacher-duplicate-email"></a>
**05-07** An email already in use is refused

![An email already in use is refused](screens/05-07-teacher-duplicate-email.jpg)

<a id="05-07b-staff-search"></a>
**05-07b** Search narrows the list as she types: Kamala Rai

![Search narrows the list as she types: Kamala Rai](screens/05-07b-staff-search.jpg)

<a id="05-07c-manage-panel"></a>
**05-07c** Manage Kamala Rai: her details, a new temporary password, and Switch off

![Manage Kamala Rai: her details, a new temporary password, and Switch off](screens/05-07c-manage-panel.jpg)

<a id="05-08-teacher-switched-off"></a>
**05-08** Kamala Rai switched off: kept, marked Switched off, signed out and unable to sign in

![Kamala Rai switched off: kept, marked Switched off, signed out and unable to sign in](screens/05-08-teacher-switched-off.jpg)

<a id="05-09-teacher-switched-on"></a>
**05-09** Kamala Rai switched on again

![Kamala Rai switched on again](screens/05-09-teacher-switched-on.jpg)

<a id="05-10-teacher-new-password"></a>
**05-10** A new temporary password for Suresh Karki, shown once (the old one stops working)

![A new temporary password for Suresh Karki, shown once (the old one stops working)](screens/05-10-teacher-new-password.jpg)

## 6. People: teaching assignments

A teacher for every subject of every class, and each class's Class Teacher.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [06-01](#06-01-teaching-first-class) | Teaching: the current year and its first class open straight away | – | Pass |
| [06-02](#06-02-teaching-empty-class) | Grade 11 A: a Class Teacher and one teacher per subject, none chosen yet | – | Pass |
| [06-03](#06-03-teaching-grade11a) | Grade 11 A: Bikash Chaudhary is Class Teacher; each subject has its teacher, saved as it is chosen | Teacher assigned. | Pass |
| [06-04](#06-04-teaching-bbs) | BBS Year 1: Puja Singh is Class Teacher; Rajan Sah takes two subjects | Teacher assigned. | Pass |
| [06-05](#06-05-class-teacher-twice) | Bikash Chaudhary as Class Teacher of a second class in the same year is refused: one class each | That teacher is already Class Teacher of another class this year. | Pass |
| [06-06](#06-06-teacher-replaced) | Grade 11 B Mathematics given to Anita Mandal instead of Bikash Chaudhary | Teacher assigned. | Pass |
| [06-07](#06-07-teacher-cleared) | Grade 11 B Biology left without a teacher for now | Teacher removed. | Pass |
| [06-08](#06-08-dashboard-checklist-done) | The dashboard's setup checklist once the year, classes, terminals, subjects, teachers and Class Teachers are in place | – | Pass |

<a id="06-01-teaching-first-class"></a>
**06-01** Teaching: the current year and its first class open straight away

![Teaching: the current year and its first class open straight away](screens/06-01-teaching-first-class.jpg)

<a id="06-02-teaching-empty-class"></a>
**06-02** Grade 11 A: a Class Teacher and one teacher per subject, none chosen yet

![Grade 11 A: a Class Teacher and one teacher per subject, none chosen yet](screens/06-02-teaching-empty-class.jpg)

<a id="06-03-teaching-grade11a"></a>
**06-03** Grade 11 A: Bikash Chaudhary is Class Teacher; each subject has its teacher, saved as it is chosen

![Grade 11 A: Bikash Chaudhary is Class Teacher; each subject has its teacher, saved as it is chosen](screens/06-03-teaching-grade11a.jpg)

<a id="06-04-teaching-bbs"></a>
**06-04** BBS Year 1: Puja Singh is Class Teacher; Rajan Sah takes two subjects

![BBS Year 1: Puja Singh is Class Teacher; Rajan Sah takes two subjects](screens/06-04-teaching-bbs.jpg)

<a id="06-05-class-teacher-twice"></a>
**06-05** Bikash Chaudhary as Class Teacher of a second class in the same year is refused: one class each

![Bikash Chaudhary as Class Teacher of a second class in the same year is refused: one class each](screens/06-05-class-teacher-twice.jpg)

<a id="06-06-teacher-replaced"></a>
**06-06** Grade 11 B Mathematics given to Anita Mandal instead of Bikash Chaudhary

![Grade 11 B Mathematics given to Anita Mandal instead of Bikash Chaudhary](screens/06-06-teacher-replaced.jpg)

<a id="06-07-teacher-cleared"></a>
**06-07** Grade 11 B Biology left without a teacher for now

![Grade 11 B Biology left without a teacher for now](screens/06-07-teacher-cleared.jpg)

<a id="06-08-dashboard-checklist-done"></a>
**06-08** The dashboard's setup checklist once the year, classes, terminals, subjects, teachers and Class Teachers are in place

![The dashboard's setup checklist once the year, classes, terminals, subjects, teachers and Class Teachers are in place](screens/06-08-dashboard-checklist-done.jpg)

## 7. Admissions: walk-ins

Students the Co-ordinator registers herself are admitted at once.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [07-01](#07-01-walkin-form) | Register a walk-in: the Co-ordinator's own registration is admitted at once (no queue) | – | Pass |
| [07-02](#07-02-walkin-empty) | Admit with nothing filled in: each required field is asked for | This is required. / That does not look like a phone number. / That does not look like an email address. | Pass |
| [07-03](#07-03-walkin-filled) | Aarav Mandal: born 12 Jestha 2066 (BS), Grade 11 of +2 Science, class A, with his previous school and who referred him | – | Pass |
| [07-04](#07-04-walkin-admitted) | Admitted at once: the new student ID, 2083-00001, and the temporary password, shown once (F-04 fixed) | Temporary password for Aarav Mandal (password) Give this to Aarav Mandal in person or by phone. It is shown once and cannot be looked up again. They must cho… | Pass |
| [07-05](#07-05-walkin-duplicate) | The same name, date of birth and phone again: she is shown the student already admitted, and nobody is admitted twice unless she says so (F-03 fixed) | This may be a student already admitted: Aarav Mandal (2083-00001) Admit only if this is a different person. | Pass |
| [07-06](#07-06-walkin-bbs) | Bibek Shrestha admitted to BBS Year 1: the next number in the same school-wide sequence | Temporary password for Bibek Shrestha (password) Give this to Bibek Shrestha in person or by phone. It is shown once and cannot be looked up again. They must… | Pass |

<a id="07-01-walkin-form"></a>
**07-01** Register a walk-in: the Co-ordinator's own registration is admitted at once (no queue)

![Register a walk-in: the Co-ordinator's own registration is admitted at once (no queue)](screens/07-01-walkin-form.jpg)

<a id="07-02-walkin-empty"></a>
**07-02** Admit with nothing filled in: each required field is asked for

![Admit with nothing filled in: each required field is asked for](screens/07-02-walkin-empty.jpg)

<a id="07-03-walkin-filled"></a>
**07-03** Aarav Mandal: born 12 Jestha 2066 (BS), Grade 11 of +2 Science, class A, with his previous school and who referred him

![Aarav Mandal: born 12 Jestha 2066 (BS), Grade 11 of +2 Science, class A, with his previous school and who referred him](screens/07-03-walkin-filled.jpg)

<a id="07-04-walkin-admitted"></a>
**07-04** Admitted at once: the new student ID, 2083-00001, and the temporary password, shown once (F-04 fixed)

![Admitted at once: the new student ID, 2083-00001, and the temporary password, shown once (F-04 fixed)](screens/07-04-walkin-admitted.jpg)

<a id="07-05-walkin-duplicate"></a>
**07-05** The same name, date of birth and phone again: she is shown the student already admitted, and nobody is admitted twice unless she says so (F-03 fixed)

![The same name, date of birth and phone again: she is shown the student already admitted, and nobody is admitted twice unless she says so (F-03 fixed)](screens/07-05-walkin-duplicate.jpg)

<a id="07-06-walkin-bbs"></a>
**07-06** Bibek Shrestha admitted to BBS Year 1: the next number in the same school-wide sequence

![Bibek Shrestha admitted to BBS Year 1: the next number in the same school-wide sequence](screens/07-06-walkin-bbs.jpg)

## 8. Admissions: the queue

Applications from the public website (confirmed by email) and from the Accountant: approve into a class, ask for changes, reject.

**Precondition (P1):** three applicants applied on the public website and confirmed their email; the Accountant registered one student.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [08-01](#08-01-queue) | The admissions queue: what is waiting, asked for changes and possibly a duplicate, then one card per application with the section's name (F-05 fixed) | – | Pass |
| [08-02](#08-02-review) | Reviewing Pooja Sharma in a side panel: her details, then Approve, Ask for changes or Reject | – | Pass |
| [08-03](#08-03-approve-no-class) | Approve and admit with no class chosen: the class is asked for | Choose a class. | Pass |
| [08-04](#08-04-approve-class) | Approve into +2 Science Grade 11 B: the message goes as soon as a class is chosen | – | Pass |
| [08-05](#08-05-approved) | Approved: Pooja Sharma is a student, with her student ID and a temporary password shown once | Pooja Sharma is admitted as 2083-00015. / Temporary password for Pooja Sharma (password) Give this to Pooja Sharma in person or by phone. It is shown once an… | Pass |
| [08-06](#08-06-changes-no-reason) | Ask for changes with no reason: a reason is asked for | Give a reason. | Pass |
| [08-07](#08-07-changes-sent) | Changes asked of Rajesh Yadav: the application waits for him to fix it (the fix-it path, not a rejection) | – | Pass |
| [08-07a](#08-07a-changes-sent-panel) | Sent: the panel closes into what happened, with no old message left behind (F-01 fixed) | Sent back to Rajesh Yadav to change. | Pass |
| [08-08](#08-08-reject-reason) | Rejecting Sunil Thapa, with the reason he will be told | – | Pass |
| [08-09](#08-09-rejected) | Rejected: final, the application leaves the queue for good | The application of Sunil Thapa is rejected. | Pass |
| [08-10](#08-10-duplicate-review) | Sita Choudhary, flagged as a possible duplicate: the same phone and date of birth as Sita Chaudhary, already a student | This may be someone already known to the school. The phone number matches a student or another application. | Pass |
| [08-11](#08-11-queue-after) | The Accountant's registration (Ritu Gupta) approved into Grade 12 A; the queue is down to what is still waiting | – | Pass |

<a id="08-01-queue"></a>
**08-01** The admissions queue: what is waiting, asked for changes and possibly a duplicate, then one card per application with the section's name (F-05 fixed)

![The admissions queue: what is waiting, asked for changes and possibly a duplicate, then one card per application with the section's name (F-05 fixed)](screens/08-01-queue.jpg)

<a id="08-02-review"></a>
**08-02** Reviewing Pooja Sharma in a side panel: her details, then Approve, Ask for changes or Reject

![Reviewing Pooja Sharma in a side panel: her details, then Approve, Ask for changes or Reject](screens/08-02-review.jpg)

<a id="08-03-approve-no-class"></a>
**08-03** Approve and admit with no class chosen: the class is asked for

![Approve and admit with no class chosen: the class is asked for](screens/08-03-approve-no-class.jpg)

<a id="08-04-approve-class"></a>
**08-04** Approve into +2 Science Grade 11 B: the message goes as soon as a class is chosen

![Approve into +2 Science Grade 11 B: the message goes as soon as a class is chosen](screens/08-04-approve-class.jpg)

<a id="08-05-approved"></a>
**08-05** Approved: Pooja Sharma is a student, with her student ID and a temporary password shown once

![Approved: Pooja Sharma is a student, with her student ID and a temporary password shown once](screens/08-05-approved.jpg)

<a id="08-06-changes-no-reason"></a>
**08-06** Ask for changes with no reason: a reason is asked for

![Ask for changes with no reason: a reason is asked for](screens/08-06-changes-no-reason.jpg)

<a id="08-07-changes-sent"></a>
**08-07** Changes asked of Rajesh Yadav: the application waits for him to fix it (the fix-it path, not a rejection)

![Changes asked of Rajesh Yadav: the application waits for him to fix it (the fix-it path, not a rejection)](screens/08-07-changes-sent.jpg)

<a id="08-07a-changes-sent-panel"></a>
**08-07a** Sent: the panel closes into what happened, with no old message left behind (F-01 fixed)

![Sent: the panel closes into what happened, with no old message left behind (F-01 fixed)](screens/08-07a-changes-sent-panel.jpg)

<a id="08-08-reject-reason"></a>
**08-08** Rejecting Sunil Thapa, with the reason he will be told

![Rejecting Sunil Thapa, with the reason he will be told](screens/08-08-reject-reason.jpg)

<a id="08-09-rejected"></a>
**08-09** Rejected: final, the application leaves the queue for good

![Rejected: final, the application leaves the queue for good](screens/08-09-rejected.jpg)

<a id="08-10-duplicate-review"></a>
**08-10** Sita Choudhary, flagged as a possible duplicate: the same phone and date of birth as Sita Chaudhary, already a student

![Sita Choudhary, flagged as a possible duplicate: the same phone and date of birth as Sita Chaudhary, already a student](screens/08-10-duplicate-review.jpg)

<a id="08-11-queue-after"></a>
**08-11** The Accountant's registration (Ritu Gupta) approved into Grade 12 A; the queue is down to what is still waiting

![The Accountant's registration (Ritu Gupta) approved into Grade 12 A; the queue is down to what is still waiting](screens/08-11-queue-after.jpg)

## 9. Admissions: search

Finding a student by name, student ID or phone.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [09-01](#09-01-search-name) | Search by name: 'Sah' finds Rohan Sah and Manisha Sah, each with student ID and class, and each opens their record | – | Pass |
| [09-02](#09-02-search-sid) | Search by student ID: 2083-00004 is Sita Chaudhary | – | Pass |
| [09-03](#09-03-search-phone) | Search by phone: one Aarav Mandal, 2083-00001 (the second walk-in was stopped as a duplicate, F-03 fixed) | – | Pass |
| [09-04](#09-04-search-approved) | Pooja Sharma, approved from the queue, is now a student in Grade 11 B | – | Pass |
| [09-05](#09-05-search-rejected) | Sunil Thapa was rejected, so he is not a student | – | Pass |
| [09-06](#09-06-search-none) | A search that finds no one | – | Pass |
| [09-07](#09-07-student-record) | Manisha Sah's record, opened from search, with Correct details (F-06 fixed) | – | Pass |
| [09-08](#09-08-correct-no-reason) | A correction without a reason is refused: the reason is kept in the audit trail | Say why the details are being corrected. | Pass |
| [09-09](#09-09-corrected) | Corrected: her guardian is now Ram Kumar Sah, the student ID unchanged; the audit trail keeps what changed and why | The corrections are saved, and the audit trail keeps what changed and why. | Pass |

<a id="09-01-search-name"></a>
**09-01** Search by name: 'Sah' finds Rohan Sah and Manisha Sah, each with student ID and class, and each opens their record

![Search by name: 'Sah' finds Rohan Sah and Manisha Sah, each with student ID and class, and each opens their record](screens/09-01-search-name.jpg)

<a id="09-02-search-sid"></a>
**09-02** Search by student ID: 2083-00004 is Sita Chaudhary

![Search by student ID: 2083-00004 is Sita Chaudhary](screens/09-02-search-sid.jpg)

<a id="09-03-search-phone"></a>
**09-03** Search by phone: one Aarav Mandal, 2083-00001 (the second walk-in was stopped as a duplicate, F-03 fixed)

![Search by phone: one Aarav Mandal, 2083-00001 (the second walk-in was stopped as a duplicate, F-03 fixed)](screens/09-03-search-phone.jpg)

<a id="09-04-search-approved"></a>
**09-04** Pooja Sharma, approved from the queue, is now a student in Grade 11 B

![Pooja Sharma, approved from the queue, is now a student in Grade 11 B](screens/09-04-search-approved.jpg)

<a id="09-05-search-rejected"></a>
**09-05** Sunil Thapa was rejected, so he is not a student

![Sunil Thapa was rejected, so he is not a student](screens/09-05-search-rejected.jpg)

<a id="09-06-search-none"></a>
**09-06** A search that finds no one

![A search that finds no one](screens/09-06-search-none.jpg)

<a id="09-07-student-record"></a>
**09-07** Manisha Sah's record, opened from search, with Correct details (F-06 fixed)

![Manisha Sah's record, opened from search, with Correct details (F-06 fixed)](screens/09-07-student-record.jpg)

<a id="09-08-correct-no-reason"></a>
**09-08** A correction without a reason is refused: the reason is kept in the audit trail

![A correction without a reason is refused: the reason is kept in the audit trail](screens/09-08-correct-no-reason.jpg)

<a id="09-09-corrected"></a>
**09-09** Corrected: her guardian is now Ram Kumar Sah, the student ID unchanged; the audit trail keeps what changed and why

![Corrected: her guardian is now Ram Kumar Sah, the student ID unchanged; the audit trail keeps what changed and why](screens/09-09-corrected.jpg)

## 10. Attendance

Reading the students' registers, and marking teacher attendance for today and a past day.

**Precondition (P2):** each teacher signed in for the first time; the Class Teachers marked today's registers (Grade 12 left unmarked); three teachers wrote today's activity log.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [10-01](#10-01-attendance-classes) | Student attendance: today's register for every class; Grade 12 A has not been marked | – | Pass |
| [10-02](#10-02-attendance-g11a) | Grade 11 A today: two absent, marked by the Class Teacher; the Co-ordinator can look but not mark | – | Pass |
| [10-03](#10-03-attendance-not-marked) | Grade 12 A: no register yet today | – | Pass |
| [10-04](#10-04-teacher-attendance-today) | Teacher attendance today: everyone starts as Present; the Co-ordinator records exceptions | – | Pass |
| [10-05](#10-05-teacher-attendance-marked) | Suresh Karki on leave and Rajan Sah absent, each one tap; the figures follow as she marks | – | Pass |
| [10-06](#10-06-teacher-attendance-saved) | Saved for today | Saved. | Pass |
| [10-07](#10-07-teacher-attendance-past-day) | A past day, 16 Ashwin: it can still be filled in, but a reason is needed | – | Pass |
| [10-08](#10-08-past-day-no-reason) | Saving a past day without a reason is refused | Give a reason for changing a past day. | Pass |
| [10-09](#10-09-past-day-saved) | Saved with the reason, which is kept with the change | Saved. | Pass |

<a id="10-01-attendance-classes"></a>
**10-01** Student attendance: today's register for every class; Grade 12 A has not been marked

![Student attendance: today's register for every class; Grade 12 A has not been marked](screens/10-01-attendance-classes.jpg)

<a id="10-02-attendance-g11a"></a>
**10-02** Grade 11 A today: two absent, marked by the Class Teacher; the Co-ordinator can look but not mark

![Grade 11 A today: two absent, marked by the Class Teacher; the Co-ordinator can look but not mark](screens/10-02-attendance-g11a.jpg)

<a id="10-03-attendance-not-marked"></a>
**10-03** Grade 12 A: no register yet today

![Grade 12 A: no register yet today](screens/10-03-attendance-not-marked.jpg)

<a id="10-04-teacher-attendance-today"></a>
**10-04** Teacher attendance today: everyone starts as Present; the Co-ordinator records exceptions

![Teacher attendance today: everyone starts as Present; the Co-ordinator records exceptions](screens/10-04-teacher-attendance-today.jpg)

<a id="10-05-teacher-attendance-marked"></a>
**10-05** Suresh Karki on leave and Rajan Sah absent, each one tap; the figures follow as she marks

![Suresh Karki on leave and Rajan Sah absent, each one tap; the figures follow as she marks](screens/10-05-teacher-attendance-marked.jpg)

<a id="10-06-teacher-attendance-saved"></a>
**10-06** Saved for today

![Saved for today](screens/10-06-teacher-attendance-saved.jpg)

<a id="10-07-teacher-attendance-past-day"></a>
**10-07** A past day, 16 Ashwin: it can still be filled in, but a reason is needed

![A past day, 16 Ashwin: it can still be filled in, but a reason is needed](screens/10-07-teacher-attendance-past-day.jpg)

<a id="10-08-past-day-no-reason"></a>
**10-08** Saving a past day without a reason is refused

![Saving a past day without a reason is refused](screens/10-08-past-day-no-reason.jpg)

<a id="10-09-past-day-saved"></a>
**10-09** Saved with the reason, which is kept with the change

![Saved with the reason, which is kept with the change](screens/10-09-past-day-saved.jpg)

## 11. Classwork and electives

Reading the activity log, and recording each student's elective (Science option).

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [11-01](#11-01-classwork) | Classwork: today's activity log for each class, with how many subjects have written theirs | – | Pass |
| [11-02](#11-02-classwork-g11a) | Grade 11 A today: Physics and English written by their teachers; the other subjects have nothing yet | – | Pass |
| [11-03](#11-03-electives-choose) | Electives: the first class opens straight away, with how many students still have to choose | – | Pass |
| [11-04](#11-04-electives-not-chosen) | Grade 11 A: every student's Science option is Not chosen yet | – | Pass |
| [11-05](#11-05-electives-chosen) | Grade 11 A: each student's Science option chosen, saved as it is picked (Biology or Computer Science) | Saved. | Pass |

<a id="11-01-classwork"></a>
**11-01** Classwork: today's activity log for each class, with how many subjects have written theirs

![Classwork: today's activity log for each class, with how many subjects have written theirs](screens/11-01-classwork.jpg)

<a id="11-02-classwork-g11a"></a>
**11-02** Grade 11 A today: Physics and English written by their teachers; the other subjects have nothing yet

![Grade 11 A today: Physics and English written by their teachers; the other subjects have nothing yet](screens/11-02-classwork-g11a.jpg)

<a id="11-03-electives-choose"></a>
**11-03** Electives: the first class opens straight away, with how many students still have to choose

![Electives: the first class opens straight away, with how many students still have to choose](screens/11-03-electives-choose.jpg)

<a id="11-04-electives-not-chosen"></a>
**11-04** Grade 11 A: every student's Science option is Not chosen yet

![Grade 11 A: every student's Science option is Not chosen yet](screens/11-04-electives-not-chosen.jpg)

<a id="11-05-electives-chosen"></a>
**11-05** Grade 11 A: each student's Science option chosen, saved as it is picked (Biology or Computer Science)

![Grade 11 A: each student's Science option chosen, saved as it is picked (Biology or Computer Science)](screens/11-05-electives-chosen.jpg)

## 12. Results: review, send back, verify and publish

The first terminal from the teachers' marks to published results, a class sheet and Top 20.

**Precondition (P3):** the subject teachers entered the first terminal's marks; Nepali was left as a draft. Between the two halves (P3b), Anita Mandal corrected the English mark that was sent back and Kamala Rai sent Nepali.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [12-01](#12-01-review-opens-on-final) | Review results opens on the terminal in progress, the first terminal, where the marks are waiting (F-07 fixed) | – | Pass |
| [12-02](#12-02-review-first-terminal) | First terminal: Grade 11 A has six subjects under review and Nepali still a draft; BBS Year 1 is all under review; Publish waits for every subject | – | Pass |
| [12-03](#12-03-publish-blocked) | Publish for Grade 11 A stays off and says what it is waiting for (Nepali is a draft, nothing is verified yet) | – | Pass |
| [12-04](#12-04-sheet-english) | Grade 11 A English, sent by Anita Mandal: every mark, ready to verify or send back | – | Pass |
| [12-05](#12-05-send-back-no-note) | Send back asks for a note for the teacher; it cannot be sent until one is written | – | Pass |
| [12-06](#12-06-sent-back) | English sent back to Anita Mandal with the note; she can change marks again | Sent back to the teacher. | Pass |
| [12-07](#12-07-review-all-sent) | Every Grade 11 A subject is now under review again, English with Kritika's mark corrected and Nepali sent | – | Pass |
| [12-08](#12-08-verify-selected) | All 10 subjects ticked: Verify selected verifies them together | – | Pass |
| [12-09](#12-09-verified) | Every subject verified: Publish is now available for both classes | 10 verified. | Pass |
| [12-10](#12-10-published) | Grade 11 A first terminal published: a marks card is made for each student | Published. 6 marks cards made. | Pass |
| [12-10b](#12-10b-both-published) | BBS Year 1 published too; Grade 11 B and Grade 12 A have no marks yet | Published. 3 marks cards made. | Pass |
| [12-11](#12-11-class-sheet) | Grade 11 A class sheet: NEB letter grades per subject, GPA, result and rank; a student who failed a subject gets NG and no rank | – | Pass |
| [12-12](#12-12-marks-card) | Kritika Jha's marks card, a snapshot of the published result | – | Pass |
| [12-13](#12-13-top20) | Top 20 for the first terminal, ranked per section, from published results only | – | Pass |

<a id="12-01-review-opens-on-final"></a>
**12-01** Review results opens on the terminal in progress, the first terminal, where the marks are waiting (F-07 fixed)

![Review results opens on the terminal in progress, the first terminal, where the marks are waiting (F-07 fixed)](screens/12-01-review-opens-on-final.jpg)

<a id="12-02-review-first-terminal"></a>
**12-02** First terminal: Grade 11 A has six subjects under review and Nepali still a draft; BBS Year 1 is all under review; Publish waits for every subject

![First terminal: Grade 11 A has six subjects under review and Nepali still a draft; BBS Year 1 is all under review; Publish waits for every subject](screens/12-02-review-first-terminal.jpg)

<a id="12-03-publish-blocked"></a>
**12-03** Publish for Grade 11 A stays off and says what it is waiting for (Nepali is a draft, nothing is verified yet)

![Publish for Grade 11 A stays off and says what it is waiting for (Nepali is a draft, nothing is verified yet)](screens/12-03-publish-blocked.jpg)

<a id="12-04-sheet-english"></a>
**12-04** Grade 11 A English, sent by Anita Mandal: every mark, ready to verify or send back

![Grade 11 A English, sent by Anita Mandal: every mark, ready to verify or send back](screens/12-04-sheet-english.jpg)

<a id="12-05-send-back-no-note"></a>
**12-05** Send back asks for a note for the teacher; it cannot be sent until one is written

![Send back asks for a note for the teacher; it cannot be sent until one is written](screens/12-05-send-back-no-note.jpg)

<a id="12-06-sent-back"></a>
**12-06** English sent back to Anita Mandal with the note; she can change marks again

![English sent back to Anita Mandal with the note; she can change marks again](screens/12-06-sent-back.jpg)

<a id="12-07-review-all-sent"></a>
**12-07** Every Grade 11 A subject is now under review again, English with Kritika's mark corrected and Nepali sent

![Every Grade 11 A subject is now under review again, English with Kritika's mark corrected and Nepali sent](screens/12-07-review-all-sent.jpg)

<a id="12-08-verify-selected"></a>
**12-08** All 10 subjects ticked: Verify selected verifies them together

![All 10 subjects ticked: Verify selected verifies them together](screens/12-08-verify-selected.jpg)

<a id="12-09-verified"></a>
**12-09** Every subject verified: Publish is now available for both classes

![Every subject verified: Publish is now available for both classes](screens/12-09-verified.jpg)

<a id="12-10-published"></a>
**12-10** Grade 11 A first terminal published: a marks card is made for each student

![Grade 11 A first terminal published: a marks card is made for each student](screens/12-10-published.jpg)

<a id="12-10b-both-published"></a>
**12-10b** BBS Year 1 published too; Grade 11 B and Grade 12 A have no marks yet

![BBS Year 1 published too; Grade 11 B and Grade 12 A have no marks yet](screens/12-10b-both-published.jpg)

<a id="12-11-class-sheet"></a>
**12-11** Grade 11 A class sheet: NEB letter grades per subject, GPA, result and rank; a student who failed a subject gets NG and no rank

![Grade 11 A class sheet: NEB letter grades per subject, GPA, result and rank; a student who failed a subject gets NG and no rank](screens/12-11-class-sheet.jpg)

<a id="12-12-marks-card"></a>
**12-12** Kritika Jha's marks card, a snapshot of the published result

![Kritika Jha's marks card, a snapshot of the published result](screens/12-12-marks-card.jpg)

<a id="12-13-top20"></a>
**12-13** Top 20 for the first terminal, ranked per section, from published results only

![Top 20 for the first terminal, ranked per section, from published results only](screens/12-13-top20.jpg)

## 13. Results: rechecks

Two students ask for a recheck; one is unchanged, one changes a mark.

**Precondition (P4):** Kritika Jha and Rohan Sah, signed in as themselves, asked for rechecks.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [13-01](#13-01-rechecks) | Rechecks: two students ask about a published subject; the figures say two are waiting, and each has Decide | – | Pass |
| [13-01b](#13-01b-recheck-panel) | Rohan Sah's recheck in a side panel: why he asked, the marks now, the marks to correct and a reason; No change stays off until a reason is written | – | Pass |
| [13-02](#13-02-recheck-no-change) | Rohan Sah's recheck closed with no change, and the reason | Saved. Rohan Sah's Physics marks stay as they were. | Pass |
| [13-03](#13-03-recheck-mark-changed) | Kritika Jha's Chemistry theory raised from 24.75 to 29.75: the button now saves a change, and a reason is still required | Saved. Rohan Sah's Physics marks stay as they were. | Pass |
| [13-04](#13-04-recheck-changed) | Changed: the published result is updated, the marks card gets a new version, and the Principal is told of the change | Saved. Kritika Jha's Chemistry marks are corrected. | Pass |
| [13-05](#13-05-sheet-after-recheck) | The class sheet after the recheck: Kritika Jha's Chemistry grade reflects the new mark | – | Pass |

<a id="13-01-rechecks"></a>
**13-01** Rechecks: two students ask about a published subject; the figures say two are waiting, and each has Decide

![Rechecks: two students ask about a published subject; the figures say two are waiting, and each has Decide](screens/13-01-rechecks.jpg)

<a id="13-01b-recheck-panel"></a>
**13-01b** Rohan Sah's recheck in a side panel: why he asked, the marks now, the marks to correct and a reason; No change stays off until a reason is written

![Rohan Sah's recheck in a side panel: why he asked, the marks now, the marks to correct and a reason; No change stays off until a reason is written](screens/13-01b-recheck-panel.jpg)

<a id="13-02-recheck-no-change"></a>
**13-02** Rohan Sah's recheck closed with no change, and the reason

![Rohan Sah's recheck closed with no change, and the reason](screens/13-02-recheck-no-change.jpg)

<a id="13-03-recheck-mark-changed"></a>
**13-03** Kritika Jha's Chemistry theory raised from 24.75 to 29.75: the button now saves a change, and a reason is still required

![Kritika Jha's Chemistry theory raised from 24.75 to 29.75: the button now saves a change, and a reason is still required](screens/13-03-recheck-mark-changed.jpg)

<a id="13-04-recheck-changed"></a>
**13-04** Changed: the published result is updated, the marks card gets a new version, and the Principal is told of the change

![Changed: the published result is updated, the marks card gets a new version, and the Principal is told of the change](screens/13-04-recheck-changed.jpg)

<a id="13-05-sheet-after-recheck"></a>
**13-05** The class sheet after the recheck: Kritika Jha's Chemistry grade reflects the new mark

![The class sheet after the recheck: Kritika Jha's Chemistry grade reflects the new mark](screens/13-05-sheet-after-recheck.jpg)

## 14. Website: drafts for the Principal

The Co-ordinator drafts website content and sends it to the Principal, who approves or declines it.

**Precondition (P5):** between the two halves, the Principal approved the notice and declined the Science exhibition with a reason.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [14-01](#14-01-website-coordinator) | Website Content as the Co-ordinator: the same list, plus Your requests; publishing is the Principal's | – | Pass |
| [14-02](#14-02-new-notice) | A new notice drafted by the Co-ordinator: Save draft, or Send for approval in one step; there is no Publish for her (F-08 fixed) | – | Pass |
| [14-03](#14-03-publish-tried) | Saved as a draft: in the list, not yet sent to the Principal | Saved as a draft. Send it for approval when you are ready. | Pass |
| [14-04](#14-04-draft-row) | The draft in the list, with Edit and Send for approval inside the table (F-09 fixed) | – | Pass |
| [14-05](#14-05-sent-for-approval) | Sent: the notice waits for the Principal and is listed under Your requests | Sent for approval: “Parents' meeting for Grade 11” now waits for an Admin. | Pass |
| [14-06](#14-06-three-requests) | Three requests waiting for the Principal | Saved and sent for approval. It goes on the website once an Admin approves it. | Pass |
| [14-07](#14-07-withdrawn) | The Library hours request withdrawn by the Co-ordinator: back to a draft she can still edit | Withdrawn: “Information "Library hours during exams"” is a draft again. | Pass |
| [14-08](#14-08-outcomes) | After the Principal decided: the notice is approved and on the website, the Science exhibition declined with a reason the Co-ordinator can read | – | Pass |

<a id="14-01-website-coordinator"></a>
**14-01** Website Content as the Co-ordinator: the same list, plus Your requests; publishing is the Principal's

![Website Content as the Co-ordinator: the same list, plus Your requests; publishing is the Principal's](screens/14-01-website-coordinator.jpg)

<a id="14-02-new-notice"></a>
**14-02** A new notice drafted by the Co-ordinator: Save draft, or Send for approval in one step; there is no Publish for her (F-08 fixed)

![A new notice drafted by the Co-ordinator: Save draft, or Send for approval in one step; there is no Publish for her (F-08 fixed)](screens/14-02-new-notice.jpg)

<a id="14-03-publish-tried"></a>
**14-03** Saved as a draft: in the list, not yet sent to the Principal

![Saved as a draft: in the list, not yet sent to the Principal](screens/14-03-publish-tried.jpg)

<a id="14-04-draft-row"></a>
**14-04** The draft in the list, with Edit and Send for approval inside the table (F-09 fixed)

![The draft in the list, with Edit and Send for approval inside the table (F-09 fixed)](screens/14-04-draft-row.jpg)

<a id="14-05-sent-for-approval"></a>
**14-05** Sent: the notice waits for the Principal and is listed under Your requests

![Sent: the notice waits for the Principal and is listed under Your requests](screens/14-05-sent-for-approval.jpg)

<a id="14-06-three-requests"></a>
**14-06** Three requests waiting for the Principal

![Three requests waiting for the Principal](screens/14-06-three-requests.jpg)

<a id="14-07-withdrawn"></a>
**14-07** The Library hours request withdrawn by the Co-ordinator: back to a draft she can still edit

![The Library hours request withdrawn by the Co-ordinator: back to a draft she can still edit](screens/14-07-withdrawn.jpg)

<a id="14-08-outcomes"></a>
**14-08** After the Principal decided: the notice is approved and on the website, the Science exhibition declined with a reason the Co-ordinator can read

![After the Principal decided: the notice is approved and on the website, the Science exhibition declined with a reason the Co-ordinator can read](screens/14-08-outcomes.jpg)

## 15. Own account, and what a Co-ordinator must not do

Profile, password and sign-out; other roles' pages opened by address; the server's answer to forbidden actions.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [15-01](#15-01-settings) | Settings: her profile, password and sign out | – | Pass |
| [15-02](#15-02-profile-saved) | Her phone corrected and saved | – | Pass |
| [15-03](#15-03-password-changed) | Password changed (other devices are signed out) | Your password is changed. You stay signed in here; other devices are signed out. | Pass |
| [15-04](#15-04-fees-page) | Fees (the Accountant's), opened by address: the Co-ordinator has no Fees view | – | Pass |
| [15-05](#15-05-approvals-page) | The Principal's Approvals inbox, opened by address | You no longer have permission to see this. Sign in again. | Pass |
| [15-06](#15-06-programmes-read-only) | Programmes: the Co-ordinator can look; sections and programmes are the Principal's | You can look at this, but only the Principal adds and changes programmes and their levels. | Pass |
| [15-07](#15-07-reports-page) | Reports, now in her menu (F-10 fixed): school setup, students and results; money and oversight stay the Principal's | – | Pass |
| [15-08](#15-08-attendance-mine) | A teacher's own attendance page, opened by address | You do not have access to this page. | Pass |
| [15-09](#15-09-signed-out) | Signed out | – | Pass |
| [15-10](#15-10-signed-in-again) | Signed in again with the new password: no second step for a Co-ordinator (only the Principal and Support use an authenticator app) | – | Pass |

<a id="15-01-settings"></a>
**15-01** Settings: her profile, password and sign out

![Settings: her profile, password and sign out](screens/15-01-settings.jpg)

<a id="15-02-profile-saved"></a>
**15-02** Her phone corrected and saved

![Her phone corrected and saved](screens/15-02-profile-saved.jpg)

<a id="15-03-password-changed"></a>
**15-03** Password changed (other devices are signed out)

![Password changed (other devices are signed out)](screens/15-03-password-changed.jpg)

<a id="15-04-fees-page"></a>
**15-04** Fees (the Accountant's), opened by address: the Co-ordinator has no Fees view

![Fees (the Accountant's), opened by address: the Co-ordinator has no Fees view](screens/15-04-fees-page.jpg)

<a id="15-05-approvals-page"></a>
**15-05** The Principal's Approvals inbox, opened by address

![The Principal's Approvals inbox, opened by address](screens/15-05-approvals-page.jpg)

<a id="15-06-programmes-read-only"></a>
**15-06** Programmes: the Co-ordinator can look; sections and programmes are the Principal's

![Programmes: the Co-ordinator can look; sections and programmes are the Principal's](screens/15-06-programmes-read-only.jpg)

<a id="15-07-reports-page"></a>
**15-07** Reports, now in her menu (F-10 fixed): school setup, students and results; money and oversight stay the Principal's

![Reports, now in her menu (F-10 fixed): school setup, students and results; money and oversight stay the Principal's](screens/15-07-reports-page.jpg)

<a id="15-08-attendance-mine"></a>
**15-08** A teacher's own attendance page, opened by address

![A teacher's own attendance page, opened by address](screens/15-08-attendance-mine.jpg)

<a id="15-09-signed-out"></a>
**15-09** Signed out

![Signed out](screens/15-09-signed-out.jpg)

<a id="15-10-signed-in-again"></a>
**15-10** Signed in again with the new password: no second step for a Co-ordinator (only the Principal and Support use an authenticator app)

![Signed in again with the new password: no second step for a Co-ordinator (only the Principal and Support use an authenticator app)](screens/15-10-signed-in-again.jpg)

### The server's answers

Each request was sent with Sita Sharma's own signed-in browser cookies, as a screen would send it.

| What the Co-ordinator tried | Request | Answer |
|---|---|---|
| See the dues list (fees) | `GET /api/fees/dues?classId={id}` | 403 forbidden |
| Create an Accountant | `POST /api/staff` | 403 forbidden |
| Switch off a Co-ordinator (Hari) | `PATCH /api/staff/{id}` | 403 forbidden |
| Change a Co-ordinator's access | `PATCH /api/staff/{id}/access` | 403 forbidden |
| Add a section | `POST /api/academics/sections` | 403 forbidden |
| Publish website content directly | `POST /api/content/{id}/publish` | 403 forbidden |
| Decide an approval request | `GET /api/approvals` | 403 forbidden |
| Mark a class register | `PUT /api/attendance/classes/{id}/today` | 403 forbidden |
| Enter marks | `PUT /api/results/classes/{id}/subjects/{id}/terminals/{id}` | 403 forbidden |
| Read the Principal's dashboard | `GET /api/dashboard/overview` | 403 forbidden |
| Read the test mailbox | `GET /api/dev/mailbox` | 403 forbidden |
| Register a student for the queue (the Accountant's) | `POST /api/admissions/register` | 403 forbidden |

## 16. A Co-ordinator for one section only

Hari Prasad Yadav's access reaches Bachelor's only. What he sees, and what the server answers when he reaches for +2.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [16-01](#16-01-hari-dashboard) | Hari Prasad Yadav, a Co-ordinator for Bachelor's only: his dashboard counts only Bachelor's classes | – | Pass |
| [16-02](#16-02-hari-attendance) | Attendance: only BBS Year 1 | – | Pass |
| [16-03](#16-03-hari-results) | Results review: only BBS Year 1 | – | Pass |
| [16-04](#16-04-hari-queue) | Admissions queue: only the Bachelor's application (Rajesh Yadav) | – | Pass |
| [16-05](#16-05-hari-staff) | Staff: only the Bachelor's teachers | – | Pass |
| [16-06](#16-06-hari-classes) | Classes: what Hari sees of the year's classes | – | Pass |
| [16-07](#16-07-hari-walkin) | Walk-in: Applying for offers only his section's 4 levels (F-11 fixed) | – | Pass |

<a id="16-01-hari-dashboard"></a>
**16-01** Hari Prasad Yadav, a Co-ordinator for Bachelor's only: his dashboard counts only Bachelor's classes

![Hari Prasad Yadav, a Co-ordinator for Bachelor's only: his dashboard counts only Bachelor's classes](screens/16-01-hari-dashboard.jpg)

<a id="16-02-hari-attendance"></a>
**16-02** Attendance: only BBS Year 1

![Attendance: only BBS Year 1](screens/16-02-hari-attendance.jpg)

<a id="16-03-hari-results"></a>
**16-03** Results review: only BBS Year 1

![Results review: only BBS Year 1](screens/16-03-hari-results.jpg)

<a id="16-04-hari-queue"></a>
**16-04** Admissions queue: only the Bachelor's application (Rajesh Yadav)

![Admissions queue: only the Bachelor's application (Rajesh Yadav)](screens/16-04-hari-queue.jpg)

<a id="16-05-hari-staff"></a>
**16-05** Staff: only the Bachelor's teachers

![Staff: only the Bachelor's teachers](screens/16-05-hari-staff.jpg)

<a id="16-06-hari-classes"></a>
**16-06** Classes: what Hari sees of the year's classes

![Classes: what Hari sees of the year's classes](screens/16-06-hari-classes.jpg)

<a id="16-07-hari-walkin"></a>
**16-07** Walk-in: Applying for offers only his section's 4 levels (F-11 fixed)

![Walk-in: Applying for offers only his section's 4 levels (F-11 fixed)](screens/16-07-hari-walkin.jpg)

### What Hari can reach, checked at the server

| What Hari tried | Request | Answer |
|---|---|---|
| See Grade 11 A's register (+2) | `GET /api/attendance/classes/{id}/day` | 404 not found (outside his section) |
| See BBS Year 1's register (his section) | `GET /api/attendance/classes/{id}/day` | 200 (his section) |
| Read Grade 11 A's class sheet (+2) | `GET /api/results/classes/{id}/terminals/{id}/sheet` | 404 not found (outside his section) |
| Read BBS Year 1's class sheet (his section) | `GET /api/results/classes/{id}/terminals/{id}/sheet` | 200 (his section) |
| Set Grade 11 A's electives (+2) | `GET /api/results/classes/{id}/electives` | 404 not found (outside his section) |
| Publish Grade 11 A's second terminal (+2) | `POST /api/results/classes/{id}/publish` | 404 not found (outside his section) |
| Search students (only Bachelor's should come back) | `GET /api/students?q=a` | 200: Kiran Dahal (BBS - Year 1), Manisha Sah (BBS - Year 1), Bibek Shrestha (BBS - Year 1) |

## 17. Phone, large text and the end of the run

The main screens at 375 px and at 320 px with text at 200%, and the dashboard at the end.

| # | Step | Observed on screen | Result |
|---|---|---|---|
| [17-01](#17-01-phone-dashboard) | Phone (375 px): the Co-ordinator's dashboard | – | Pass |
| [17-02](#17-02-phone-more) | Phone: More, for the places that do not fit in the tab bar | – | Pass |
| [17-03](#17-03-phone-queue) | Phone: the admissions queue | – | Pass |
| [17-04](#17-04-phone-teacher-attendance) | Phone: teacher attendance | – | Pass |
| [17-05](#17-05-phone-results) | Phone: results review | – | Pass |
| [17-06](#17-06-phone-curriculum) | Phone: curriculum | – | Pass |
| [17-07](#17-07-320-dashboard) | 320 px, text at 200%: the dashboard | – | Pass |
| [17-08](#17-08-320-queue) | 320 px, text at 200%: the admissions queue | – | Pass |
| [17-09](#17-09-320-teaching) | 320 px, text at 200%: Teaching | – | Pass |
| [17-10](#17-10-dashboard-end) | The Co-ordinator's dashboard at the end: registers marked, teacher attendance saved, activity logs, and the setup checklist complete | – | Pass |

<a id="17-01-phone-dashboard"></a>
**17-01** Phone (375 px): the Co-ordinator's dashboard

![Phone (375 px): the Co-ordinator's dashboard](screens/17-01-phone-dashboard.jpg)

<a id="17-02-phone-more"></a>
**17-02** Phone: More, for the places that do not fit in the tab bar

![Phone: More, for the places that do not fit in the tab bar](screens/17-02-phone-more.jpg)

<a id="17-03-phone-queue"></a>
**17-03** Phone: the admissions queue

![Phone: the admissions queue](screens/17-03-phone-queue.jpg)

<a id="17-04-phone-teacher-attendance"></a>
**17-04** Phone: teacher attendance

![Phone: teacher attendance](screens/17-04-phone-teacher-attendance.jpg)

<a id="17-05-phone-results"></a>
**17-05** Phone: results review

![Phone: results review](screens/17-05-phone-results.jpg)

<a id="17-06-phone-curriculum"></a>
**17-06** Phone: curriculum

![Phone: curriculum](screens/17-06-phone-curriculum.jpg)

<a id="17-07-320-dashboard"></a>
**17-07** 320 px, text at 200%: the dashboard

![320 px, text at 200%: the dashboard](screens/17-07-320-dashboard.jpg)

<a id="17-08-320-queue"></a>
**17-08** 320 px, text at 200%: the admissions queue

![320 px, text at 200%: the admissions queue](screens/17-08-320-queue.jpg)

<a id="17-09-320-teaching"></a>
**17-09** 320 px, text at 200%: Teaching

![320 px, text at 200%: Teaching](screens/17-09-320-teaching.jpg)

<a id="17-10-dashboard-end"></a>
**17-10** The Co-ordinator's dashboard at the end: registers marked, teacher attendance saved, activity logs, and the setup checklist complete

![The Co-ordinator's dashboard at the end: registers marked, teacher attendance saved, activity logs, and the setup checklist complete](screens/17-10-dashboard-end.jpg)

## Findings

### The first run's findings, fixed (D-106)

Severity as the first run gave it: **Medium** gave wrong or missing information on a real task, or left out something the role should be able to do; **Low** was confusing but had a way round; **Cosmetic** was appearance only.

| ID | Severity | What the first run found | Now | Checked at |
|---|---|---|---|---|
| F-01 | Low | A field's error stayed after the field was corrected; a dialog reopened with its old error; Ask for changes stayed open after it went through. | Each opening of a pop-up is a fresh form, a field's message goes as soon as it changes, and the review closes into what happened. | 04-02, 07-02, 08-04, 08-07a |
| F-02 | Low | A year ending before it began was refused with a general message. | The form says the last day must come after the first. | 02-03 |
| F-03 | Medium | The same person registered twice as a walk-in got two student IDs, with no warning. | The server stops it and names the existing student; Admit anyway is for real twins. | 07-05, 09-03 |
| F-04 | Low | After Admit, only the temporary password was shown, not the new student ID. | The student ID is shown with the password. | 07-04 |
| F-05 | Medium | The queue printed each section's internal key. | The section's name is shown. | 08-01 |
| F-06 | Medium (gap) | A search result could not be opened, and no screen or route corrected a student's details. | A result opens the record, and Correct details saves changes with a reason in the audit trail (`PATCH /api/students/{id}`). | 09-07 to 09-09 |
| F-07 | Low | The review board opened on the last terminal, and missing marks were counted per component. | It opens on the terminal in progress, and counts students. | 12-01, 12-02 |
| F-08 | Medium | The Co-ordinator's form offered Publish, which she may never do, and it led nowhere. | The form offers Save draft and Send for approval in one step. | 14-02, 14-06 |
| F-09 | Cosmetic | The row's Send for approval link ran past the table's edge at 1440 px. | The row's actions wrap, the second under the first, inside the table. | 14-04 |
| F-10 | Low | Reports worked by address but had no menu entry. | Reports is in her menu, showing only the groups she may read. | 15-07 |
| F-11 | Low | A Bachelor's-only Co-ordinator's walk-in form listed +2 levels. | Only his section's levels are listed. | 16-07 |
| F-12 | Low | At 375 px the phone's tab bar wrapped onto a second row. | Checked: one row (fixed with the Principal's F-15). | 17-01 |

### New in this run

None.

## What the Co-ordinator can do, and where it was tested

Every action the Co-ordinator holds in the permission matrix (`apps/api/src/core/permissions/matrix.ts`):

| Permission | What | Tested in |
|---|---|---|
| `auth.sign_in` | Sign in, change own password | 01, 15 |
| `account.profile.edit` | Correct own name and phone | 15-02 |
| `accounts.teacher.create` | Create a teacher | 05-02 to 05-07 |
| `accounts.deactivate (teachers)` | Switch a teacher off and on | 05-08, 05-09 |
| `accounts.password.issue (teachers)` | A new temporary password | 05-10 |
| `accounts.staff.view (teachers)` | The staff list | 05, 16-05 |
| `content.draft / approvals.request / approvals.view.own` | Draft website content, send it for approval, see her requests, withdraw | 14 |
| `setup.structure.manage / view` | Years, terminals, classes | 02, 04 |
| `setup.subjects.manage / view` | Subjects, curriculum, mark components, elective groups | 02-12 to 02-14, 03 |
| `setup.assignments.manage / view` | Teacher for each subject, Class Teachers | 06 |
| `admissions.walkin.register` | Register a walk-in | 07 |
| `admissions.review` | Approve, ask for changes, reject | 08 |
| `students.search / students.personal.view` | Find a student; view the record | 09 |
| `students.personal.correct` | Correct a student's details | 09-07 to 09-09 |
| `students.status.set / students.rollover` | Left or Graduated; year rollover | Not covered: Phase 8, not built |
| `attendance.student.view / attendance.teacher.mark / view` | Read registers; mark teachers, today and a past day | 10 |
| `activity.read` | Read the activity log | 11-01, 11-02 |
| `results.electives.set` | Each student's elective | 11-03 to 11-05 |
| `marks.verify / results.publish / results.view / results.top20.view` | Verify, send back, publish, class sheet, Top 20 | 12 |
| `results.recheck.edit` | Decide rechecks | 13 |
| `reports.students / reports.results` | Reports | 15-07 |

## Not covered

- **Marking a student Left or Graduated, and the year rollover** (Phase 8, not built).
- **Uploads** (an applicant's certificate): uploads are off until R2 is enabled (D-020).
- **Real email and SMS:** only the development mailbox exists.
- **The teachers', students' and Accountant's own screens:** they appear here only as preconditions; each role needs its own FUT.
