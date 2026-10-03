const { open, shot, finish, BASE } = require("./lib.cjs");
const { panel, review, approve, decline, finishPanel } = require("./approvals-ui.cjs");
(async () => {
  const s = await open();
  const p = s.page;
  try {
    await p.goto(BASE + "/portal/approvals", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Sent by Gita Thapa");
    await shot(p, "06-01-money-requests", "The Accountant's requests: two discounts, a refund, a payment reversal and the corrected BBS fee structure");

    await review(p, /^Review Discount: Sita Chaudhary/);
    await shot(p, "06-01a-discount-review", "A discount shows the student, class, percentage and amount, the reason and the Accountant's note (F-06 fixed)", { full: false });
    await approve(p);
    await shot(p, "06-02-discount-approved", "Sita Chaudhary's discount approved: it is added to her fee account in the same step", { full: false });
    await finishPanel(p);

    await review(p, /^Review Discount: Rohan Sah/);
    await decline(p, "Half fees needs a scholarship decision by the committee. Please bring the family's application to the next meeting.", {
      filledShot: () => shot(p, "06-03-discount-decline-reason", "Declining Rohan Sah's 50% discount, with the reason the Accountant will see", { full: false }),
    });
    await finishPanel(p);

    // The same refund open in a second tab: approved here, then tried again there.
    const second = await s.context.newPage();
    await second.goto(BASE + "/portal/approvals", { waitUntil: "networkidle" });
    await second.waitForSelector("text=Sent by Gita Thapa");
    await review(second, /^Review Refund/);
    await review(p, /^Review Refund/);
    await shot(p, "06-04a-refund-review", "A refund shows the student's credit and the amount; how it is paid back is left to the Accountant", { full: false });
    await approve(p);
    await shot(p, "06-04-refund-approved", "Puja Yadav's refund approved; the Accountant can now record how it was paid", { full: false });
    await finishPanel(p);
    await approve(second);
    await shot(second, "06-05-refund-already-decided", "The same refund approved again from a second, older tab: \"Already decided\", nothing applied twice (F-07 fixed)", { full: false });
    await second.close();

    await review(p, /^Review Payment reversal/);
    await shot(p, "06-05a-reversal-review", "A reversal shows the original payment, its day and receipt; the payment itself is never edited", { full: false });
    await approve(p);
    await finishPanel(p);
    await review(p, /^Review Fee structure: BBS/);
    await approve(p);
    await finishPanel(p);
    await shot(p, "06-06-all-decided", "The reversal and the corrected BBS structure approved; nothing is waiting");
    void panel;
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png" });
  }
  await finish(s);
})();
