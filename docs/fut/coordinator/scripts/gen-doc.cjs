// Builds docs/fut/coordinator/README.md from the run's manifest, the findings and the server checks.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SP = __dirname;
const REPO = path.resolve(__dirname, "../../../..");
const OUT = path.join(REPO, "docs/fut/coordinator");
const manifest = JSON.parse(fs.readFileSync(`${SP}/manifest.json`, "utf8"));
const denied = JSON.parse(fs.readFileSync(`${SP}/denied.json`, "utf8"));
const scope = JSON.parse(fs.readFileSync(`${SP}/scope.json`, "utf8"));
const findings = fs
  .readFileSync(`${SP}/findings.md`, "utf8")
  .trim()
  .split("\n")
  .map((l) => {
    const [id, severity, where, what, shots] = l.split(" | ");
    return { id, severity, where, what, shots };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
const commit = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]).toString().trim();

const findingFor = {};
for (const f of findings)
  for (const ref of (f.shots ?? "").split(/,\s*/)) {
    const m = /^(\d\d-\d\d[a-z]?)(?: to (\d\d-\d\d))?/.exec(ref.trim());
    if (!m) continue;
    const ids = manifest.map((e) => e.id).filter((id) => (m[2] ? id.slice(0, 5) >= m[1] && id.slice(0, 5) <= m[2] : id.startsWith(m[1])));
    for (const id of ids) (findingFor[id] ??= []).push(f.id);
  }

const SECTIONS = [
  ["01", "First sign-in", "The Principal made Sita Sharma a Co-ordinator for the whole school. She signs in with the temporary password and must choose her own.", ""],
  ["02", "Setup: the year, terminals and subjects", "The academic year with its dates, its three terminals, and the school's list of subjects.", ""],
  ["03", "Setup: curriculum", "What each level studies: subjects, credit hours, how each is marked, and an elective group.", ""],
  ["04", "Setup: classes", "The year's classes, a duplicate, switching off and deleting.", ""],
  ["05", "People: teachers", "The Co-ordinator adds the teachers (only teachers), switches one off and on, and gives a new temporary password.", ""],
  ["06", "People: teaching assignments", "A teacher for every subject of every class, and each class's Class Teacher.", ""],
  ["07", "Admissions: walk-ins", "Students the Co-ordinator registers herself are admitted at once.", ""],
  ["08", "Admissions: the queue", "Applications from the public website (confirmed by email) and from the Accountant: approve into a class, ask for changes, reject.", "**Precondition (P1):** three applicants applied on the public website and confirmed their email; the Accountant registered one student."],
  ["09", "Admissions: search", "Finding a student by name, student ID or phone.", ""],
  ["10", "Attendance", "Reading the students' registers, and marking teacher attendance for today and a past day.", "**Precondition (P2):** each teacher signed in for the first time; the Class Teachers marked today's registers (Grade 12 left unmarked); three teachers wrote today's activity log."],
  ["11", "Classwork and electives", "Reading the activity log, and recording each student's elective (Science option).", ""],
  ["12", "Results: review, send back, verify and publish", "The first terminal from the teachers' marks to published results, a class sheet and Top 20.", "**Precondition (P3):** the subject teachers entered the first terminal's marks; Nepali was left as a draft. Between the two halves (P3b), Anita Mandal corrected the English mark that was sent back and Kamala Rai sent Nepali."],
  ["13", "Results: rechecks", "Two students ask for a recheck; one is unchanged, one changes a mark.", "**Precondition (P4):** Kritika Jha and Rohan Sah, signed in as themselves, asked for rechecks."],
  ["14", "Website: drafts for the Principal", "The Co-ordinator drafts website content and sends it to the Principal, who approves or declines it.", "**Precondition (P5):** between the two halves, the Principal approved the notice and declined the Science exhibition with a reason."],
  ["15", "Own account, and what a Co-ordinator must not do", "Profile, password and sign-out; other roles' pages opened by address; the server's answer to forbidden actions.", ""],
  ["16", "A Co-ordinator for one section only", "Hari Prasad Yadav's access reaches Bachelor's only. What he sees, and what the server answers when he reaches for +2.", ""],
  ["17", "Phone, large text and the end of the run", "The main screens at 375 px and at 320 px with text at 200%, and the dashboard at the end.", ""],
];

const lines = [];
const w = (s = "") => lines.push(s);
const passCount = manifest.filter((e) => !findingFor[e.id]).length;
const esc = (t) => String(t).replace(/\|/g, "\\|");

w("# Co-ordinator functional user test (FUT)");
w();
w(`Royal Softech College on the school platform. Every operation a Co-ordinator can do, end to end through the real screens, with a screenshot of each step. Run on 3 October 2026 (17 Ashwin 2083) against commit \`${commit}\` on a fresh local school. The Principal's FUT is in [\`../admin/\`](../admin/README.md).`);
w();
w("## Summary");
w();
w(`- **${manifest.length} steps** with a screenshot each, in ${SECTIONS.length} areas, plus **${denied.length + scope.length} server checks** (things she must not do, and what a one-section Co-ordinator can reach).`);
w(`- **${passCount} steps behaved as expected**; ${manifest.length - passCount} steps carry one of the findings below.`);
w(`- **${findings.length} findings**: ${["Medium", "Low", "Cosmetic"].map((sev) => `${findings.filter((f) => f.severity.startsWith(sev)).length} ${sev.toLowerCase()}`).join(", ")}. None blocks the Co-ordinator's work. The most important: a walk-in admitted twice gets two student IDs (F-03), the queue prints sections' internal keys (F-05), no screen opens or corrects a student's record (F-06), and Publish on her website form leads nowhere (F-08).`);
w("- **Every forbidden action was refused by the server**, and the Bachelor's-only Co-ordinator could reach nothing of +2. Permission is never left to the screens alone.");
w();
w("## How the test was run");
w();
w("- **School:** a fresh local copy (`wrangler dev`, local D1), the Royal Softech pack provisioned. The Principal had made the sections (+2, Bachelor's), the programmes with their levels and grading (+2 Science and +2 Management: NEB GPA; BBS: percentage and division), and three staff: Co-ordinator Sita Sharma (whole school, the person under test), Co-ordinator Hari Prasad Yadav (Bachelor's only) and Accountant Gita Thapa (precondition P0).");
w("- **The Co-ordinator:** every step was done in a real browser (Chromium through Playwright) on the real screens, signed in as Sita Sharma.");
w("- **Everyone else:** work only another person can do (applicants, the Accountant, teachers, students, the Principal) was done through the same API their screens use, signed in as those people, each with their own first-sign-in password change. These are listed as preconditions P0 to P5 where they happen; they are not part of the Co-ordinator's test.");
w("- **Observed:** the messages on screen at each step (notices, errors) were recorded as they appeared and are quoted under each screenshot.");
w("- **Screens:** 1440 px wide unless noted. Times are Nepal time. All names, emails, phone numbers and passwords are made up.");
w("- **Re-running:** the scripts are in [`scripts/`](scripts/); `run-all.sh` runs every area and precondition in order on a fresh school.");
w();
w("### Test data");
w();
w("| What | Made by | Detail |");
w("|---|---|---|");
w("| Year, terminals | Co-ordinator (02) | 2083, 1 Baisakh to 30 Chaitra; First terminal, Second terminal, Final |");
w("| Subjects | Co-ordinator (02) | English, Nepali, Physics, Chemistry, Mathematics, Biology, Computer Science, Business English, Financial Accounting, Micro Economics, Moral Education |");
w("| Curriculum | Co-ordinator (03) | +2 Science Grade 11: five subjects for all and a Science option (Biology or Computer Science, pick 1), theory and practical marks; Grade 12: five subjects; BBS Year 1: three subjects |");
w("| Classes | Co-ordinator (04) | +2 Science Grade 11 A and B, Grade 12 A, BBS Year 1 (a +2 Management class made and deleted) |");
w("| Teachers | Co-ordinator (05, 06) | Bikash Chaudhary, Anita Mandal, Suresh Karki, Kamala Rai (+2); Puja Singh, Rajan Sah (Bachelor's); Class Teachers Bikash (11 A), Kamala (11 B), Anita (12 A), Puja (BBS 1) |");
w("| Students | Co-ordinator (07, 08) | 15 walk-ins (one person admitted twice, F-03: 2083-00001 and 00002) and two approved from the queue (Pooja Sharma, Ritu Gupta): 2083-00001 to 2083-00017 |");
w("| Applications | Public, Accountant (P1) | Pooja Sharma (approved), Rajesh Yadav (changes asked), Sunil Thapa (rejected), Sita Choudhary (possible duplicate, rejected), Ritu Gupta from the Accountant (approved) |");
w("| Results | Teachers (P3), Co-ordinator (12) | Grade 11 A and BBS Year 1 first terminal published; two rechecks |");
w();

for (const [prefix, title, intro, pre] of SECTIONS) {
  const steps = manifest.filter((e) => e.id.startsWith(`${prefix}-`));
  if (!steps.length) continue;
  w(`## ${Number(prefix)}. ${title}`);
  w();
  w(intro);
  w();
  if (pre) w(`${pre}\n`);
  w("| # | Step | Observed on screen | Result |");
  w("|---|---|---|---|");
  for (const e of steps) {
    const f = findingFor[e.id];
    const obs = (e.observed ?? []).map((o) => o.replace(/[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}/g, "(password)").replace(/ Copy I have noted it$/, "")).join(" / ");
    w(`| [${e.id.slice(0, e.id.indexOf("-", 3))}](#${e.id}) | ${esc(e.title)} | ${obs ? esc(obs.length > 160 ? obs.slice(0, 157) + "…" : obs) : "–"} | ${f ? `See ${f.join(", ")}` : "Pass"} |`);
  }
  w();
  for (const e of steps) {
    w(`<a id="${e.id}"></a>`);
    w(`**${e.id.slice(0, e.id.indexOf("-", 3))}** ${e.title}`);
    w();
    w(`![${e.title.replace(/[[\]]/g, "")}](screens/${e.file})`);
    w();
  }
  if (prefix === "15") {
    w("### The server's answers");
    w();
    w("Each request was sent with Sita Sharma's own signed-in browser cookies, as a screen would send it.");
    w();
    w("| What the Co-ordinator tried | Request | Answer |");
    w("|---|---|---|");
    for (const r of denied) w(`| ${esc(r.what)} | \`${r.method} ${r.path}\` | ${r.status} ${r.status === 403 ? "forbidden" : "(unexpected)"} |`);
    w();
  }
  if (prefix === "16") {
    w("### What Hari can reach, checked at the server");
    w();
    w("| What Hari tried | Request | Answer |");
    w("|---|---|---|");
    for (const r of scope) w(`| ${esc(r.what)} | \`${r.method} ${r.path}\` | ${r.status}${r.what.startsWith("Search") ? `: ${esc(r.body)}` : r.status === 404 ? " not found (outside his section)" : r.status === 200 ? " (his section)" : ""} |`);
    w();
  }
}

w("## Findings");
w();
w("Severity: **Medium** gives wrong or missing information on a real task, or leaves out something the role should be able to do; **Low** is confusing but has a way round; **Cosmetic** is appearance only. Nothing was fixed in this round: none blocked the test.");
w();
w("| ID | Severity | Where | What happens | Steps |");
w("|---|---|---|---|---|");
for (const f of findings) w(`| ${f.id} | ${f.severity} | ${f.where} | ${esc(f.what)} | ${f.shots} |`);
w();
w("## What the Co-ordinator can do, and where it was tested");
w();
w("Every action the Co-ordinator holds in the permission matrix (`apps/api/src/core/permissions/matrix.ts`):");
w();
w("| Permission | What | Tested in |");
w("|---|---|---|");
for (const [id, what, where] of [
  ["auth.sign_in", "Sign in, change own password", "01, 15"],
  ["account.profile.edit", "Correct own name and phone", "15-02"],
  ["accounts.teacher.create", "Create a teacher", "05-02 to 05-07"],
  ["accounts.deactivate (teachers)", "Switch a teacher off and on", "05-08, 05-09"],
  ["accounts.password.issue (teachers)", "A new temporary password", "05-10"],
  ["accounts.staff.view (teachers)", "The staff list", "05, 16-05"],
  ["content.draft / approvals.request / approvals.view.own", "Draft website content, send it for approval, see her requests, withdraw", "14"],
  ["setup.structure.manage / view", "Years, terminals, classes", "02, 04"],
  ["setup.subjects.manage / view", "Subjects, curriculum, mark components, elective groups", "02-12 to 02-14, 03"],
  ["setup.assignments.manage / view", "Teacher for each subject, Class Teachers", "06"],
  ["admissions.walkin.register", "Register a walk-in", "07"],
  ["admissions.review", "Approve, ask for changes, reject", "08"],
  ["students.search / students.personal.view", "Find a student; view the record", "09 (the record cannot be opened, F-06)"],
  ["students.personal.correct", "Correct a student's details", "Not possible: no screen or route (F-06)"],
  ["students.status.set / students.rollover", "Left or Graduated; year rollover", "Not covered: Phase 8, not built"],
  ["attendance.student.view / attendance.teacher.mark / view", "Read registers; mark teachers, today and a past day", "10"],
  ["activity.read", "Read the activity log", "11-01, 11-02"],
  ["results.electives.set", "Each student's elective", "11-03 to 11-05"],
  ["marks.verify / results.publish / results.view / results.top20.view", "Verify, send back, publish, class sheet, Top 20", "12"],
  ["results.recheck.edit", "Decide rechecks", "13"],
  ["reports.students / reports.results", "Reports", "15-07 (no menu entry, F-10)"],
]) w(`| \`${id}\` | ${what} | ${where} |`);
w();
w("## Not covered");
w();
w("- **Marking a student Left or Graduated, and the year rollover** (Phase 8, not built).");
w("- **Uploads** (an applicant's certificate): uploads are off until R2 is enabled (D-020).");
w("- **Real email and SMS:** only the development mailbox exists.");
w("- **The teachers', students' and Accountant's own screens:** they appear here only as preconditions; each role needs its own FUT.");
w();
fs.writeFileSync(`${OUT}/README.md`, lines.join("\n"));
console.log("written", lines.length, "lines;", manifest.length, "steps;", findings.length, "findings");
