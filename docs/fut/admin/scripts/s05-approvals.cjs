const { open, shot, finish, BASE } = require("./lib.cjs");
const { review, approve, decline, finishPanel } = require("./approvals-ui.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  try {
    await p.goto(BASE + "/portal", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await shot(p, "05-01-dashboard-with-requests", "The dashboard once the school is running: counts, attendance, and five requests needing the Principal");

    await p.goto(BASE + "/portal/approvals", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Sent by Gita Thapa");
    await shot(p, "05-02-approvals-inbox", "Approvals inbox (D-102): three fee structures from the Accountant and two website drafts from the Co-ordinator, each with Review");

    await review(p, /^Review Fee structure: \+2 Science · Grade 11/);
    await shot(p, "05-03-fee-structure-review", "Reviewing the Grade 11 fee structure: every item, the yearly total, who sent it and when", { full: false });
    await approve(p, { confirmShot: () => shot(p, "05-03a-approve-confirm", "Approve request asks once more, naming the structure and its yearly total", { full: false }) });
    await shot(p, "05-03b-fee-structure-approved", "Approved: the Grade 11 fee structure is now effective", { full: false });
    await finishPanel(p);

    await review(p, /^Review Fee structure: BBS/);
    await decline(p, "Tuition looks too high compared with last year. Please check with the university fee schedule and send again.", {
      emptyShot: () => shot(p, "05-04-decline-empty", "Decline asks why; an empty reason is refused", { full: false }),
    });
    await shot(p, "05-05-fee-structure-declined", "BBS Year 1 fee structure declined with a reason; it goes back to the Accountant", { full: false });
    await finishPanel(p);

    await review(p, /^Review Fee structure: \+2 Science · Grade 12/);
    await approve(p);
    await finishPanel(p);
    await review(p, /^Review Website content: Notice/);
    await shot(p, "05-06-notice-review", "Reviewing the Co-ordinator's notice: a preview of what will be published", { full: false });
    await approve(p);
    await finishPanel(p);
    await review(p, /^Review Website content: Event/);
    await decline(p, "Please add the date, time and venue before this goes on the website.");
    await finishPanel(p);
    await shot(p, "05-07-inbox-empty", "Every request decided: nothing is waiting, and the menu count is gone at once (F-03 fixed)");
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png" });
  }
  await finish(s);
})();
