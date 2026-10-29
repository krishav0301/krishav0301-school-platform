import fs from "node:fs";
import { Client } from "./lib.mjs";
const OUT = (process.env.STATE || new URL("./state.json", import.meta.url).pathname);
const PW = "Maple-River-2026-sunrise";
const state = { notes: [] };
const note = (s) => { state.notes.push(s); console.log(s); };

const principal = new Client("principal"), coord = new Client("coordinator");
await principal.signIn("principal@lahan.test", PW); note("Principal signed in (no second step, as Lahan's file says)");
await coord.signIn("coordinator@lahan.test", PW); note("Co-ordinator signed in");

// --- Structure (the Principal: sections and programmes; the Co-ordinator: the rest) -------------------------------------
const sec = await principal.post("/api/academics/sections", { name: "School" });
const sectionKey = sec.json.key; note(`section ${sectionKey}`);
const prog = await principal.post("/api/academics/programmes", { name: "English Boarding School", sectionKey, affiliation: "School" });
const levels = {};
for (const n of ["Class 2", "Class 9"]) levels[n] = (await principal.post(`/api/academics/programmes/${prog.json.id}/levels`, { name: n, usualMonths: 12 })).json.id;
const year = await principal.post("/api/academics/years", { bsYear: 2083, startDate: "2026-04-14", endDate: "2027-04-13", levelIds: Object.values(levels) });
await principal.post(`/api/academics/years/${year.json.id}/activate`);
note("term 2083 made and opened with Class 2 and Class 9");

const pat = await coord.put(`/api/academics/years/${year.json.id}/exam-pattern`, { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null, terminals: [{ name: "First Terminal Examination", weight: 40, hasPractical: true }, { name: "Final Examination", weight: 60, hasPractical: true }] });
const patt = await coord.get(`/api/academics/years/${year.json.id}/exam-pattern`);
const terminals = patt.json.terminals; state.terminals = terminals; note(`exam pattern: ${terminals.map((t) => `${t.name} (${t.weight})`).join(", ")}`);

// --- Subjects, each once, with its practical part and its own pass marks ------------------------------------------------
const SUBJECTS = [
  // name, code, full, practical, level names that take it
  ["English", "Eng", 100, 25, ["Class 2", "Class 9"]], ["Nepali", "Nep", 100, 25, ["Class 2", "Class 9"]], ["Science", "Sci", 100, 25, ["Class 2", "Class 9"]],
  ["Mathematics", "Math", 100, null, ["Class 2", "Class 9"]], ["Social Studies", "SosTh", 100, null, ["Class 2"]], ["English Grammar", "Eng.G", 50, null, ["Class 2"]],
  ["Computer", "Com", 50, 25, ["Class 2"]], ["General Knowledge", "GK", 50, null, ["Class 2"]], ["Translation", "Trans", 50, null, ["Class 2"]], ["Conversation", "Conv.", 50, null, ["Class 2"]],
];
const offerings = {}; // level -> subject name -> {id, full, practical}
for (const [name, code, full, prac, lvls] of SUBJECTS) {
  const sid = (await coord.post("/api/academics/subjects", { name, code, sectionKey })).json.id;
  for (const l of lvls) {
    const theory = full - (prac ?? 0);
    const body = { levelId: levels[l], subjectId: sid, fullMarksHundredths: full * 100, practicalHundredths: prac ? prac * 100 : null, passTheoryHundredths: Math.round(theory * 35), passPracticalHundredths: prac ? prac * 40 : null };
    const o = await coord.post("/api/academics/offerings", body);
    (offerings[l] ??= {})[name] = { id: o.json.id, full, practical: prac };
  }
}
note(`subjects and offerings made (${Object.values(offerings).reduce((a, o) => a + Object.keys(o).length, 0)} offerings)`);

// --- Teachers: hired by the Co-ordinator, who sign in with the temporary password and choose their own ----------------
const TEACHERS = [["Hari Prasad Mishra", "hari"], ["Sunita Kumari Yadav", "sunita"], ["Ramesh Chaudhary", "ramesh"], ["Gita Devi Jha", "gita"]];
const teachers = {};
for (const [fullName, key] of TEACHERS) {
  const email = `${key}@lahan.test`;
  const hired = await coord.post("/api/teachers", { fullName, email, homeSectionKey: sectionKey });
  const c = new Client(key); const r = await c.signIn(email, hired.json.temporaryPassword);
  teachers[key] = { client: c, id: hired.json.id, email, password: c.password, name: fullName };
  note(`teacher ${fullName} hired, signed in with the temporary password and had to choose their own: ${r.changedPassword}`);
}
// who teaches what in Class 2 B and Class 9 A
const TEACHES2 = { English: "hari", Nepali: "hari", "English Grammar": "hari", Conversation: "hari", Science: "sunita", Mathematics: "sunita", Computer: "sunita", "Social Studies": "ramesh", "General Knowledge": "ramesh", Translation: "ramesh" };
const TEACHES9 = { English: "gita", Nepali: "gita", Science: "ramesh", Mathematics: "sunita" };

const classes = {};
for (const [lname, label, classTeacher, teaches] of [["Class 2", "B", "hari", TEACHES2], ["Class 9", "A", "gita", TEACHES9]]) {
  const c = await coord.post("/api/academics/classes", { yearId: year.json.id, levelId: levels[lname], label });
  classes[lname] = { id: c.json.id, label, levelId: levels[lname], classTeacher };
  for (const [sub, t] of Object.entries(teaches)) await coord.post("/api/academics/assignments", { classId: c.json.id, offeringId: offerings[lname][sub].id, teacherId: teachers[t].id });
  await coord.post(`/api/academics/classes/${c.json.id}/class-teacher`, { teacherId: teachers[classTeacher].id });
}
note("classes Class 2 B and Class 9 A made, subjects assigned, Class Teachers set");

// --- Students: walk-ins by the Co-ordinator ------------------------------------------------------------------------------
const NAMES2 = [
  ["Aadarsh", "Mandal"], ["Aadarsh", "Yadav"], ["Aaditya", "Saphi"], ["Aarush", "Sah"], ["Aashish", "Sah", "Kumar"], ["Aayush", "Mandal"],
  ["आदर्श", "मण्डल"], ["Suraj", "Passwan"], ["Kirtika", "Singh"], ["Raghunandan", "Chaudhary"], ["Jibika", null],
];
const NAMES9 = [["Apsara", "Singh"], ["Bibek", "Mandal"], ["Krishna", "Thakur"], ["Nitesh", "Ram"], ["Pranish", "Yadav"], ["Radhika", "Das"]];
state.students = [];
let n = 0;
for (const [lname, list] of [["Class 2", NAMES2], ["Class 9", NAMES9]]) {
  for (const [first, last, middle] of list) {
    n++;
    const body = last === null ? { firstName: first, levelId: levels[lname], classId: classes[lname].id } // a student entered with just a name
      : { firstName: first, ...(middle ? { middleName: middle } : {}), lastName: last, dob: `20${lname === "Class 2" ? 18 : 11}-0${1 + (n % 9)}-1${n % 9}`, phone: `98${String(41000000 + n)}`, email: `stu${n}@lahan.test`, guardianName: `${last} guardian`, guardianPhone: `97${String(51000000 + n)}`, levelId: levels[lname], classId: classes[lname].id };
    const r = await coord.post("/api/admissions/walk-ins", body);
    state.students.push({ no: n, level: lname, first, last, middle, id: r.json.id, sid: r.json.sid, email: body.email ?? null, tempPassword: r.json.temporaryPassword });
  }
}
note(`${n} students admitted (one with only a name)`);

// roll numbers: the Co-ordinator's one click, then a late joiner
if (!process.env.OLD) for (const lname of Object.keys(classes)) { const r = await coord.post(`/api/classes/${classes[lname].id}/roll-numbers`); note(`roll numbers ${lname}: numbered ${r.json.numbered}`); }
const late = process.env.OLD ? { json: { id: null, sid: null, temporaryPassword: null } } : await coord.post("/api/admissions/walk-ins", { firstName: "Aaron", lastName: "Late", dob: "2018-05-05", phone: "9841999999", email: "stu99@lahan.test", guardianName: "Late guardian", guardianPhone: "9751999999", levelId: levels["Class 2"], classId: classes["Class 2"].id });
if (!process.env.OLD) state.students.push({ no: 99, level: "Class 2", first: "Aaron", last: "Late", id: late.json.id, sid: late.json.sid, email: "stu99@lahan.test", tempPassword: late.json.temporaryPassword });


Object.assign(state, { year: year.json.id, levels, offerings, classes, teachers: Object.fromEntries(Object.entries(teachers).map(([k, v]) => [k, { id: v.id, email: v.email, password: v.password, name: v.name }])), sectionKey });
fs.writeFileSync(OUT, JSON.stringify(state, null, 1));
console.log("setup done ->", OUT);
