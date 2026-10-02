const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const d = () => p.locator("dialog[open]");
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const step = async (name, fn) => {
    if (only && !only.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png` });
      if (await d().count()) await d().getByRole("button", { name: "Close" }).first().click().catch(() => {});
    }
  };
  const date = async (group, day, month, year) => {
    const g = d().getByRole("group", { name: group });
    await g.getByLabel("Day").fill(String(day));
    await g.getByLabel("Month").selectOption({ index: month });
    await g.getByLabel("Year").fill(String(year));
  };
  const addYear = async (bs, first, last) => {
    await p.getByRole("button", { name: "Add a year" }).first().click();
    await d().getByLabel("Year (BS)").fill(String(bs));
    await date("First day", ...first);
    await date("Last day", ...last);
  };

  await step("years", async () => {
    await p.goto(BASE + "/portal/setup", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "02-01-years-empty", "Academic years: none yet");
    await p.getByRole("button", { name: "Add a year" }).first().click();
    await d().getByRole("button", { name: "Add a year" }).click();
    await p.waitForTimeout(700);
    await shot(p, "02-02-year-empty-form", "Add a year with nothing filled in: each field is asked for", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Close" }).click();

    await addYear(2083, [1, 1, 2083], [1, 1, 2083 - 1]);
    await d().getByRole("button", { name: "Add a year" }).click();
    await p.waitForTimeout(1000);
    await shot(p, "02-03-year-ends-before-start", "A year whose last day is before its first day is refused", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Close" }).click();

    await addYear(2090, [1, 1, 2090], [30, 12, 2090]);
    await d().getByRole("button", { name: "Add a year" }).click();
    await p.waitForTimeout(1000);
    await shot(p, "02-04-year-unverified", "BS 2090 is outside the verified calendar (2000 to 2083) and is refused", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Close" }).click();

    await addYear(2083, [1, 1, 2083], [30, 12, 2083]);
    await shot(p, "02-05-year-form", "Year 2083: from 1 Baisakh 2083 to 30 Chaitra 2083", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Add a year" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "02-06-year-added", "Year 2083 added as a draft: it is not the current year until made so");

    await addYear(2083, [1, 1, 2083], [30, 12, 2083]);
    await d().getByRole("button", { name: "Add a year" }).click();
    await p.waitForTimeout(1000);
    await shot(p, "02-07-year-duplicate", "The same year twice is refused", { full: false });
    if (await d().count()) await d().getByRole("button", { name: "Close" }).click();

    await p.getByRole("button", { name: /Make 2083 the current year|Make current/ }).first().click();
    await p.waitForTimeout(1500);
    await shot(p, "02-08-year-current", "2083 made the current year");
  });

  await step("terminals", async () => {
    await p.goto(BASE + "/portal/setup/terminals", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "02-09-terminals-empty", "Terminals of 2083: none yet");
    const add = async (name) => {
      await p.getByRole("button", { name: "Add a Terminal" }).first().click();
      await d().getByLabel("Name").fill(name);
      await d().getByRole("button", { name: "Add a Terminal" }).click();
      await p.waitForTimeout(1000);
    };
    await p.getByRole("button", { name: "Add a Terminal" }).first().click();
    await d().getByRole("button", { name: "Add a Terminal" }).click();
    await p.waitForTimeout(600);
    await shot(p, "02-10-terminal-name-required", "Add a terminal with no name: refused", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Close" }).click();
    for (const n of ["First terminal", "Second terminal", "Final"]) await add(n);
    await shot(p, "02-11-terminals", "Three terminals, numbered in order");
  });

  await step("subjects", async () => {
    await p.goto(BASE + "/portal/setup/subjects", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "02-12-subjects-empty", "Subjects: the school's list, empty");
    const add = async (name, code) => {
      await p.getByRole("button", { name: "Add a subject" }).first().click();
      await d().getByLabel("Name").fill(name);
      if (code) await d().getByLabel("Code (optional)").fill(code);
      await d().getByRole("button", { name: "Add a subject" }).click();
      await p.waitForTimeout(900);
    };
    await add("English", "ENG");
    for (const [n, c] of [["Nepali", "NEP"], ["Physics", "PHY"], ["Chemistry", "CHE"], ["Mathematics", "MTH"], ["Biology", "BIO"], ["Computer Science", "CS"], ["Business English", ""], ["Financial Accounting", "ACC"], ["Micro Economics", "ECO"], ["Moral Education", ""]]) await add(n, c);
    await shot(p, "02-13-subjects", "Eleven subjects, most with a short code");
    await p.getByRole("button", { name: "Add a subject" }).first().click();
    await d().getByLabel("Name").fill("English");
    await d().getByRole("button", { name: "Add a subject" }).click();
    await p.waitForTimeout(1000);
    await shot(p, "02-14-subject-duplicate", "A second subject called English is refused", { full: false });
    if (await d().count()) await d().getByRole("button", { name: "Close" }).click();
  });

  await finish(s);
})();
