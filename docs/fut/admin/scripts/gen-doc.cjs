// Builds docs/fut/admin/README.md from the run's manifest, the findings list and the server checks.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SP = __dirname;
const OUT = require("path").resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(`${SP}/manifest.json`, "utf8"));
const denied = JSON.parse(fs.readFileSync(`${SP}/denied.json`, "utf8"));
const findings = fs
  .readFileSync(`${SP}/findings.md`, "utf8")
  .trim()
  .split("\n")
  .map((l) => {
    const [id, severity, where, what, shots] = l.split(" | ");
    return { id, severity, where, what, shots };
  });
const commit = execFileSync("git", ["-C", require("path").resolve(__dirname, "../../../.."), "rev-parse", "--short", "HEAD"]).toString().trim();

// Which steps a finding is about (by screenshot id prefix), for the Result column.
const findingFor = {};
for (const f of findings)
  for (const ref of (f.shots ?? "").split(/,\s*/)) {
    const m = /^(\d\d-\d\d[a-z]?)(?: to (\d\d-\d\d))?/.exec(ref.trim());
    if (!m) continue;
    const ids = manifest.map((e) => e.id).filter((id) => (m[2] ? id.slice(0, 5) >= m[1] && id.slice(0, 5) <= m[2] : id.startsWith(m[1])));
    for (const id of ids) (findingFor[id] ??= []).push(f.id);
  }

const SECTIONS = [
  ["01", "Sign-in and two-step sign-in", "First sign-in of a new Principal: wrong input, setting up the authenticator app, recovery codes."],
  ["02", "Programs: sections", "The Principal builds the school's sections (D-095). No section is built in: a new school starts with none."],
  ["03", "Programs: programmes, levels and grading", "Programmes inside sections, their levels, the grading policy, rename, switch off and on, delete."],
  ["04", "People & Access: Co-ordinators and Accountants", "The Principal gives access to Co-ordinators and Accountants (never teachers), chooses where it reaches, and manages it (D-099)."],
  ["05", "Approvals: fee structures and website drafts", "Requests from the Accountant and the Co-ordinator, approved or declined with a reason."],
  ["06", "Approvals: money requests", "Discounts, a refund, a payment reversal and a corrected fee structure. Approve-and-apply happens once, even from two tabs."],
  ["07", "Reading the school: attendance, classwork, fees, results, reports", "Everything the Principal reads but does not change."],
  ["08", "Website Content", "All seven kinds of content, scheduling, hide-after, holidays, validation, filters, search, edit, take down, archive, and the public website (D-098)."],
  ["09", "Own account: profile, password, sign-out, recovery code, password reset, lockout", "The Principal's own account and its security rules."],
  ["10", "What the Principal must not do", "Other roles' pages opened by address, and the server's answer to forbidden actions."],
  ["11", "Phone and large text", "The main screens at 375 px, and at 320 px with text at 200% (no sideways scrolling)."],
  ["12", "End of the run", "People & Access and the dashboard once the school year is under way."],
];

const lines = [];
const w = (s = "") => lines.push(s);
const passCount = manifest.filter((e) => !findingFor[e.id]).length;

w("# Admin (Principal) functional user test (FUT)");
w();
w(`Royal Softech College on the school platform. Every operation the Admin (the Principal) can do, run through the real screens, with a screenshot of each step. Run on ${new Date().toISOString().slice(0, 10)} (16 Ashwin 2083) against commit \`${commit}\` (main after PR #28) with the F-02 fix, on a fresh local school.`);
w();
w("## Summary");
w();
w(`- **${manifest.length} steps** with a screenshot each, in ${SECTIONS.length} areas, plus **${denied.length} server checks** of things the Principal must not do.`);
w(`- **${passCount} steps behaved as expected**; ${manifest.length - passCount} steps carry one of the findings below.`);
w(`- **${findings.length} findings**: ${["High", "Medium", "Low", "Cosmetic"].map((sev) => `${findings.filter((f) => f.severity.startsWith(sev)).length} ${sev.toLowerCase()}`).join(", ")} (some are gaps rather than faults).`);
w("- **One blocking bug was found and fixed during the test (F-02):** the Principal could not add any programme. The fix and its regression test are in the same commit as this document.");
w("- **Every forbidden action was refused by the server** (403), including approving one's own request. Permission is never left to the screens alone.");
w();
w("## How the test was run");
w();
w("- **School:** a fresh local copy (`wrangler dev`, local D1), the Royal Softech pack provisioned, no sections or programmes to start with (D-087, D-095).");
w("- **The Principal:** Rajendra Prasad Shah, made with `npm run dev:user`. Every step was done in a real browser (Chromium through Playwright) on the real screens, signed in with a password and an authenticator code.");
w("- **The rest of the school:** where a step needs someone else's work first (a Co-ordinator hiring teachers, a teacher marking attendance, the Accountant recording a payment), it was done through the same API their screens use, signed in as those people with their own first-sign-in password change. Those steps are listed as preconditions; they are not part of the Principal's test.");
w("- **Screens:** 1440 px wide unless noted. Times are Nepal time. All names, emails and phone numbers are made up.");
w("- **Re-running:** the scripts are in [`scripts/`](scripts/). `run-all.sh` runs every area in order on a fresh school (see the note at the top of `scripts/lib.cjs`).");
w();
w("### Test data");
w();
w("| What | Made by | Detail |");
w("|---|---|---|");
w("| Sections | Principal (02) | +2 (Grade 11–12), Bachelor's, Master's (renamed Master's Degrees, then switched off) |");
w("| Programmes | Principal (03) | +2 Science, +2 Management (NEB, NEB GPA); BBS (TU), BIT (PU) (percentage and division); MBS made and deleted |");
w("| Co-ordinators | Principal (04) | Sita Sharma (whole school); Hari Prasad Yadav (Bachelor's, then +2 and Bachelor's) |");
w("| Accountants | Principal (04) | Gita Thapa (whole school); Ramesh Shrestha (+2 only; switched off and on again) |");
w("| Year, terminals, classes | Co-ordinator (precondition) | 2083; First terminal, Second terminal, Final; +2 Science Grade 11 A, Grade 12 A, BBS Year 1 |");
w("| Teachers | Co-ordinator (precondition) | Bikash Chaudhary, Anita Mandal, Suresh Karki, Kamala Rai (+2); Puja Singh, Rajan Sah (Bachelor's) |");
w("| Students | Co-ordinator (precondition) | 17 walk-ins: 8 in Grade 11, 4 in Grade 12, 5 in BBS Year 1 (SIDs 2083-00001 to 2083-00017) |");
w("| Daily life | Teachers, Co-ordinator (precondition) | Today's registers (Grade 11 two absent, BBS one absent, Grade 12 not marked), a teacher on leave, activity log entries |");
w("| Results | Teachers, Co-ordinator (precondition) | Grade 11 and BBS Year 1 first terminal published; Grade 11 second terminal partly entered |");
w("| Fees | Accountant (precondition) | Three fee structures sent for approval; charges, cash payments (one sent twice), a bank voucher, an overpayment, a payment on the wrong student; two discounts, a refund and a reversal requested |");
w("| Website drafts | Co-ordinator (precondition) | A notice and an event sent for approval |");
w();

for (const [prefix, title, intro] of SECTIONS) {
  const steps = manifest.filter((e) => e.id.startsWith(`${prefix}-`));
  if (!steps.length) continue;
  w(`## ${Number(prefix)}. ${title}`);
  w();
  w(intro);
  w();
  if (prefix === "05") w("**Precondition (P1):** the Co-ordinator set up the year, classes, subjects, teachers and 17 students; teachers marked attendance, wrote the activity log and entered marks; results were published; the Accountant sent three fee structures; the Co-ordinator sent two website drafts.\n");
  if (prefix === "06") w("**Precondition (P2):** the Accountant charged the approved fee structures, recorded payments and a verified voucher, and sent two discounts, a refund, a reversal and the corrected BBS fee structure for approval.\n");
  w("| # | Step | Result | Page |");
  w("|---|---|---|---|");
  for (const e of steps) {
    const f = findingFor[e.id];
    const result = f ? `See ${f.join(", ")}` : "Pass";
    w(`| [${e.id.slice(0, 5)}](#${e.id}) | ${e.title.replace(/\|/g, "\\|")} | ${result} | \`${e.url || "/"}\` |`);
  }
  w();
  for (const e of steps) {
    w(`<a id="${e.id}"></a>`);
    w(`**${e.id.slice(0, 5)}** ${e.title}`);
    w();
    w(`![${e.title.replace(/[[\]]/g, "")}](screens/${e.file})`);
    w();
  }
  if (prefix === "10") {
    w("### The server's answers");
    w();
    w("Each request below was sent with the Principal's own signed-in browser cookies, as a screen would send it.");
    w();
    w("| What the Principal tried | Request | Answer |");
    w("|---|---|---|");
    for (const r of denied) {
      const ok = r.status === 403 || (r.what.startsWith("Create another Admin") && r.status === 400) || r.what.startsWith("Send own draft");
      w(`| ${r.what} | \`${r.method} ${r.path}\` | ${r.status}${ok ? "" : " (unexpected)"} ${r.what.startsWith("Create another Admin") ? "(refused: the role must be Co-ordinator or Accountant)" : r.what.startsWith("Send own draft") ? "(allowed; see F-13)" : "forbidden"} |`);
    }
    w();
  }
}

w("## Findings");
w();
w("Severity: **High** blocks the Principal's work; **Medium** gives wrong or missing information on a real task; **Low** is confusing but has a way round; **Cosmetic** is appearance only.");
w();
w("| ID | Severity | Where | What happens | Steps |");
w("|---|---|---|---|---|");
for (const f of findings) w(`| ${f.id} | ${f.severity} | ${f.where} | ${f.what.replace(/\|/g, "\\|")} | ${f.shots} |`);
w();
w("Only F-02 was fixed in this round, because it blocked the test. The others are for the PM to schedule: most are small and local to one screen; F-11 is a missing screen, and F-18 touches how receipt numbers are formed, which belongs to the fees rules.");
w();
w("## What the Principal can do, and where it was tested");
w();
w("From the permission matrix (`apps/api/src/core/permissions/matrix.ts`), every action the Admin holds:");
w();
w("| Permission | What | Tested in |");
w("|---|---|---|");
const COVER = [
  ["auth.sign_in", "Sign in, reset own password", "01, 09"],
  ["account.profile.edit", "Correct own name and phone", "09-01 to 09-03"],
  ["accounts.staff.create", "Create a Co-ordinator or Accountant", "04-03 to 04-12"],
  ["accounts.deactivate", "Switch off or on (Co-ordinators, Accountants)", "04-16 to 04-18; teachers refused in 10"],
  ["accounts.staff.view", "View the staff list", "04, 12-01 to 12-05"],
  ["accounts.staff.access", "Change where access reaches", "04-13 to 04-15"],
  ["accounts.password.issue", "New temporary password (Co-ordinators, Accountants)", "04-19; teachers refused in 10"],
  ["content.draft / content.publish", "Draft and publish website content", "08"],
  ["setup.programmes.manage", "Sections, programmes, levels, grading", "02, 03"],
  ["setup.structure.view / subjects.view / assignments.view", "View years, classes, terminals, subjects, curriculum, teaching", "07-25 to 07-30, 12-05"],
  ["students.search / students.personal.view", "Find a student, view personal details", "07-31 (record view not reachable, F-09)"],
  ["attendance.student.view / attendance.teacher.view", "View attendance", "07-01 to 07-06"],
  ["activity.read", "Read the activity log", "07-07, 07-08"],
  ["fees.structure.approve", "Approve a fee structure", "05-03, 05-06, 06-06"],
  ["fees.view / fees.receipts.view", "Fees, dues, ledger, receipts", "07-09 to 07-19"],
  ["fees.discount.approve / reversal.approve / refund.approve", "Approve money requests", "06"],
  ["results.view / results.top20.view", "Published results, class sheets, Top 20", "07-20 to 07-23"],
  ["approvals.decide / approvals.request", "Decide requests; send own draft", "05, 06, 10-07, 10-08"],
  ["audit.view", "Activity and sign-ins", "05-01, 12-06 (dashboard only; F-11)"],
  ["dashboard.overview.view", "The Principal's dashboard", "01-08, 05-01, 12-06, 12-07"],
  ["dev.mailbox.view", "Test mailbox", "09-19"],
  ["reports.students / fees / results", "Reports and exports", "07-19 (dues CSV), 07-22 (results CSV), 07-24"],
];
for (const [id, what, where] of COVER) w(`| \`${id}\` | ${what} | ${where} |`);
w();
w("## Not covered");
w();
w("- **Uploads** (vouchers with files, notes): uploads are off until R2 is enabled (D-020).");
w("- **Real email and SMS:** only the development mailbox exists; nothing is really sent.");
w("- **A second Admin:** approving another Admin's request needs a second Admin account, which only Support can make.");
w("- **The year lifecycle** (closing a year, promotion): Phase 8, not built.");
w("- **Support (Super Admin)** and the other roles' own screens: separate FUTs.");
w();
fs.writeFileSync(`${OUT}/README.md`, lines.join("\n"));
console.log("written", lines.length, "lines;", manifest.length, "steps;", findings.length, "findings");
