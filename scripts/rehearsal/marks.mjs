import fs from "node:fs";
import { Client } from "./lib.mjs";
const state = JSON.parse(fs.readFileSync(process.env.STATE || new URL("./state.json", import.meta.url)));
const PW = "Maple-River-2026-sunrise";
const log = []; const check = (ok, what) => { log.push([ok, what]); console.log((ok ? "PASS " : "FAIL ") + what); };
const coord = new Client("coordinator"); await coord.signIn("coordinator@lahan.test", PW);
const tc = {}; for (const [k, t] of Object.entries(state.teachers)) { tc[k] = new Client(k); await tc[k].signIn(t.email, t.password); }
check(true, "all four teachers signed in again with their own chosen passwords");

const TEACHES = { "Class 2": { English: "hari", Nepali: "hari", "English Grammar": "hari", Conversation: "hari", Science: "sunita", Mathematics: "sunita", Computer: "sunita", "Social Studies": "ramesh", "General Knowledge": "ramesh", Translation: "ramesh" }, "Class 9": { English: "gita", Nepali: "gita", Science: "ramesh", Mathematics: "sunita" } };
const BASE1 = { "Aadarsh Mandal": 85, "Aadarsh Yadav": 92, "Aaditya Saphi": 60, "Aarush Sah": 45, "Aashish Sah": 78, "Aayush Mandal": 70, "Jibika": 88, "Kirtika Singh": 70, "Raghunandan Chaudhary": 66, "Suraj Passwan": null, "आदर्श मण्डल": 55, "Aaron Late": 38,
  "Apsara Singh": 95, "Bibek Mandal": 82, "Krishna Thakur": 74, "Nitesh Ram": 61, "Pranish Yadav": 50, "Radhika Das": 33 };
const DELTA = [0, 3, -2, 4, -3, 2, -1, 1, 0, -4];
const clamp = (x) => Math.max(0, Math.min(100, x));
const record = {}; // class -> terminalId -> subject -> studentName -> {theory, practical, theoryMax, practicalMax}
const T = state.terminals; state.marks = record;

async function enter(lname, terminal, termNo) {
  const cls = state.classes[lname]; const subjects = Object.keys(state.offerings[lname]);
  const sheetIds = {};
  for (const [si, sub] of subjects.entries()) {
    const teacher = tc[TEACHES[lname][sub]]; const off = state.offerings[lname][sub];
    const path = `/api/results/classes/${cls.id}/subjects/${off.id}/terminals/${terminal.id}`;
    const sheet = (await teacher.get(path)).json;
    const holds = sheet.components.map((c) => c.id);
    const rows = []; const rec = ((record[lname] ??= {})[terminal.id] ??= {})[sub] = {};
    for (const st of sheet.students) {
      const nm = st.name.trim(); const base = BASE1[nm]; const pct = base === null ? null : clamp(base + (termNo === 2 ? 4 : 0) + DELTA[si % 10]);
      rec[nm] = {};
      for (const c of sheet.components) {
        let p = pct;
        // awkward values: exactly 90% in English (theory 67.5 of 75, practical 22.5 of 25) and exactly 40% in Grammar (20 of 50)
        if (termNo === 1 && nm === "Aadarsh Yadav" && sub === "English") p = 90;
        if (termNo === 1 && nm === "Aadarsh Yadav" && sub === "English Grammar") p = 40;
        const v = p === null ? null : Math.round((c.maxHundredths * p) / 100);
        rows.push({ enrollmentId: st.enrollmentId, componentId: c.id, valueHundredths: v, absent: v === null });
        rec[nm][c.id] = { value: v, max: c.maxHundredths };
      }
    }
    if (si === 0) { // refusals worth seeing once: a mark above the paper's maximum, and a teacher who does not teach it
      const over = await teacher.put(path, { marks: [{ ...rows[0], valueHundredths: sheet.components[0].maxHundredths + 100, absent: false }] }, "any");
      check(over.status === 422 || over.status === 400, `a mark above the paper's maximum is refused (${over.status})`);
      const other = tc[Object.keys(tc).find((k) => k !== TEACHES[lname][sub])];
      const wrong = await other.put(path, { marks: rows.slice(0, 1) }, "any");
      check([403, 404].includes(wrong.status), `a teacher who does not teach the subject cannot enter its marks (${wrong.status})`);
    }
    const saved = await teacher.put(path, { marks: rows }, "any"); if (saved.status !== 200) throw new Error(`save ${lname} ${sub}: ${saved.status} ${saved.text.slice(0, 200)}`);
    const sub1 = await teacher.post(`${path}/submit`, {}, "any"); if (sub1.status !== 200) throw new Error(`submit ${lname} ${sub}: ${sub1.status} ${sub1.text.slice(0, 200)}`);
    sheetIds[sub] = (await teacher.get(path)).json.sheetId;
  }
  return sheetIds;
}
async function publishTerm(lname, terminal, termNo) {
  const cls = state.classes[lname];
  const ids = await enter(lname, terminal, termNo);
  const all = Object.values(ids);
  // publish before verifying: not allowed
  const early = await coord.post(`/api/results/classes/${cls.id}/publish`, { terminalId: terminal.id }, "any");
  check(early.status === 409, `${lname}: publishing before the sheets are verified is refused (${early.status})`);
  // verify all but one: still not allowed
  await coord.post("/api/results/review/verify", { sheetIds: all.slice(0, -1) });
  const partial = await coord.post(`/api/results/classes/${cls.id}/publish`, { terminalId: terminal.id }, "any");
  check(partial.status === 409, `${lname}: publishing with one subject still unverified is refused (${partial.status})`);
  const noCard = await tc[cls.classTeacher].get(`/api/results/classes/${cls.id}/terminals/${terminal.id}/ledger`, "any");
  check(noCard.status === 404, `${lname}: no ledger exists before publishing (${noCard.status})`);
  // a teacher cannot edit a verified sheet
  const firstSub = Object.keys(ids)[0]; const off = state.offerings[lname][firstSub];
  const locked = await tc[TEACHES[lname][firstSub]].put(`/api/results/classes/${cls.id}/subjects/${off.id}/terminals/${terminal.id}`, { marks: [{ enrollmentId: (await coord.get(`/api/classes/${cls.id}`)).json.students[0].enrollmentId, componentId: "theory", valueHundredths: 100, absent: false }] }, "any");
  check(locked.status === 409 || locked.status === 403, `${lname}: a verified sheet can no longer be edited by its teacher (${locked.status})`);
  await coord.post("/api/results/review/verify", { sheetIds: all.slice(-1) });
  const pub = await coord.post(`/api/results/classes/${cls.id}/publish`, { terminalId: terminal.id }, "any");
  check(pub.status === 201, `${lname}: ${terminal.name} published (${pub.status}) final=${pub.json?.finalPublicationId ? "yes" : "no"}`);
  const again = await coord.post(`/api/results/classes/${cls.id}/publish`, { terminalId: terminal.id }, "any");
  check(again.status === 409, `${lname}: publishing the same exam twice is refused (${again.status})`);
  return pub.json;
}
for (const lname of ["Class 2", "Class 9"]) {
  const p1 = await publishTerm(lname, T[0], 1);
  check(!p1.finalPublicationId, `${lname}: the final is not out after the first exam`);
  const p2 = await publishTerm(lname, T[1], 2);
  check(!!p2.finalPublicationId, `${lname}: the final result came out with the last exam`);
}
fs.writeFileSync((process.env.STATE || new URL("./state.json", import.meta.url).pathname), JSON.stringify(state, null, 1));
fs.writeFileSync(new URL("./marks-log.json", import.meta.url).pathname, JSON.stringify(log));
console.log(`\n${log.filter((l) => l[0]).length} passed, ${log.filter((l) => !l[0]).length} failed`);
