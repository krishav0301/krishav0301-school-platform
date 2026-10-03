const { open, shot, finish, secrets, saveSecrets, BASE } = require("./lib.cjs");

// Walk-ins through the screen (with screenshots), then the rest of the starting roll the same way through the API the
// screen uses, with the Co-ordinator's own signed-in browser.
const MORE = [
  ["Sita", "Chaudhary", "+2 Science · Grade 11 (A)", "2009-06-14"],
  ["Rohan", "Sah", "+2 Science · Grade 11 (A)", "2009-02-03"],
  ["Puja", "Yadav", "+2 Science · Grade 11 (A)", "2009-08-21"],
  ["Nabin", "Thakur", "+2 Science · Grade 11 (A)", "2009-11-30"],
  ["Kritika", "Jha", "+2 Science · Grade 11 (A)", "2009-04-09"],
  ["Suman", "Rai", "+2 Science · Grade 11 (B)", "2009-07-17"],
  ["Anita", "Das", "+2 Science · Grade 11 (B)", "2009-01-25"],
  ["Deepak", "Gupta", "+2 Science · Grade 12 (A)", "2008-03-20"],
  ["Rekha", "Mahato", "+2 Science · Grade 12 (A)", "2008-09-11"],
  ["Prakash", "Karn", "+2 Science · Grade 12 (A)", "2008-12-02"],
  ["Manisha", "Sah", "BBS · Year 1", "2006-05-05"],
  ["Kiran", "Dahal", "BBS · Year 1", "2006-10-19"],
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
  const students = { ...(secrets().students ?? {}) };
  const form = async ({ first, last, day, month, year, phone, email, guardian, gphone, previous, referred, level, cls }) => {
    await p.getByLabel("First name").fill(first);
    await p.getByLabel("Last name").fill(last);
    await p.getByLabel("Day").fill(String(day));
    await p.getByLabel("Month").selectOption({ index: month });
    await p.getByLabel("Year").fill(String(year));
    await p.getByLabel("Phone", { exact: true }).fill(phone);
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Guardian's name").fill(guardian);
    await p.getByLabel("Guardian's phone").fill(gphone);
    if (previous) await p.getByLabel("Previous school or college").fill(previous);
    if (referred) await p.getByLabel("Referred by (if any)").fill(referred);
    const lv = await p.getByLabel("Applying for").locator("option").allInnerTexts();
    await p.getByLabel("Applying for").selectOption({ label: lv.find((o) => o.endsWith(level)) });
    await p.waitForTimeout(500);
    if (cls) await p.getByLabel("Class", { exact: true }).selectOption({ label: cls });
  };
  const admitted = async (name) => {
    const text = await p.locator("main").innerText();
    const pw = /[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}/.exec(text)?.[0];
    // The screen does not show the student ID (finding F-04), so it is read back through search.
    const found = (await (await p.request.get(`${BASE}/api/students?q=${encodeURIComponent(name.split(" ")[1])}`)).json()).students.filter((x) => `${x.firstName} ${x.lastName}` === name);
    const newest = found.sort((a, b) => b.sid.localeCompare(a.sid))[0];
    if (!students[name]) students[name] = { sid: newest?.sid, studentId: newest?.id, temporaryPassword: pw };
    return { sid: newest?.sid, pw };
  };

  await step("walkin", async () => {
    await p.goto(BASE + "/portal/admissions/register", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "07-01-walkin-form", "Register a walk-in: the Co-ordinator's own registration is admitted at once (no queue)");
    await p.getByRole("button", { name: "Admit" }).click();
    await p.waitForTimeout(800);
    await shot(p, "07-02-walkin-empty", "Admit with nothing filled in: each required field is asked for");
    await form({ first: "Aarav", last: "Mandal", day: 12, month: 2, year: 2066, phone: "9812100001", email: "aarav.mandal@student.example", guardian: "Ramesh Mandal", gphone: "9700100001", previous: "Shree Janata Secondary School, Lahan", referred: "Bikash Chaudhary", level: "+2 Science · Grade 11", cls: "+2 Science · Grade 11 (A)" });
    await shot(p, "07-03-walkin-filled", "Aarav Mandal: born 12 Jestha 2066 (BS), Grade 11 of +2 Science, class A, with his previous school and who referred him");
    await p.getByRole("button", { name: "Admit" }).click();
    await p.waitForTimeout(2000);
    const a = await admitted("Aarav Mandal");
    await shot(p, "07-04-walkin-admitted", "Admitted at once: the temporary password is shown once (the new student ID is not shown, finding F-04)");

    await p.goto(BASE + "/portal/admissions/register", { waitUntil: "networkidle" });
    await form({ first: "Aarav", last: "Mandal", day: 12, month: 2, year: 2066, phone: "9812100001", email: "aarav.m2@student.example", guardian: "Ramesh Mandal", gphone: "9700100001", level: "+2 Science · Grade 11", cls: "+2 Science · Grade 11 (A)" });
    await p.getByRole("button", { name: "Admit" }).click();
    await p.waitForTimeout(2000);
    await shot(p, "07-05-walkin-duplicate", "The same name, date of birth and phone again: admitted a second time with no warning (finding F-03)");

    await p.goto(BASE + "/portal/admissions/register", { waitUntil: "networkidle" });
    await form({ first: "Bibek", last: "Shrestha", day: 5, month: 4, year: 2063, phone: "9812100013", email: "bibek.shrestha@student.example", guardian: "Hari Shrestha", gphone: "9700100013", level: "BBS · Year 1", cls: "BBS · Year 1" });
    await p.getByRole("button", { name: "Admit" }).click();
    await p.waitForTimeout(2000);
    await admitted("Bibek Shrestha");
    await shot(p, "07-06-walkin-bbs", "Bibek Shrestha admitted to BBS Year 1: the next number in the same school-wide sequence", { full: false });
    saveSecrets({ students });
  });

  await step("roll", async () => {
    const classes = (await (await p.request.get(BASE + "/api/academics/classes")).json()).classes;
    for (const [i, [first, last, cls, dob]] of MORE.entries()) {
      const c = classes.find((x) => `${x.programmeName ?? ""}`.length && cls.startsWith(x.programmeName) && cls.includes(x.levelName) && (cls.includes(`(${x.label})`) || !x.label)) ?? classes.find((x) => x.name === cls);
      const r = await p.request.post(BASE + "/api/admissions/walk-ins", {
        headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin" },
        data: { firstName: first, lastName: last, dob, phone: `98121${String(i + 2).padStart(5, "0")}`, email: `${first.toLowerCase()}.${last.toLowerCase()}@student.example`, guardianName: `${last} guardian`, guardianPhone: `97001${String(i + 2).padStart(5, "0")}`, levelId: c.levelId, classId: c.id },
      });
      const body = await r.json();
      if (r.status() !== 201) throw new Error(`${first} ${last}: ${r.status()} ${JSON.stringify(body)}`);
      students[`${first} ${last}`] = { sid: body.sid, temporaryPassword: body.temporaryPassword, studentId: body.studentId };
    }
    saveSecrets({ students });
    console.log("students:", Object.keys(students).length);
  });

  await finish(s);
})();
