const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const card = (text) => p.locator("h2", { hasText: text }).locator('xpath=ancestor::*[.//button[starts-with(normalize-space(), "Approve")]][1]');
  try {
    await p.goto(BASE + "/portal", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await shot(p, "05-01-dashboard-with-requests", "The dashboard once the school is running: counts, attendance, and five requests needing the Principal");

    await p.goto(BASE + "/portal/approvals", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Sent by Gita Thapa");
    await shot(p, "05-02-approvals-inbox", "Approvals inbox: three fee structures from the Accountant and two website drafts from the Co-ordinator");

    if (!process.env.RESUME) {
    await card("+2 Science Grade 11").getByRole("button", { name: /^Approve/ }).click();
    await p.waitForTimeout(1500);
    }
    await shot(p, "05-03-fee-structure-approved", "Grade 11 fee structure approved: it leaves the inbox and becomes the live structure");

    // Decline without a reason, then with one.
    const bbs = card("BBS Year 1");
    await bbs.getByText("Decline", { exact: true }).click();
    await p.waitForTimeout(400);
    await shot(p, "05-04-decline-opened", "Decline opens a box for the reason; the Decline button stays disabled until a reason is written", { full: false });
    await bbs.locator("textarea").fill("Tuition looks too high compared with last year. Please check with the university fee schedule and send again.");
    await bbs.getByRole("button", { name: /Decline/ }).last().click();
    await p.waitForTimeout(1500);
    await shot(p, "05-05-fee-structure-declined", "BBS Year 1 fee structure declined with a reason; it goes back to the Accountant");

    await card("+2 Science Grade 12").getByRole("button", { name: /^Approve/ }).click();
    await p.waitForTimeout(1500);
    await card("Grade 11 first terminal results").getByRole("button", { name: /^Approve/ }).click();
    await p.waitForTimeout(1500);
    await shot(p, "05-06-notice-approved", "Grade 12 fees and the Co-ordinator's notice approved; the notice is published on the website at once");
    const quiz = card("Inter-college quiz");
    await quiz.getByText("Decline", { exact: true }).click();
    await quiz.locator("textarea").fill("Please add the date, time and venue before this goes on the website.");
    await quiz.getByRole("button", { name: /Decline/ }).last().click();
    await p.waitForTimeout(1500);
    await shot(p, "05-07-inbox-empty", "Every request decided: the inbox is empty and the menu badge is gone");
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png" });
  }
  await finish(s);
})();
