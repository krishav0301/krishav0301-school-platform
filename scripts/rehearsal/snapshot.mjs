import fs from "node:fs";
import { Client } from "./lib.mjs";
const state = JSON.parse(fs.readFileSync(process.env.STATE));
const PW = "Maple-River-2026-sunrise";
const coord = new Client("c"); await coord.signIn("coordinator@lahan.test", PW);
const snap = { sheets: {}, own: {}, counts: {} };
for (const lname of ["Class 2", "Class 9"]) {
  const c = state.classes[lname];
  for (const t of state.terminals) snap.sheets[`${lname}|${t.name}`] = (await coord.get(`/api/results/classes/${c.id}/terminals/${t.id}/sheet`)).json;
  snap.sheets[`${lname}|final`] = (await coord.get(`/api/results/classes/${c.id}/final/sheet`)).json;
  snap.counts[lname] = (await coord.get(`/api/classes/${c.id}`)).json.students.map((s) => [s.rollNo, s.name.trim(), s.sid]);
}
// every student's own results, with their own sign-in
for (const s of state.students.filter((s) => s.email)) { const sc = new Client(s.email); try { await sc.signIn(s.email, s.tempPassword); snap.own[s.email] = (await sc.get("/api/results/me")).json; } catch (e) { snap.own[s.email] = "ERR " + e.message.slice(0, 80); } }
snap.teacherSignIn = {}; for (const [k, t] of Object.entries(state.teachers)) { const tc = new Client(k); try { await tc.signIn(t.email, t.password); snap.teacherSignIn[k] = "ok"; } catch (e) { snap.teacherSignIn[k] = "ERR"; } }
fs.writeFileSync(process.env.OUTFILE, JSON.stringify(snap));
const students = Object.values(snap.own).filter((x) => typeof x === "object").length;
console.log(`snapshot: ${Object.keys(snap.sheets).length} class sheets, ${students} students' own results, teachers: ${JSON.stringify(snap.teacherSignIn)}`);
