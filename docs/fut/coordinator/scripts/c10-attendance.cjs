const { open, shot, finish, secrets, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const ids = secrets().classIds;
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const step = async (name, fn) => {
    if (only && !only.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png`, fullPage: true });
    }
  };
  const go = async (url) => {
    await p.goto(BASE + url, { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
  };

  await step("students", async () => {
    await go("/portal/attendance");
    await shot(p, "10-01-attendance-classes", "Student attendance: today's register for every class; Grade 12 A has not been marked");
    await go(`/portal/attendance/class?id=${ids.g11a}`);
    await shot(p, "10-02-attendance-g11a", "Grade 11 A today: two absent, marked by the Class Teacher; the Co-ordinator can look but not mark");
    await go(`/portal/attendance/class?id=${ids.g12a}`);
    await shot(p, "10-03-attendance-not-marked", "Grade 12 A: no register yet today");
  });

  await step("teachers", async () => {
    await go("/portal/attendance/teachers");
    await shot(p, "10-04-teacher-attendance-today", "Teacher attendance today: everyone starts as Present; the Co-ordinator records exceptions");
    const opts = await p.getByLabel("Suresh Karki").locator("option").allInnerTexts();
    console.log("statuses:", opts.join(" | "));
    await p.getByLabel("Suresh Karki").selectOption({ label: opts.find((o) => /leave/i.test(o)) });
    await p.getByLabel("Rajan Sah").selectOption({ label: opts.find((o) => /absent/i.test(o)) });
    await shot(p, "10-05-teacher-attendance-marked", "Suresh Karki on leave and Rajan Sah absent; the rest Present", { full: false });
    await p.getByRole("button", { name: "Save day" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "10-06-teacher-attendance-saved", "Saved for today");
  });

  await step("past-day", async () => {
    await go("/portal/attendance/teachers");
    await p.getByRole("textbox", { name: "Day", exact: true }).fill("16");
    await p.getByRole("combobox", { name: "Month" }).selectOption({ index: 6 });
    await p.getByRole("textbox", { name: "Year", exact: true }).fill("2083");
    await p.getByRole("button", { name: "Show" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "10-07-teacher-attendance-past-day", "A past day, 16 Ashwin: it can still be filled in, but a reason is needed");
    const ctl = await p.evaluate(() => [...document.querySelectorAll("main input, main select, main textarea, main button")].filter((e) => e.offsetParent).map((e) => (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute("aria-label") || e.innerText).join(" | "));
    console.log("past-day controls:", ctl);
    const opts = await p.getByLabel("Kamala Rai").locator("option").allInnerTexts();
    await p.getByLabel("Kamala Rai").selectOption({ label: opts.find((o) => /absent/i.test(o)) });
    await p.getByRole("button", { name: "Save day" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "10-08-past-day-no-reason", "Saving a past day without a reason is refused", { full: false });
    const reason = p.getByLabel(/Reason/);
    if (await reason.count()) {
      await reason.fill("The register for Friday was kept on paper; entered the next day.");
      await p.getByRole("button", { name: "Save day" }).click();
      await p.waitForTimeout(1500);
      await shot(p, "10-09-past-day-saved", "Saved with the reason, which is kept with the change", { full: false });
    }
  });

  await finish(s);
})();
