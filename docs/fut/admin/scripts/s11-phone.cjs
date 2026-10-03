const { open, shot, finish, secrets, BASE } = require("./lib.cjs");
(async () => {
  const s = await open({ width: 375, height: 812, mobile: true });
  const p = s.page;
  const pages = [
    ["/portal", "11-01-phone-dashboard", "Phone (375 px): the dashboard"],
    ["/portal/more", "11-02-phone-more", "Phone: the More tab lists the places that do not fit in the tab bar"],
    ["/portal/people", "11-03-phone-people", "Phone: People & Access"],
    ["/portal/content", "11-04-phone-website", "Phone: Website Content"],
    ["/portal/approvals", "11-05-phone-approvals", "Phone: Approvals"],
    ["/portal/setup/programmes", "11-06-phone-programs", "Phone: Programs"],
    ["/portal/fees/dues", "11-07-phone-dues", "Phone: Dues"],
    ["/portal/results/sheets", "11-08-phone-sheets", "Phone: Class sheets"],
  ];
  for (const [url, id, title] of pages) {
    try {
      await p.goto(BASE + url, { waitUntil: "networkidle" });
      await p.waitForTimeout(1500);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await shot(p, id, title + (overflow > 1 ? ` (FINDING: the page scrolls sideways by ${overflow} px)` : ""), { full: false });
      console.log(url, "sideways overflow:", overflow);
    } catch (e) { console.error("FAILED", url, e.message.split("\n")[0]); }
  }
  await finish(s);
  // 320 px with text at 200%.
  const t = await open({ width: 320, height: 700 });
  for (const [url, id, title] of [["/portal", "11-09-320-dashboard", "320 px wide, text at 200%: the dashboard"], ["/portal/people", "11-10-320-people", "320 px wide, text at 200%: People & Access"], ["/portal/content", "11-11-320-website", "320 px wide, text at 200%: Website Content"]]) {
    await t.page.goto(BASE + url, { waitUntil: "networkidle" });
    await t.page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await t.page.waitForTimeout(1200);
    const overflow = await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await shot(t.page, id, title + (overflow > 1 ? ` (FINDING: the page scrolls sideways by ${overflow} px)` : ""), { full: false });
    console.log(url, "320/200% overflow:", overflow);
  }
  await finish(t);
  // The sign-in page, signed out, at 320 px with text at 200% (F-16).
  const u = await open({ width: 320, height: 700, fresh: true });
  await u.page.goto(BASE + "/sign-in", { waitUntil: "networkidle" });
  await u.page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await u.page.waitForTimeout(1200);
  const signInOverflow = await u.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(u.page, "11-12-320-sign-in", "320 px wide, text at 200%: the sign-in page" + (signInOverflow > 1 ? ` (FINDING: the page scrolls sideways by ${signInOverflow} px)` : ", no sideways scroll (F-16 fixed)"), { full: false });
  console.log("/sign-in 320/200% overflow:", signInOverflow);
  await finish(u, false);
})();
