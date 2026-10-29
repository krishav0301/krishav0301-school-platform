import fs from "node:fs";
import { Client } from "./lib.mjs";
const state = JSON.parse(fs.readFileSync(process.env.STATE || new URL("./state.json", import.meta.url)));
const PW = "Maple-River-2026-sunrise";
const who = {};
const mk = async (key, email, pw) => { const c = new Client(key); const r = await c.signIn(email, pw); who[key] = c; return r; };
await mk("coordinator", "coordinator@lahan.test", PW); await mk("principal", "principal@lahan.test", PW); await mk("accountant", "accountant@lahan.test", PW);
for (const k of ["hari", "sunita", "ramesh", "gita"]) await mk(k, state.teachers[k].email, state.teachers[k].password);
const s2 = state.students.filter((s) => s.level === "Class 2" && s.email), s9 = state.students.filter((s) => s.level === "Class 9");
const stuA = s2.find((s) => s.first === "Aadarsh" && s.last === "Mandal"), stuB = s2.find((s) => s.first === "Aadarsh" && s.last === "Yadav"), stu9 = s9[0];
const r = await mk("studentA", stuA.email, stuA.tempPassword); console.log("student signed in with the admission PIN, forced to change it:", r.changedPassword, "(Lahan lets a student keep it)");
await mk("studentB", stuB.email, stuB.tempPassword); await mk("student9", stu9.email, stu9.tempPassword);
who.anon = new Client("anon");

const c2 = state.classes["Class 2"], c9 = state.classes["Class 9"], t1 = state.terminals[0].id;
const sheet2 = (await who.coordinator.get(`/api/results/classes/${c2.id}/terminals/${t1}/sheet`)).json;
const cardA = sheet2.students.find((s) => s.name.startsWith("Aadarsh") && s.name.includes("Mandal")).cardId;
const sheet9 = (await who.coordinator.get(`/api/results/classes/${c9.id}/terminals/${t1}/sheet`)).json; const card9 = sheet9.students[0].cardId;

const docs = [
  ["card of Class 2 student A", `/api/results/grade-sheets/${cardA}`],
  ["class 2 ledger", `/api/results/classes/${c2.id}/terminals/${t1}/ledger`],
  ["class 2 result sheet", `/api/results/classes/${c2.id}/terminals/${t1}/sheet`],
  ["class 2 final ledger", `/api/results/classes/${c2.id}/final/ledger`],
  ["card of a Class 9 student", `/api/results/grade-sheets/${card9}`],
  ["class 9 ledger", `/api/results/classes/${c9.id}/terminals/${t1}/ledger`],
];
// expected: 200 yes, 403 no right, 404 right but not this record, 401 not signed in
const E = {
  coordinator: [200, 200, 200, 200, 200, 200], principal: [200, 200, 200, 200, 200, 200], accountant: [403, 403, 403, 403, 403, 403],
  hari: [200, 200, 200, 200, 404, 404], sunita: [404, 404, 404, 404, 404, 404], ramesh: [404, 404, 404, 404, 404, 404], gita: [404, 404, 404, 404, 200, 200],
  studentA: [200, 403, 403, 403, 404, 403], studentB: [404, 403, 403, 403, 404, 403], student9: [404, 403, 403, 403, 200, 403], anon: [401, 401, 401, 401, 401, 401],
};
let ok = 0, bad = 0; const rows = [];
for (const [who_, exp] of Object.entries(E)) {
  const got = []; for (const [, path] of docs) got.push((await who[who_].get(path, "any")).status);
  const match = JSON.stringify(got) === JSON.stringify(exp); match ? ok++ : bad++; rows.push([who_, got, exp, match]);
  console.log(`${match ? "PASS" : "FAIL"}  ${who_.padEnd(12)} ${got.join(" ")}${match ? "" : "   expected " + exp.join(" ")}`);
}
console.log("columns:", docs.map((d) => d[0]).join(" | "));
// roll numbers: who may press the button (a class with students waiting: make one with a fresh walk-in is not needed; the refusals are the point)
const rolls = {};
for (const k of ["studentA", "hari", "sunita", "principal", "accountant", "anon"]) rolls[k] = (await who[k].post(`/api/classes/${c2.id}/roll-numbers`, {}, "any")).status;
const co = (await who.coordinator.post(`/api/classes/${c2.id}/roll-numbers`, {}, "any")).status;
console.log("roll-number button:", JSON.stringify(rolls), "coordinator (nobody waiting):", co);
// own results for a student; a student cannot see another student's results
const own = (await who.studentA.get("/api/results/me")).json.results; console.log("student A own results entries:", own.map((x) => x.kind).join(","));
console.log(`\n${ok} roles match, ${bad} differ`);
