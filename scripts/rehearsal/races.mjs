import fs from "node:fs";
import { Client } from "./lib.mjs";
const state = JSON.parse(fs.readFileSync(process.env.STATE || new URL("./state.json", import.meta.url)));
const PW = "Maple-River-2026-sunrise";
const coord = new Client("c"); await coord.signIn("coordinator@lahan.test", PW);
const coord2 = new Client("c2"); await coord2.signIn("coordinator@lahan.test", PW); // a second sign-in of the same person (two tabs)
const out = []; const check = (ok, w) => { out.push(ok); console.log((ok ? "PASS " : "FAIL ") + w); };
const c2 = state.classes["Class 2"], t = state.terminals;

// 1. roll numbers: three late joiners, then two clicks at the same moment
for (let i = 0; i < 3; i++) await coord.post("/api/admissions/walk-ins", { firstName: `Late${i}`, lastName: "Joiner", dob: "2018-06-0" + (i + 1), phone: `98419990${i}0`, email: `late${i}@lahan.test`, guardianName: "G", guardianPhone: `97519990${i}0`, levelId: state.levels["Class 2"], classId: c2.id });
const hub1 = (await coord.get(`/api/classes/${c2.id}`)).json; const nums = hub1.students.map((s) => s.rollNo);
check(nums.every((n) => n !== null) && new Set(nums).size === nums.length, `three late joiners got the next numbers at the end, no number twice (${nums.slice(-4).join(", ")})`);
// make two students unnumbered via a fresh class so both clicks have work to do
const lvl = state.levels["Class 2"];
const cls = await coord.post("/api/academics/classes", { yearId: state.year, levelId: lvl, label: "C" });
for (let i = 0; i < 6; i++) { const r = await coord.post("/api/admissions/walk-ins", { firstName: `Zed${i}`, lastName: `Fam${i}`, dob: "2018-07-1" + i, phone: `98429990${i}0`, email: `zed${i}@lahan.test`, guardianName: "G", guardianPhone: `97529990${i}0`, levelId: lvl, classId: cls.json.id }); }
const [r1, r2] = await Promise.all([coord.post(`/api/classes/${cls.json.id}/roll-numbers`, {}, "any"), coord2.post(`/api/classes/${cls.json.id}/roll-numbers`, {}, "any")]);
const codes = [r1.status, r2.status].sort();
check(codes[0] === 200 && codes[1] === 409, `two clicks at once: one numbers the class, the other is told nobody is waiting (${codes.join(", ")})`);
const hub2 = (await coord.get(`/api/classes/${cls.json.id}`)).json; const n2 = hub2.students.map((s) => s.rollNo).sort((a, b) => a - b);
check(JSON.stringify(n2) === "[1,2,3,4,5,6]", `and the class has exactly 1 to 6, no gaps or repeats (${n2.join(",")})`);

// 2. publishing the same class twice at once (a fresh class with one subject, one exam)
const sub = Object.entries(state.offerings["Class 9"])[0]; // reuse an offering of Class 9: make a Class 9 B with 2 students
const cls9b = await coord.post("/api/academics/classes", { yearId: state.year, levelId: state.levels["Class 9"], label: "B" });
for (const [name, off] of Object.entries(state.offerings["Class 9"])) await coord.post("/api/academics/assignments", { classId: cls9b.json.id, offeringId: off.id, teacherId: state.teachers[{ English: "gita", Nepali: "gita", Science: "ramesh", Mathematics: "sunita" }[name]].id });
for (let i = 0; i < 2; i++) await coord.post("/api/admissions/walk-ins", { firstName: `Nine${i}`, lastName: "Pupil", dob: "2011-02-1" + i, phone: `98439990${i}0`, email: `nine${i}@lahan.test`, guardianName: "G", guardianPhone: `97539990${i}0`, levelId: state.levels["Class 9"], classId: cls9b.json.id });
const T = { gita: new Client("g"), ramesh: new Client("r"), sunita: new Client("s") }; for (const k of Object.keys(T)) await T[k].signIn(state.teachers[k].email, state.teachers[k].password);
const ids = [];
for (const [name, off] of Object.entries(state.offerings["Class 9"])) {
  const who = T[{ English: "gita", Nepali: "gita", Science: "ramesh", Mathematics: "sunita" }[name]];
  const path = `/api/results/classes/${cls9b.json.id}/subjects/${off.id}/terminals/${t[0].id}`;
  const sh = (await who.get(path)).json;
  await who.put(path, { marks: sh.students.flatMap((s) => sh.components.map((c) => ({ enrollmentId: s.enrollmentId, componentId: c.id, valueHundredths: Math.round(c.maxHundredths * 0.7), absent: false }))) });
  await who.post(`${path}/submit`, {}); ids.push((await who.get(path)).json.sheetId);
}
await coord.post("/api/results/review/verify", { sheetIds: ids });
const [p1, p2] = await Promise.all([coord.post(`/api/results/classes/${cls9b.json.id}/publish`, { terminalId: t[0].id }, "any"), coord2.post(`/api/results/classes/${cls9b.json.id}/publish`, { terminalId: t[0].id }, "any")]);
const pc = [p1.status, p2.status].sort();
check(pc[0] === 201 && pc[1] === 409, `two Publish clicks at once: one publishes, the other is refused (${pc.join(", ")})`);
const led = (await coord.get(`/api/results/classes/${cls9b.json.id}/terminals/${t[0].id}/ledger`)).json;
check(led.students.length === 2, `the class was published once: its ledger has 2 students, no duplicates (${led.students.length})`);

// 3. a recheck changes the card; the old version still opens; rank and ledger follow
const stu = state.students.find((s) => s.first === "Aaditya" && s.last === "Saphi"); const sc = new Client("stu"); await sc.signIn(stu.email, stu.tempPassword);
const own = (await sc.get("/api/results/me")).json.results.find((r) => r.kind === "terminal" && r.terminalName === "First Terminal Examination");
const before = (await sc.get(`/api/results/grade-sheets/${own.card.id}`)).json;
const english = state.offerings["Class 2"]["English"].id;
const asked = await sc.post(`/api/results/publications/${own.publicationId}/rechecks`, { offeringId: english, reason: "A page of my paper was not counted" }, "any");
check(asked.status === 201, `a student asks for a recheck of English (${asked.status})`);
const decided = await coord.post(`/api/results/rechecks/${asked.json.id}/decide`, { outcome: "changed", reason: "A page was missed", marks: [{ componentId: "theory", valueHundredths: 7500, absent: false }, { componentId: "practical", valueHundredths: 2500, absent: false }] }, "any");
check(decided.status === 200, `the Co-ordinator corrects it to full marks (${decided.status})`);
const newCard = (await sc.get("/api/results/me")).json.results.find((r) => r.kind === "terminal" && r.terminalName === "First Terminal Examination").card;
const after = (await sc.get(`/api/results/grade-sheets/${newCard.id}`)).json;
check(newCard.version === 2 && after.totalObtainedHundredths > before.totalObtainedHundredths && after.rank <= before.rank, `a second card version exists: total ${before.totalObtainedHundredths / 100} to ${after.totalObtainedHundredths / 100}, rank ${before.rank} to ${after.rank}`);
const oldStill = await sc.get(`/api/results/grade-sheets/${own.card.id}`, "any");
check(oldStill.status === 200 && oldStill.json.totalObtainedHundredths === before.totalObtainedHundredths, "the first version still opens, as it was");
const led2 = (await coord.get(`/api/results/classes/${c2.id}/terminals/${t[0].id}/ledger`)).json; const me = led2.students.find((s) => s.name.includes("Aaditya"));
check(me.totalHundredths === after.totalObtainedHundredths && me.rank === after.rank, "the ledger shows the new total and rank too");
console.log(`\n${out.filter(Boolean).length} passed, ${out.filter((x) => !x).length} failed`);
