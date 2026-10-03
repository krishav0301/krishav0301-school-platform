// Precondition P1: the rest of the school does its part of the year through the API, as their screens would.
// Co-ordinator Sita sets up the year; teachers mark attendance, write the activity log and enter marks; the
// Accountant drafts fee structures and sends them for approval; Sita drafts website notices for approval.
const { secrets, saveSecrets } = require("./lib.cjs");
const { person, admin } = require("./people-api.cjs");

const nepalToday = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);

(async () => {
  const principal = admin();
  const staff = (await principal("GET", "/api/staff")).staff;
  const idOf = (email) => staff.find((s) => s.email === email).id;
  const tempFor = async (email) => (await principal("POST", `/api/staff/${idOf(email)}/temporary-password`, {})).temporaryPassword;

  const sita = await person("sita.sharma@school.example", secrets().people?.["sita.sharma@school.example"] ? null : await tempFor("sita.sharma@school.example"));
  const gita = await person("gita.thapa@school.example", secrets().people?.["gita.thapa@school.example"] ? null : await tempFor("gita.thapa@school.example"));
  await person("hari.yadav@school.example", secrets().people?.["hari.yadav@school.example"] ? null : await tempFor("hari.yadav@school.example"));
  console.log("staff signed in");

  const { programmes, sections } = await sita("GET", "/api/academics/programmes");
  const prog = (name) => programmes.find((p) => p.name === name);
  const level = (p, l) => prog(p).levels.find((x) => x.name === l).id;
  const plus2 = sections.find((s) => s.name.startsWith("+2")).key;
  const bach = sections.find((s) => s.name === "Bachelor's").key;

  // Year and terminals.
  const { years } = await sita("GET", "/api/academics/years");
  let year = years.find((y) => y.status === "active");
  if (!year) {
    const b = 2083;
    const id = (await sita("POST", "/api/academics/years", { bsYear: b, startDate: "2026-04-14", endDate: "2027-04-13" })).id;
    await sita("POST", `/api/academics/years/${id}/activate`);
    year = { id };
  }
  const terminals = [];
  for (const name of ["First terminal", "Second terminal", "Final"]) terminals.push((await sita("POST", "/api/academics/terminals", { yearId: year.id, name })).id);

  // Teachers.
  const T = [
    ["Bikash Chaudhary", "bikash.chaudhary", plus2],
    ["Anita Mandal", "anita.mandal", plus2],
    ["Suresh Karki", "suresh.karki", plus2],
    ["Kamala Rai", "kamala.rai", plus2],
    ["Puja Singh", "puja.singh", bach],
    ["Rajan Sah", "rajan.sah", bach],
  ];
  const teacher = {};
  const teacherClient = {};
  for (const [i, [fullName, user, sec]] of T.entries()) {
    const email = `${user}@school.example`;
    const hired = await sita("POST", "/api/teachers", { fullName, email, phone: `98510000${10 + i}`, homeSectionKey: sec });
    teacher[user] = hired.id;
    teacherClient[user] = await person(email, hired.temporaryPassword);
  }
  console.log("teachers hired and signed in");

  // Classes.
  const g11 = (await sita("POST", "/api/academics/classes", { yearId: year.id, levelId: level("+2 Science", "Grade 11"), label: "A" })).id;
  const g12 = (await sita("POST", "/api/academics/classes", { yearId: year.id, levelId: level("+2 Science", "Grade 12"), label: "A" })).id;
  const bbs1 = (await sita("POST", "/api/academics/classes", { yearId: year.id, levelId: level("BBS", "Year 1"), label: "" })).id;

  // Subjects, offerings with parts, assignments.
  const subjectIds = {};
  const subj = async (name) => (subjectIds[name] ??= (await sita("POST", "/api/academics/subjects", { name })).id);
  const offer = async (levelId, classId, name, credit, parts, teacherUser) => {
    const offeringId = (await sita("POST", "/api/academics/offerings", { levelId, subjectId: await subj(name), creditHundredths: credit * 100 })).id;
    for (const [pname, max, kind] of parts) await sita("POST", `/api/academics/offerings/${offeringId}/components`, { name: pname, maxHundredths: max * 100, kind });
    await sita("POST", "/api/academics/assignments", { classId, offeringId, teacherId: teacher[teacherUser] });
    return offeringId;
  };
  const TP = [["Theory", 75, "theory"], ["Practical", 25, "practical"]];
  const TH = [["Theory", 100, "theory"]];
  const offerings = { g11: {}, g12: {}, bbs1: {} };
  const G11 = [["English", 4, TH, "anita.mandal"], ["Nepali", 3, TH, "kamala.rai"], ["Physics", 5, TP, "bikash.chaudhary"], ["Chemistry", 5, TP, "suresh.karki"], ["Mathematics", 5, TH, "bikash.chaudhary"]];
  for (const [n, c, parts, t] of G11) offerings.g11[n] = { id: await offer(level("+2 Science", "Grade 11"), g11, n, c, parts, t), teacher: t };
  for (const [n, c, parts, t] of G11) offerings.g12[n] = { id: await offer(level("+2 Science", "Grade 12"), g12, n, c, parts, t), teacher: t };
  for (const [n, t] of [["Business English", "rajan.sah"], ["Financial Accounting", "puja.singh"], ["Micro Economics", "rajan.sah"]]) offerings.bbs1[n] = { id: await offer(level("BBS", "Year 1"), bbs1, n, 3, TH, t), teacher: t };
  await sita("POST", `/api/academics/classes/${g11}/class-teacher`, { teacherId: teacher["bikash.chaudhary"] });
  await sita("POST", `/api/academics/classes/${g12}/class-teacher`, { teacherId: teacher["anita.mandal"] });
  await sita("POST", `/api/academics/classes/${bbs1}/class-teacher`, { teacherId: teacher["puja.singh"] });
  console.log("classes and subjects ready");

  // Students (walk-ins, auto-approved).
  const S11 = [["Aarav", "Mandal"], ["Sita", "Chaudhary"], ["Rohan", "Sah"], ["Puja", "Yadav"], ["Nabin", "Thakur"], ["Kritika", "Jha"], ["Suman", "Rai"], ["Anita", "Das"]];
  const S12 = [["Deepak", "Gupta"], ["Rekha", "Mahato"], ["Prakash", "Karn"], ["Sabina", "Tamang"]];
  const SB = [["Bibek", "Shrestha"], ["Manisha", "Sah"], ["Ramesh", "Paudel"], ["Sunita", "Mehta"], ["Kiran", "Dahal"]];
  const students = {};
  let n = 0;
  const walkIn = async (first, last, levelId, classId, born) => {
    n++;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@student.example`;
    const r = await sita("POST", "/api/admissions/walk-ins", { firstName: first, lastName: last, dob: born, phone: `9812${String(100000 + n).slice(-6)}`, email, guardianName: `${last} guardian`, guardianPhone: `9700${String(100000 + n).slice(-6)}`, levelId, classId });
    students[`${first} ${last}`] = { sid: r.sid, studentId: r.studentId, email, temp: r.temporaryPassword };
  };
  for (const [f, l] of S11) await walkIn(f, l, level("+2 Science", "Grade 11"), g11, "2009-05-12");
  for (const [f, l] of S12) await walkIn(f, l, level("+2 Science", "Grade 12"), g12, "2008-03-20");
  for (const [f, l] of SB) await walkIn(f, l, level("BBS", "Year 1"), bbs1, "2006-08-01");
  // Two students sign in, so their own views (fees, results) exist the way a student sees them.
  for (const who of ["Aarav Mandal", "Sita Chaudhary"]) students[who].signedIn = true, await person(students[who].email, students[who].temp);
  console.log("students admitted:", Object.keys(students).length);

  // Attendance today: Grade 11 with two absent, BBS Year 1 with one; Grade 12 not marked yet.
  const day = await teacherClient["bikash.chaudhary"]("GET", `/api/attendance/classes/${g11}/day`);
  const absent11 = day.students.filter((s) => /Rohan|Kritika/.test(s.name)).map((s) => s.enrollmentId);
  await teacherClient["bikash.chaudhary"]("PUT", `/api/attendance/classes/${g11}/today`, { absent: absent11 });
  const dayB = await teacherClient["puja.singh"]("GET", `/api/attendance/classes/${bbs1}/day`);
  await teacherClient["puja.singh"]("PUT", `/api/attendance/classes/${bbs1}/today`, { absent: dayB.students.filter((s) => /Kiran/.test(s.name)).map((s) => s.enrollmentId) });
  await sita("PUT", "/api/attendance/teachers/day", { date: nepalToday(), exceptions: [{ teacherId: teacher["suresh.karki"], status: "leave" }] });
  console.log("attendance marked");

  // Activity log.
  await teacherClient["bikash.chaudhary"]("PUT", `/api/activity/classes/${g11}/subjects/${offerings.g11.Physics.id}/today`, { body: "Newton's laws of motion: worked examples on the second law, and a short class test." });
  await teacherClient["anita.mandal"]("PUT", `/api/activity/classes/${g11}/subjects/${offerings.g11.English.id}/today`, { body: "Reading: 'The Gift of the Magi'. Vocabulary list handed out." });
  await teacherClient["puja.singh"]("PUT", `/api/activity/classes/${bbs1}/subjects/${offerings.bbs1["Financial Accounting"].id}/today`, { body: "Journal entries and the ledger. Homework: exercise 3.2." });

  // Marks: first terminal of Grade 11, entered and submitted by each teacher.
  const sheet = (classId, offeringId, terminal) => `/api/results/classes/${classId}/subjects/${offeringId}/terminals/${terminal}`;
  const pct = { Aarav: 92, Sita: 88, Rohan: 41, Puja: 76, Nabin: 67, Kritika: 33, Suman: 81, Anita: 59 };
  const enter = async (classId, offs, terminal, scale = 1, submit = true) => {
    for (const [name, o] of Object.entries(offs)) {
      const t = teacherClient[o.teacher];
      const grid = await t("GET", sheet(classId, o.id, terminal));
      const marks = grid.students.flatMap((st) => grid.components.map((comp) => {
        const base = (pct[st.name.split(" ")[0]] ?? 70) * scale;
        const p = Math.max(0, Math.min(100, base + (name.length % 5) * 2 - 4));
        return { enrollmentId: st.enrollmentId, componentId: comp.id, valueHundredths: Math.round((comp.maxHundredths * p) / 100), absent: false };
      }));
      await t("PUT", sheet(classId, o.id, terminal), { marks });
      if (submit) await t("POST", `${sheet(classId, o.id, terminal)}/submit`);
    }
  };
  await enter(g11, offerings.g11, terminals[0]);
  const board = await sita("GET", `/api/results/review?terminalId=${terminals[0]}`);
  const cls = board.classes.find((x) => x.classId === g11);
  await sita("POST", "/api/results/review/verify", { sheetIds: cls.subjects.map((x) => x.sheetId) });
  await sita("POST", `/api/results/classes/${g11}/publish`, { terminalId: terminals[0] });
  // Second terminal: some subjects submitted, some still drafts (to show the statuses).
  await enter(g11, { Physics: offerings.g11.Physics, Chemistry: offerings.g11.Chemistry }, terminals[1], 1.02, true);
  await enter(g11, { English: offerings.g11.English }, terminals[1], 1.0, false);
  // BBS Year 1 first terminal published too.
  await enter(bbs1, offerings.bbs1, terminals[0], 0.95);
  const boardB = await sita("GET", `/api/results/review?terminalId=${terminals[0]}`);
  await sita("POST", "/api/results/review/verify", { sheetIds: boardB.classes.find((x) => x.classId === bbs1).subjects.map((x) => x.sheetId) });
  await sita("POST", `/api/results/classes/${bbs1}/publish`, { terminalId: terminals[0] });
  console.log("results published");

  // Fees: three structures drafted and sent for the Principal's approval.
  const structures = {};
  const FEES = { g11: [["Tuition", 350_000, "monthly"], ["Examination", 300_000, "yearly"], ["Admission", 1_500_000, "one_time"], ["Laboratory", 200_000, "yearly"]], g12: [["Tuition", 375_000, "monthly"], ["Examination", 300_000, "yearly"]], bbs1: [["Tuition", 400_000, "monthly"], ["University registration", 250_000, "one_time"]] };
  const LV = { g11: level("+2 Science", "Grade 11"), g12: level("+2 Science", "Grade 12"), bbs1: level("BBS", "Year 1") };
  for (const k of ["g11", "g12", "bbs1"]) {
    const id = (await gita("POST", "/api/fees/structures", { levelId: LV[k] })).id;
    for (const [name, amountPaisa, frequency] of FEES[k]) await gita("POST", `/api/fees/structures/${id}/items`, { name, amountPaisa, frequency });
    await gita("POST", `/api/fees/structures/${id}/send`, {});
    structures[k] = id;
  }
  console.log("fee structures sent for approval");

  // Website drafts from the Co-ordinator, sent for approval.
  const today = nepalToday();
  const n1 = (await sita("POST", "/api/content", { kind: "notice", title: "Grade 11 first terminal results are out", body: "Results of the first terminal examination for Grade 11 are now in the student portal.\n\nGuardians may meet class teachers on Sunday from 10:00.", publishOn: today })).id;
  await sita("POST", "/api/approvals", { kind: "website_content", subjectId: n1 });
  const n2 = (await sita("POST", "/api/content", { kind: "event", title: "Inter-college quiz contest", body: "Teams of three from each class. Register with your class teacher by Friday.", publishOn: today })).id;
  await sita("POST", "/api/approvals", { kind: "website_content", subjectId: n2 });

  saveSecrets({ year: { yearId: year.id, terminals, g11, g12, bbs1, offerings, structures, students, teacher } });
  console.log("P1 done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
