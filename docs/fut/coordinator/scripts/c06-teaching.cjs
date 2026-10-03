const { open, shot, finish, BASE } = require("./lib.cjs");

const G11 = { English: "Anita Mandal", Nepali: "Kamala Rai", Physics: "Bikash Chaudhary", Chemistry: "Suresh Karki", Mathematics: "Bikash Chaudhary", Biology: "Suresh Karki", "Computer Science": "Anita Mandal" };
const PLAN = [
  ["+2 Science · Grade 11 (A)", "Bikash Chaudhary", G11],
  ["+2 Science · Grade 11 (B)", "Kamala Rai", G11],
  ["+2 Science · Grade 12 (A)", "Anita Mandal", { English: "Anita Mandal", Nepali: "Kamala Rai", Physics: "Bikash Chaudhary", Chemistry: "Suresh Karki", Mathematics: "Bikash Chaudhary" }],
  ["BBS · Year 1", "Puja Singh", { "Business English": "Rajan Sah", "Financial Accounting": "Puja Singh", "Micro Economics": "Rajan Sah" }],
];

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
  const pickClass = async (name) => {
    await p.getByLabel("Class", { exact: true }).selectOption({ label: name });
    await p.waitForTimeout(1200);
  };
  const set = async (label, teacher) => {
    await p.getByLabel(label, { exact: true }).selectOption({ label: teacher });
    await p.waitForTimeout(900);
  };

  await step("assign", async () => {
    await p.goto(BASE + "/portal/people/teaching", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "06-01-teaching-first-class", "Teaching: the current year and its first class open straight away");
    await pickClass(PLAN[0][0]);
    await shot(p, "06-02-teaching-empty-class", "Grade 11 A: a Class Teacher and one teacher per subject, none chosen yet");
    for (const [cls, ct, subjects] of PLAN) {
      await pickClass(cls);
      await set("Class Teacher of this class", ct);
      for (const [subject, teacher] of Object.entries(subjects)) await set(`Teacher for ${subject}`, teacher);
      if (cls === PLAN[0][0]) await shot(p, "06-03-teaching-grade11a", "Grade 11 A: Bikash Chaudhary is Class Teacher; each subject has its teacher, saved as it is chosen");
    }
    await shot(p, "06-04-teaching-bbs", "BBS Year 1: Puja Singh is Class Teacher; Rajan Sah takes two subjects");
  });

  await step("rules", async () => {
    await p.goto(BASE + "/portal/people/teaching", { waitUntil: "networkidle" });
    await pickClass("+2 Science · Grade 11 (B)");
    await set("Class Teacher of this class", "Bikash Chaudhary");
    await p.waitForTimeout(600);
    await shot(p, "06-05-class-teacher-twice", "Bikash Chaudhary as Class Teacher of a second class in the same year is refused: one class each", { full: false });
    await p.goto(BASE + "/portal/people/teaching", { waitUntil: "networkidle" });
    await pickClass("+2 Science · Grade 11 (B)");
    await set("Teacher for Mathematics", "Anita Mandal");
    await shot(p, "06-06-teacher-replaced", "Grade 11 B Mathematics given to Anita Mandal instead of Bikash Chaudhary", { full: false });
    await set("Teacher for Biology", "— None —");
    await shot(p, "06-07-teacher-cleared", "Grade 11 B Biology left without a teacher for now", { full: false });
    await set("Teacher for Biology", "Suresh Karki");
  });

  await step("checklist", async () => {
    await p.goto(BASE + "/portal", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await shot(p, "06-08-dashboard-checklist-done", "The dashboard's setup checklist once the year, classes, terminals, subjects, teachers and Class Teachers are in place");
  });

  await finish(s);
})();
