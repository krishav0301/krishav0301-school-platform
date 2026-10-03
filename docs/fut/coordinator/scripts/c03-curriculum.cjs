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
    await p.getByLabel("Level", { exact: true }).selectOption({ label: name });
    await p.waitForTimeout(1000);
  };
  const dialog = () => p.locator("dialog[open]");
  const subjectOption = async (name) => {
    const options = await dialog().getByLabel("Subject", { exact: true }).locator("option").allInnerTexts();
    return options.find((o) => o === name || o.startsWith(`${name} (`));
  };
  // Add a subject: the header's button opens the form in a pop-up (D-106).
  const addSubject = async (name, credit, group) => {
    await p.getByRole("button", { name: /^Add a subject to this/ }).first().click();
    await dialog().getByLabel("Subject", { exact: true }).selectOption({ label: await subjectOption(name) });
    await dialog().getByLabel("Credit hours (optional)").fill(String(credit));
    if (group) {
      const sel = dialog().getByLabel("Elective group", { exact: true });
      const o = await sel.locator("option").allInnerTexts();
      await sel.selectOption({ label: o.find((x) => x.startsWith(group)) });
    }
    await dialog().getByRole("button", { name: /^Add a subject to this/ }).click();
    await p.getByRole("button", { name: `Edit ${name}`, exact: true }).waitFor();
  };
  // A subject's marks are set in its side panel, opened with Edit (D-106).
  const openSubject = async (name) => {
    await p.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
    await dialog().getByRole("heading", { name, exact: true }).waitFor();
  };
  const closePanel = async () => {
    await dialog().getByRole("button", { name: "Close", exact: true }).click();
    await p.waitForTimeout(300);
  };
  const addMark = async (subject, [component, kind, max]) => {
    const d = dialog();
    await d.getByLabel("Component", { exact: true }).fill(component);
    await d.getByLabel("Kind", { exact: true }).selectOption(kind);
    await d.getByLabel("Maximum marks", { exact: true }).fill(String(max));
    await d.getByRole("button", { name: `Add a mark component: ${subject}` }).click();
    await p.waitForTimeout(900);
  };

  await p.goto(BASE + "/portal/setup/curriculum", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);

  await step("empty", async () => {
    await shot(p, "03-01-curriculum-first-level", "Curriculum: the first level, +2 Science Grade 11, opens straight away");
    await level("+2 Science · Grade 11");
    await shot(p, "03-02-curriculum-level-empty", "+2 Science Grade 11: no elective groups and no subjects yet");
    await p.getByRole("button", { name: /^Add a subject to this/ }).first().click();
    await dialog().getByRole("button", { name: /^Add a subject to this/ }).click();
    await p.waitForTimeout(600);
    await shot(p, "03-03-subject-not-chosen", "Add a subject without choosing one: Choose a subject", { full: false });
    await dialog().getByRole("button", { name: "Close", exact: true }).click();
  });

  await step("grade11", async () => {
    await level("+2 Science · Grade 11");
    const [gname, picks] = PLAN["+2 Science · Grade 11"].group;
    await p.getByRole("button", { name: "Add an elective group" }).click();
    await dialog().getByLabel("Group name").fill(gname);
    await dialog().getByLabel("How many to pick").fill(String(picks));
    await dialog().getByRole("button", { name: "Add an elective group" }).click();
    await p.waitForTimeout(1000);
    await shot(p, "03-04-elective-group", "An elective group, Science option: each student picks 1", { full: false });
    for (const [name, credit, marks, inGroup] of PLAN["+2 Science · Grade 11"].subjects) {
      await addSubject(name, credit, inGroup ? gname : null);
      await p.waitForTimeout(600);
      await openSubject(name);
      if (name === "Physics") {
        // A component with no maximum, then the real ones.
        await addMark("Physics", ["Theory", "theory", 0]);
        await shot(p, "03-05-mark-zero", "In Physics's panel, a mark component with a maximum of 0 is refused", { full: false });
      }
      for (const m of marks) await addMark(name, m);
      if (name === "Biology") await shot(p, "03-05b-subject-panel", "Biology's panel: its code and credit hours, its elective group, theory and practical marks, and Switch off", { full: false });
      await closePanel();
    }
    await p.waitForTimeout(800);
    await shot(p, "03-06-grade11-curriculum", "Grade 11: five subjects everyone takes, Biology or Computer Science as the Science option, credit hours, and theory and practical marks");
  });

  await step("others", async () => {
    for (const lv of ["+2 Science · Grade 12", "BBS · Year 1"]) {
      await level(lv);
      for (const [name, credit, marks] of PLAN[lv].subjects) {
        await addSubject(name, credit);
        await openSubject(name);
        for (const m of marks) await addMark(name, m);
        await closePanel();
      }
    }
    await shot(p, "03-07-bbs-curriculum", "BBS Year 1: three subjects, each marked out of 100");
  });

  await step("switch-off", async () => {
    await level("+2 Science · Grade 11");
    await openSubject("Mathematics");
    await dialog().getByRole("button", { name: "Switch off Mathematics" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "03-08-subject-switched-off", "Mathematics switched off on Grade 11: kept, and its panel and row say Switched off", { full: false });
    await dialog().getByRole("button", { name: "Switch on Mathematics" }).click();
    await p.waitForTimeout(1200);
    await closePanel();
  });

  await finish(s);
})();
