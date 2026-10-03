const { open, shot, finish, BASE } = require("./lib.cjs");
(async () => {
  const s = await open({ width: 375, height: 812, mobile: true });
  const p = s.page;
  for (const [url, id, title] of [
    ["/portal", "17-01-phone-dashboard", "Phone (375 px): the Co-ordinator's dashboard"],
    ["/portal/more", "17-02-phone-more", "Phone: More, for the places that do not fit in the tab bar"],
    ["/portal/admissions", "17-03-phone-queue", "Phone: the admissions queue"],
    ["/portal/attendance/teachers", "17-04-phone-teacher-attendance", "Phone: teacher attendance"],
    ["/portal/results", "17-05-phone-results", "Phone: results review"],
    ["/portal/setup/curriculum", "17-06-phone-curriculum", "Phone: curriculum"],
  ]) {
    try {
      await p.goto(BASE + url, { waitUntil: "networkidle" });
      await p.waitForTimeout(1300);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await shot(p, id, title + (over > 1 ? ` (FINDING: scrolls sideways by ${over} px)` : ""), { full: false });
      console.log(url, "overflow", over);
    } catch (e) { console.error("FAILED", url, e.message.split("\n")[0]); }
  }
  await finish(s);
  const t = await open({ width: 320, height: 700 });
  for (const [url, id, title] of [["/portal", "17-07-320-dashboard", "320 px, text at 200%: the dashboard"], ["/portal/admissions", "17-08-320-queue", "320 px, text at 200%: the admissions queue"], ["/portal/people/teaching", "17-09-320-teaching", "320 px, text at 200%: Teaching"]]) {
    await t.page.goto(BASE + url, { waitUntil: "networkidle" });
    await t.page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await t.page.waitForTimeout(1200);
    const over = await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await shot(t.page, id, title + (over > 1 ? ` (FINDING: scrolls sideways by ${over} px)` : ""), { full: false });
    console.log(url, "320/200% overflow", over);
  }
  await finish(t);
  const f = await open();
  await f.page.goto(BASE + "/portal", { waitUntil: "networkidle" });
  await f.page.waitForTimeout(1500);
  await shot(f.page, "17-10-dashboard-end", "The Co-ordinator's dashboard at the end: registers marked, teacher attendance saved, activity logs, and the setup checklist complete");
  await finish(f);
})();
