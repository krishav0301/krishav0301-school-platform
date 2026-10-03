// The Audit trail and Sign-ins (CLAUDE.md section 6, D-102, admin FUT F-11), reached from Reports.
const { open, shot, finish, BASE } = require("./lib.cjs");
(async () => {
  const s = await open();
  const p = s.page;
  try {
    await p.goto(BASE + "/portal/reports", { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "07-34-reports-oversight", "Reports now has Oversight: the Audit trail and Sign-ins (F-11 fixed)");
    await p.goto(BASE + "/portal/reports/activity", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await shot(p, "07-35-audit-trail", "The audit trail: every change, newest first, who made it and when in the Nepali calendar; nobody can change an entry");
    await p.getByLabel("Area").selectOption("fees");
    await p.waitForTimeout(1500);
    await shot(p, "07-36-audit-trail-fees", "Only the fee entries: charges, payments, discounts, refunds and reversals", { full: false });
    await p.goto(BASE + "/portal/reports/sign-ins", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await shot(p, "07-37-sign-ins", "Sign-ins: every attempt, failed ones included, with the reason in plain words", { full: false });
    await p.getByLabel("Show").selectOption("failed");
    await p.waitForTimeout(1500);
    await shot(p, "07-38-sign-ins-failed", "Failed attempts only: wrong passwords and wrong authenticator codes", { full: false });
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png" });
  }
  await finish(s);
})();
