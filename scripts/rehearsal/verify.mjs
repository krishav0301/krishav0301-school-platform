import fs from "node:fs";
import { Client } from "./lib.mjs";
const state = JSON.parse(fs.readFileSync(process.env.STATE || new URL("./state.json", import.meta.url)));
const coord = new Client("coordinator"); await coord.signIn("coordinator@lahan.test", "Maple-River-2026-sunrise");
let pass = 0; const fails = [];
const eq = (what, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else fails.push(`${what}: system ${JSON.stringify(got)} vs independent ${JSON.stringify(want)}`); };

// --- the independent rules, written again from the shared cards -----------------------------------------------------
const BANDS = [[90, "A+", 400], [80, "A", 360], [70, "B+", 320], [60, "B", 280], [50, "C+", 240], [40, "C", 200], [35, "D+", 160]];
const band = (obt, full) => { if (full > 0) for (const [lo, g, pt] of BANDS) if (obt * 100 > lo * full) return [g, pt]; return ["NG", 0]; };
const DIV = [[80, "Distinction"], [60, "First Division"], [45, "Second Division"], [35, "Third Division"]];
const division = (obt, full) => { for (const [lo, name] of DIV) if (obt * 100 >= lo * full) return name; return null; };
const pctH = (obt, full) => Math.floor((2 * obt * 10000 + full) / (2 * full));
const denseRank = (rows) => { const out = {}; for (const r of rows) out[r.id] = 1 + new Set(rows.filter((o) => o.obt * r.full > r.obt * o.full).map((o) => o.obt)).size; return out; };
const T = state.terminals; const W = Object.fromEntries(T.map((t) => [t.id, t.weight]));
const passTheory = (full, prac) => Math.round((full - (prac ?? 0)) * 35); // hundredths of marks: 35 per cent of the theory part (full in marks)
const norm = (s) => s.trim().replace("Aashish Kumar Sah", "Aashish Sah"); // the card and ledger print the middle name; the marks grid does not

for (const lname of ["Class 2", "Class 9"]) {
  const cls = state.classes[lname]; const subjects = Object.keys(state.offerings[lname]);
  const students = Object.keys(state.marks[lname][T[0].id][subjects[0]]);
  const partsOf = (tid, sub, name) => state.marks[lname][tid][sub][name]; // {theory:{value,max}, practical?}
  const obtained = (tid, sub, name) => Object.values(partsOf(tid, sub, name)).reduce((a, p) => a + (p.value ?? 0), 0);
  const fullOf = (sub) => state.offerings[lname][sub].full * 100;
  const hasPrac = (sub) => !!state.offerings[lname][sub].practical;

  for (const [ti, terminal] of [...T.map((t, i) => [i, t]), [2, null]]) {
    const isFinal = terminal === null;
    const sheetUrl = isFinal ? `/api/results/classes/${cls.id}/final/sheet` : `/api/results/classes/${cls.id}/terminals/${terminal.id}/sheet`;
    const ledgerUrl = isFinal ? `/api/results/classes/${cls.id}/final/ledger` : `/api/results/classes/${cls.id}/terminals/${terminal.id}/ledger`;
    const sheet = (await coord.get(sheetUrl)).json; const ledger = (await coord.get(ledgerUrl)).json;
    const label = `${lname} ${isFinal ? "final" : terminal.name}`;

    // expected per student: per-subject (obtained, full, grade, point), totals
    const exp = {};
    for (const name of students) {
      const lines = {};
      for (const sub of subjects) {
        let obt, full, failed = false;
        if (!isFinal) {
          obt = obtained(terminal.id, sub, name); full = fullOf(sub);
          const p = partsOf(terminal.id, sub, name); const prac = state.offerings[lname][sub].practical;
          if ((p.theory.value ?? 0) < passTheory(state.offerings[lname][sub].full, prac)) failed = true;
          if (prac && (p.practical.value ?? 0) < prac * 40) failed = true;
        } else {
          // each subject out of 100: the exams' marks scaled by their weights, summed
          let num = 0n; let thGot = 0n, thPass = 0n, prGot = 0n, prPass = 0n, hasPr = false; // exact fractions over a common denominator
          const den = BigInt(T.map((t) => fullOf(sub)).reduce((a, b) => a * b / gcd(a, b), 1));
          for (const t of T) {
            const f = BigInt(fullOf(sub)), w = BigInt(W[t.id]); const p = partsOf(t.id, sub, name);
            const th = BigInt(p.theory.value ?? 0), tpass = BigInt(passTheory(state.offerings[lname][sub].full, state.offerings[lname][sub].practical));
            const tot = BigInt(obtained(t.id, sub, name));
            num += tot * w * 10000n / f; // hundredths of marks out of 100, times 100 (kept exact below)
            thGot += th * w * den / f; thPass += tpass * w * den / f;
            if (p.practical) { hasPr = true; prGot += BigInt(p.practical.value ?? 0) * w * den / f; prPass += BigInt(state.offerings[lname][sub].practical * 40) * w * den / f; }
          }
          // exact: sum of tot*w/f in marks = hundredths; recompute with rationals
          let r = 0n, rd = 1n; for (const t of T) { const f = BigInt(fullOf(sub)); r = r * f + BigInt(obtained(t.id, sub, name)) * BigInt(W[t.id]) * rd; rd = rd * f; }
          obt = Number((2n * r * 1n + rd) / (2n * rd)); // hundredths out of 100 -> whole "marks hundredths" = r/rd (already weight-scaled marks), so marks*100 hundredths:
          obt = Number((2n * r * 100n + rd) / (2n * rd)); full = 10000;
          failed = thGot < thPass || (hasPr && prGot < prPass);
        }
        const [g, pt] = failed ? ["NG", 0] : band(obt, full);
        lines[sub] = { obt, full, g, pt };
      }
      const totObt = subjects.reduce((a, s) => a + lines[s].obt, 0), totFull = subjects.reduce((a, s) => a + lines[s].full, 0);
      exp[name] = { lines, totObt, totFull, anyNG: subjects.some((s) => lines[s].g === "NG") };
    }
    const ranks = denseRank(students.map((n) => ({ id: n, obt: exp[n].totObt, full: exp[n].totFull })));
    const highest = Object.fromEntries(subjects.map((s) => [s, Math.max(...students.map((n) => exp[n].lines[s].pt))]));

    // the ledger
    eq(`${label}: ledger students`, ledger.students.length, students.length);
    for (const row of ledger.students) {
      const name = norm(row.name); const e = exp[name]; if (!e) { fails.push(`${label}: ledger has unexpected ${name}`); continue; }
      eq(`${label}: ledger total ${name}`, row.totalHundredths, e.totObt);
      eq(`${label}: ledger rank ${name}`, row.rank, ranks[name]);
      eq(`${label}: ledger percent ${name}`, row.percentHundredths, pctH(e.totObt, e.totFull));
      ledger.subjects.forEach((s, i) => { const want = e.lines[Object.keys(state.offerings[lname]).find((k) => state.offerings[lname][k].id === s.offeringId)]; eq(`${label}: ledger ${name} ${s.name}`, row.marks[i]?.valueHundredths, want?.obt); });
    }
    eq(`${label}: ledger columns follow setup order`, ledger.subjects.map((s) => s.name), subjects);
    // ledger ranks (Aaron Late is in the ledger too, so rank over all)
    // each card
    for (const row of sheet.students) {
      const name = norm(row.name); const e = exp[name]; if (!e) continue;
      const g = (await coord.get(`/api/results/grade-sheets/${row.cardId}`)).json;
      eq(`${label}: ${name} total obtained`, g.totalObtainedHundredths, e.totObt);
      eq(`${label}: ${name} total full`, g.totalFullHundredths, e.totFull);
      eq(`${label}: ${name} percentage`, g.percentHundredths, pctH(e.totObt, e.totFull));
      eq(`${label}: ${name} division`, g.division, e.anyNG ? null : division(e.totObt, e.totFull));
      eq(`${label}: ${name} overall grade`, g.overallGrade, band(e.totObt, e.totFull)[0]);
      const sumPt = subjects.reduce((a, s) => a + e.lines[s].pt, 0); eq(`${label}: ${name} average GP`, g.averagePointTenths, Math.floor((2 * sumPt + 10 * subjects.length) / (20 * subjects.length)));
      for (const l of g.subjects) {
        const sub = subjects.find((k) => state.offerings[lname][k].id === l.offeringId); const x = e.lines[sub];
        eq(`${label}: ${name} ${sub} obtained`, l.obtainedHundredths, x.obt); eq(`${label}: ${name} ${sub} full`, l.fullHundredths, x.full);
        eq(`${label}: ${name} ${sub} grade`, [l.finalGrade, l.pointHundredths], [x.g, x.pt]); eq(`${label}: ${name} ${sub} highest GP`, l.highestPointHundredths, highest[sub]);
        if (!isFinal) { const p = partsOf(terminal.id, sub, name); eq(`${label}: ${name} ${sub} TH`, l.theory?.valueHundredths ?? null, p.theory.value ?? null); if (p.practical) eq(`${label}: ${name} ${sub} PR`, l.practical?.valueHundredths ?? null, p.practical.value ?? null); }
      }
      eq(`${label}: ${name} rank`, g.rank, ranks[name]);
      eq(`${label}: ${name} class size`, g.classSize, students.length);
    }
  }
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
console.log(`${pass} figures agree with the independent calculation`);
if (fails.length) { console.log(`${fails.length} DISAGREE:`); fails.slice(0, 40).forEach((f) => console.log("  - " + f)); }
