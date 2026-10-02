const { open, shot, finish, secrets, BASE } = require("./lib.cjs");

const BIOLOGY = ["Kritika Jha", "Puja Yadav", "Sita Chaudhary", "Pooja Sharma", "Suman Rai"];

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

  await step("classwork", async () => {
    await p.goto(BASE + "/portal/classwork", { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "11-01-classwork", "Classwork: today's activity log for each class, with how many subjects have written theirs");
    await p.goto(BASE + `/portal/classwork/class?id=${ids.g11a}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "11-02-classwork-g11a", "Grade 11 A today: Physics and English written by their teachers; the other subjects have nothing yet");
  });

  await step("electives", async () => {
    await p.goto(BASE + "/portal/results/electives", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "11-03-electives-choose", "Electives: choose a class");
    for (const cls of ["+2 Science · Grade 11 · A", "+2 Science · Grade 11 · B"]) {
      await p.getByLabel("Class", { exact: true }).selectOption({ label: cls });
      await p.waitForTimeout(1200);
      if (cls.endsWith("A")) await shot(p, "11-04-electives-not-chosen", "Grade 11 A: every student's Science option is Not chosen yet");
      const cards = p.locator("main").locator("xpath=.//select[not(@id=//label[normalize-space()='Class']/@for)]/ancestor::*[.//h2 or .//h3][1]");
      const names = await p.evaluate(() => [...document.querySelectorAll("main select")].slice(1).map((sel) => sel.closest("li, article, section, div:has(> h2), div:has(> h3)")?.querySelector("h2, h3")?.innerText ?? ""));
      const selects = p.locator("main select");
      const count = await selects.count();
      for (let i = 1; i < count; i++) {
        const name = names[i - 1];
        const options = await selects.nth(i).locator("option").allInnerTexts();
        const pick = options.find((o) => (BIOLOGY.includes(name) ? /Biology/ : /Computer/).test(o));
        await selects.nth(i).selectOption({ label: pick });
        await p.waitForTimeout(700);
      }
      if (cls.endsWith("A")) await shot(p, "11-05-electives-chosen", "Grade 11 A: each student's Science option chosen, saved as it is picked (Biology or Computer Science)");
    }
  });

  await finish(s);
})();
