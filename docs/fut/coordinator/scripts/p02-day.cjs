// Precondition P2: the teachers' part of a school day, through the API their screens use. Each teacher signs in for
// the first time with the temporary password the Co-ordinator gave them; Class Teachers mark today's registers (Grade
// 12 is left unmarked on purpose); three subject teachers write today's activity log.
const { BASE, secrets, saveSecrets } = require("./lib.cjs");
const { person, admin } = require("./people-api.cjs");

(async () => {
  const tp = secrets().teacherPasswords;
  const t = {};
  for (const [name, pw] of Object.entries(tp)) t[name] = await person(`${name.toLowerCase().replace(" ", ".")}@school.example`, pw);
  console.log("teachers signed in");
  const classes = (await admin()("GET", "/api/academics/classes")).classes;
  const cls = (prog, level, label) => classes.find((c) => c.programmeName === prog && c.levelName === level && (c.label ?? "") === label).id;
  const g11a = cls("+2 Science", "Grade 11", "A");
  const g11b = cls("+2 Science", "Grade 11", "B");
  const bbs1 = cls("BBS", "Year 1", "");

  const mark = async (teacher, classId, absentNames) => {
    const day = await t[teacher]("GET", `/api/attendance/classes/${classId}/day`);
    const absent = day.students.filter((s) => absentNames.some((n) => s.name.startsWith(n))).map((s) => s.enrollmentId);
    await t[teacher]("PUT", `/api/attendance/classes/${classId}/today`, { absent });
  };
  await mark("Bikash Chaudhary", g11a, ["Rohan", "Kritika"]);
  await mark("Kamala Rai", g11b, []);
  await mark("Puja Singh", bbs1, ["Kiran"]);
  console.log("registers marked");

  const write = async (teacher, classId, subject, body) => {
    const mine = await t[teacher]("GET", "/api/activity/mine");
    const flat = JSON.stringify(mine);
    const rows = (mine.classes ?? mine.items ?? mine.subjects ?? []).flatMap((c) => (c.subjects ? c.subjects.map((x) => ({ ...x, classId: c.classId ?? c.id })) : [c]));
    const row = rows.find((r) => (r.classId === classId) && (r.subjectName ?? r.name ?? "").startsWith(subject));
    if (!row) throw new Error(`no ${subject} for ${teacher}: ${flat.slice(0, 400)}`);
    await t[teacher]("PUT", `/api/activity/classes/${classId}/subjects/${row.offeringId ?? row.id}/today`, { body });
  };
  await write("Bikash Chaudhary", g11a, "Physics", "Newton's laws of motion: worked examples on the second law, and a short class test.");
  await write("Anita Mandal", g11a, "English", "Reading: 'The Gift of the Magi'. Vocabulary list handed out.");
  await write("Puja Singh", bbs1, "Financial Accounting", "Journal entries and the ledger. Homework: exercise 3.2.");
  console.log("activity written");
  saveSecrets({ classIds: { g11a, g11b, bbs1, g12a: cls("+2 Science", "Grade 12", "A") } });
  console.log("P2 day done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
