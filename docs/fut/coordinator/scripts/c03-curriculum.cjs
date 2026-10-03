const { open, shot, finish, BASE } = require("./lib.cjs");

const TP = [["Theory", "theory", 75], ["Practical", "practical", 25]];
const TH = [["Theory", "theory", 100]];
const PLAN = {
  "+2 Science · Grade 11": {
    group: ["Science option", 1],
    subjects: [["English", 4, TH], ["Nepali", 3, TH], ["Physics", 5, TP], ["Chemistry", 5, TP], ["Mathematics", 5, TH], ["Biology", 5, TP, true], ["Computer Science", 5, TP, true]],
  },
  "+2 Science · Grade 12": { subjects: [["English", 4, TH], ["Nepali", 3, TH], ["Physics", 5, TP], ["Chemistry", 5, TP], ["Mathematics", 5, TH]] },
  "BBS · Year 1": { subjects: [["Business English", 3, TH], ["Financial Accounting", 3, TH], ["Micro Economics", 3, TH]] },
};

(async () => {
  const s = await open();
  const p = s.page;
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
  const level = async (name) => {
    await p.getByLabel("Level").selectOption({ label: name });
    await p.waitForTimeout(1000);
  };
  const subjectOption = async (name) => {
    const options = await p.getByLabel("Subject", { exact: true }).locator("option").allInnerTexts();
    return options.find((o) => o === name || o.startsWith(`${name} (`));
  };
  const addSubject = async (name, credit, group) => {
    await p.getByLabel("Subject", { exact: true }).selectOption({ label: await subjectOption(name) });
    await p.getByLabel("Credit hours (optional)").fill(String(credit));
    if (group) {
      const sel = p.getByLabel("Elective group", { exact: true });
      const o = await sel.locator("option").allInnerTexts();
      await sel.selectOption({ label: o.find((x) => x.startsWith(group)) });
    }
    await p.getByRole("button", { name: /^Add a subject to this/ }).click();
    await p.locator(`button[aria-label="Add a mark component: ${name}"]`).waitFor({ state: "attached" });
  };
  const card = (name) => p.locator(`button[aria-label="Add a mark component: ${name}"]`).locator("xpath=ancestor::*[.//summary][1]");
  const addMark = async (subject, [component, kind, max]) => {
    const c = card(subject);
    const summary = c.locator("summary", { hasText: "Add a mark component" });
    if (!(await c.evaluate((e) => (e.closest("details") ?? e).open))) await summary.click();
    await c.getByLabel("Component", { exact: true }).fill(component);
    await c.getByLabel("Kind", { exact: true }).selectOption(kind);
    await c.getByLabel("Maximum marks", { exact: true }).fill(String(max));
    await c.getByRole("button", { name: `Add a mark component: ${subject}` }).click();
    await p.waitForTimeout(900);
  };

  await p.goto(BASE + "/portal/setup/curriculum", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);

  await step("empty", async () => {
    await shot(p, "03-01-curriculum-choose-level", "Curriculum: choose a level first");
    await level("+2 Science · Grade 11");
    await shot(p, "03-02-curriculum-level-empty", "+2 Science Grade 11: no elective groups and no subjects yet");
    await p.getByRole("button", { name: /^Add a subject to this/ }).click();
    await p.waitForTimeout(600);
    await shot(p, "03-03-subject-not-chosen", "Add a subject without choosing one: Choose a subject", { full: false });
  });

  await step("grade11", async () => {
    await level("+2 Science · Grade 11");
    const [gname, picks] = PLAN["+2 Science · Grade 11"].group;
    await p.getByLabel("Group name").fill(gname);
    await p.getByLabel("How many to pick").fill(String(picks));
    await p.getByRole("button", { name: "Add an elective group" }).click();
    await p.waitForTimeout(1000);
    await shot(p, "03-04-elective-group", "An elective group, Science option: each student picks 1", { full: false });
    for (const [name, credit, marks, inGroup] of PLAN["+2 Science · Grade 11"].subjects) {
      await addSubject(name, credit, inGroup ? gname : null);
      await p.waitForTimeout(600);
      if (name === "Physics") {
        // A component with no maximum, then the real ones.
        const c = card("Physics");
        if (!(await c.evaluate((e) => (e.closest("details") ?? e).open))) await c.locator("summary", { hasText: "Add a mark component" }).click();
        await c.getByLabel("Component", { exact: true }).fill("Theory");
        await c.getByLabel("Maximum marks", { exact: true }).fill("0");
        await c.getByRole("button", { name: "Add a mark component: Physics" }).click();
        await p.waitForTimeout(800);
        await shot(p, "03-05-mark-zero", "A mark component with a maximum of 0 is refused", { el: 'xpath=//button[@aria-label="Add a mark component: Physics"]/ancestor::*[.//summary][1]' });
      }
      for (const m of marks) await addMark(name, m);
    }
    await p.waitForTimeout(800);
    await shot(p, "03-06-grade11-curriculum", "Grade 11: five subjects everyone takes, Biology or Computer Science as the Science option, credit hours, and theory and practical marks");
  });

  await step("others", async () => {
    for (const lv of ["+2 Science · Grade 12", "BBS · Year 1"]) {
      await level(lv);
      for (const [name, credit, marks] of PLAN[lv].subjects) {
        await addSubject(name, credit);
        for (const m of marks) await addMark(name, m);
      }
    }
    await shot(p, "03-07-bbs-curriculum", "BBS Year 1: three subjects, each marked out of 100");
  });

  await step("switch-off", async () => {
    await level("+2 Science · Grade 11");
    await p.getByRole("button", { name: "Switch off Mathematics" }).click().catch(() => p.getByRole("button", { name: "Switch off" }).nth(4).click());
    await p.waitForTimeout(1200);
    await shot(p, "03-08-subject-switched-off", "Mathematics switched off on Grade 11: kept, marked Switched off", { full: false });
    await p.getByRole("button", { name: /Switch on/ }).first().click();
    await p.waitForTimeout(1200);
  });

  await finish(s);
})();
