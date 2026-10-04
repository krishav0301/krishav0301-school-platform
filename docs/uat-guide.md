# UAT guide: the test site

For the people testing the school platform before it goes live (D-086). Everything on this site is fake: no real students, money or email.

**Address:** https://school-platform-staging.k-rishav0301.workers.dev

## Signing in

The operator gives each tester their sign-in privately (never in chat or email threads).

- **Staff accounts** (Admin, Co-ordinator, Accountant, Support) already exist.
- **Teachers and students** from the starter set get a temporary password. At the first sign-in the site asks them to choose their own.
- **Admin and Support** set up an authenticator app (for example Google Authenticator) at their first sign-in, and then enter its six-digit code each time.

New accounts are made the way the school will make them:

| Who is added | Who adds them | Where |
|---|---|---|
| Co-ordinator, Accountant | Admin | People |
| Teacher | Co-ordinator | People |
| Student (walk-in, or an approved application) | Co-ordinator | Admissions |

Each new person gets a one-time temporary password on screen, to hand to them.

## Emails: the test mailbox

This site does not send real email. What it would have sent (an applicant's "confirm your email" link, a password reset) is kept in the **test mailbox**. An Admin opens it at `/portal/mailbox` (it is not in the menu), finds the email, and passes the link to the tester. The mailbox does not exist on the real site.

## What is set up already (the starter set)

One open academic term (2083, running Grade 11 and Grade 12), three exams, and class A of Grade 11 and Grade 12 with five subjects each (theory and practical parts), three teachers assigned (one is each class's Class Teacher), six students in each class, and a fee structure per grade, approved and charged. The subjects, marks split and fee amounts are stand-ins, not the college's own.

## What to try, by role

**Co-ordinator:** add a teacher; register a walk-in student; review an online application (apply from the public Admission page, confirm through the test mailbox); mark teachers' attendance; verify marks sheets and publish an exam's results; decide a recheck; after the Admin closes a term, move its students on (Setup, Move students: promote, repeat, leaving or graduated).

**Teacher:** mark today's attendance for your class; write the activity log; add a note and homework; review a submission; enter marks and send them for review.

**Accountant:** take a cash payment and print the receipt; check a student's fee account and the dues list; verify a bank voucher; propose a discount or a reversal; request a refund.

**Admin:** approve or decline fee requests and website changes; edit and publish a notice on the public site; add a Co-ordinator or Accountant; read the test mailbox; on **Academic terms**, make a new term (a semester or a year, with its levels), open it, try closing the current term (it says class by class which results are missing) and fill in the next term.

**Student:** see your attendance, homework (and submit it), fees and receipts, results and marks card; report a bank voucher; ask for a recheck.

**Anyone:** the public site on a phone and a computer: Home, Programmes, Admission (apply), Scholarships, Facilities, Contact.

## Not in this test (known limits)

- **Results for +2 are not final:** the NEB grading scale is not yet checked against the official directive (D-085).
- **No file uploads** (certificates, homework files, voucher scans) until file storage is turned on.
- **Online payment is a demo:** no real money moves, and no gateway page opens.
- **No SMS.** Email only goes to the test mailbox.
- **Closing a term is final.** Close the starter term only when everyone has finished testing in it: nothing can be written to a closed term. To try closing early, make and use a separate small term.
- **Not built yet:** waiving dues, the +2 to Bachelor's handover, reactivating a student who left, and a CGPA across terms. A credit (the school owes the student) is not carried to the next term.
- **The calendar runs to Chaitra 30, 2084.** BS 2084 is provisional until the official almanac is checked (D-112); 2085 dates are refused.
- The look and the words on the public site are placeholders until the college gives its own.

## Reporting a problem

Note: the address of the page, what you did, what you expected, what happened, and a screenshot. Say which role you were signed in as.
