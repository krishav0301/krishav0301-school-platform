const { open, shot, finish, BASE } = require("./lib.cjs");
(async () => {
  const s = await open();
  const p = s.page;
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png` });
    }
  };
  await step("staff", async () => {
    await p.goto(BASE + "/portal/people", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await shot(p, "12-01-people-after-year", "People & Access after the year started: 6 teaching staff; the staff who signed in show when");
  });
  await step("teaching", async () => {
    await p.getByRole("tab", { name: "Teaching" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "12-02-teaching", "Teaching: every teacher with their subjects, section and programme, who added them, status and last sign-in");
    await p.getByLabel("Section", { exact: true }).selectOption({ label: "Bachelor's" });
    await p.waitForTimeout(1500);
    await shot(p, "12-03-teaching-section", "Teaching filtered to the Bachelor's section", { full: false });
    await p.getByLabel("Programme", { exact: true }).selectOption({ label: "BBS" });
    await p.waitForTimeout(1500);
    await p.getByLabel("Section", { exact: true }).selectOption({ index: 0 });
    await p.getByLabel("Programme", { exact: true }).selectOption({ index: 0 });
    await p.getByPlaceholder("Search teachers…").fill("bikash");
    await p.waitForTimeout(1500);
    await shot(p, "12-04-teaching-search", "Searching teachers: 'bikash' finds Bikash Chaudhary, with Mathematics and Physics", { full: false });
    await p.getByPlaceholder("Search teachers…").fill("");
    await p.waitForTimeout(1200);
    await p.getByRole("link", { name: /View what Bikash Chaudhary teaches|View teaching/ }).first().click();
    await p.waitForTimeout(1800);
    await shot(p, "12-05-view-teaching", "View teaching: the Teaching report, read only for the Principal");
  });
  await step("dashboard", async () => {
    await p.goto(BASE + "/portal", { waitUntil: "networkidle" });
    await p.waitForTimeout(1800);
    await shot(p, "12-06-dashboard-end", "The dashboard at the end of the test: fees collected, attendance, website updated, recent activity");
    for (const tab of ["Programs", "Fees", "Results"]) {
      await p.getByRole("tab", { name: tab, exact: true }).click();
      await p.waitForTimeout(900);
      await shot(p, `12-07-glance-${tab.toLowerCase()}`, `Institution at a glance: the ${tab} tab`, { el: 'section:has(h2:text("Institution at a glance"))' });
    }
  });
  await finish(s);
})();
