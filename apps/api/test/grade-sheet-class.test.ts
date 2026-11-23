import { beforeAll, describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, examTerm, pattern, resultsClass, runTerminal, type Term } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * The whole class's marks cards in one read, for one PDF of every student's GRADE-SHEET (the PM, 2026-11-23, D-195). The same
 * people as the mark ledger: the class's own Class Teacher, the Co-ordinator, the Principal (and Support). Every sheet is exactly
 * the card one student's own download gives, in roll-number order. Fixed rules, written from the request: a student cannot read
 * it; a Class Teacher gets nothing for another class; a Co-ordinator of the other wing gets nothing.
 */
const layout = JSON.stringify(parsePack(lahanJson).school.gradeSheet);
const setLayout = (json: string | null) =>
  db.prepare("INSERT INTO school (id, name, short_name, grade_sheet_json) VALUES (1, 'Test school', 'Test', ?1) ON CONFLICT (id) DO UPDATE SET grade_sheet_json = excluded.grade_sheet_json").bind(json).run();

let coordinator: Person, otherWing: Person, admin: Person, accountant: Person, teacher: Person;
let term: Term, terminalId: string;
let a: ClassFixture, b: ClassFixture;

interface Sheet {
  cardId: string;
  examName: string | null;
  student: { name: string; rollNo: number | null };
  attendance: { workingDays: number; presentDays: number } | null;
  rank: number;
}
const path = (c: ClassFixture, final = false) => (final ? `/api/results/classes/${c.classId}/final/grade-sheets` : `/api/results/classes/${c.classId}/terminals/${terminalId}/grade-sheets`);
const ledger = (c: ClassFixture, final = false) => (final ? `/api/results/classes/${c.classId}/final/ledger` : `/api/results/classes/${c.classId}/terminals/${terminalId}/ledger`);
const sheetsOf = async (c: ClassFixture, who: Person, final = false) => ((await (await call(path(c, final), { cookie: who.cookie })).json()) as { sheets: Sheet[] }).sheets;
const cardOf = async (c: ClassFixture, i: number, kind: "terminal" | "final") =>
  ((await (await call("/api/results/me", { cookie: c.pupils[i]!.person.cookie })).json()) as { results: { kind: string; card: { id: string } }[] }).results.find((r) => r.kind === kind)!.card.id;
const ownSheet = async (c: ClassFixture, i: number, kind: "terminal" | "final") => (await (await call(`/api/results/grade-sheets/${await cardOf(c, i, kind)}`, { cookie: c.pupils[i]!.person.cookie })).json()) as Sheet;

beforeAll(async () => {
  await seedSections();
  await setLayout(layout);
  coordinator = await person("coordinator", "institution");
  otherWing = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  term = await examTerm(pattern(false, [{ name: "First Terminal Examination", weight: 100, hasPractical: false }]));
  terminalId = term.terminals[0]!;
  a = await resultsClass("plus2", 4, term);
  b = await resultsClass("plus2", 2, term);
  const english = await addSubject(a, { full: 100 });
  const maths = await addSubject(a, { full: 50 });
  const bEnglish = await addSubject(b, { full: 100 });
  const pct = [55, 90, 70, 90];
  expect((await runTerminal(a, [english, maths], terminalId, (p) => pct[p]!, coordinator)).status).toBe(201);
  expect((await runTerminal(b, [bEnglish], terminalId, 60, coordinator)).status).toBe(201);
  // Roll numbers the other way round from the order the students were made, so the order is the roll's, not the database's.
  for (const [i, roll] of [4, 3, 2, 1].entries()) await db.prepare("UPDATE enrollments SET roll_no = ?1 WHERE public_id = ?2").bind(roll, a.pupils[i]!.enrollmentId).run();
  // The Class Teacher gives attendance for the exam, so the cards carry it.
  const given = await call(`/api/results/classes/${a.classId}/terminals/${terminalId}/attendance`, {
    method: "PUT",
    cookie: a.classTeacher.cookie,
    body: { workingDays: 100, students: a.pupils.map((p, i) => ({ enrollmentId: p.enrollmentId, daysPresent: [90, 80, null, 100][i] ?? null })) },
  });
  expect(given.status).toBe(200);
});

describe("the whole class's marks cards", () => {
  it("are every student's card, in roll-number order, each exactly the card the student's own download gives", async () => {
    const response = await call(path(a), { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const sheets = ((await response.json()) as { sheets: Sheet[] }).sheets;
    expect(sheets.map((s) => s.student.rollNo)).toEqual([1, 2, 3, 4]);
    for (const [i, roll] of [4, 3, 2, 1].entries()) expect(sheets[roll - 1]).toEqual(await ownSheet(a, i, "terminal"));
    // Ties share a rank, the attendance is the one given, and a student without days has none.
    expect(sheets.map((s) => s.rank)).toEqual([1, 2, 1, 3]);
    expect(sheets.map((s) => s.attendance?.presentDays ?? null)).toEqual([100, null, 80, 90]);
  });

  it("for the final result too, each out of 100 a subject with no exam name, matching the student's own final card", async () => {
    const sheets = await sheetsOf(a, coordinator, true);
    expect(sheets).toHaveLength(4);
    expect(sheets.every((s) => s.examName === null)).toBe(true);
    for (const [i, roll] of [4, 3, 2, 1].entries()) expect(sheets[roll - 1]).toEqual(await ownSheet(a, i, "final"));
  });

  it("only the other class's own students are on the other class's cards", async () => {
    const sheets = await sheetsOf(b, coordinator);
    expect(sheets).toHaveLength(2);
    expect(sheets.map((s) => s.student.name).sort()).toEqual((await Promise.all([0, 1].map((i) => ownSheet(b, i, "terminal")))).map((s) => s.student.name).sort());
  });
});

describe("who may download them (the PM: the Class Teacher, the Principal and the Co-ordinator)", () => {
  it("the class's own Class Teacher, the Co-ordinator and the Principal read them", async () => {
    for (const who of [a.classTeacher, coordinator, admin]) {
      expect((await call(path(a), { cookie: who.cookie })).status).toBe(200);
      expect((await call(path(a, true), { cookie: who.cookie })).status).toBe(200);
    }
  });

  it("another class's Class Teacher and the other wing's Co-ordinator get what a missing class gets", async () => {
    expect((await call(path(a), { cookie: b.classTeacher.cookie })).status).toBe(404);
    expect((await call(path(a, true), { cookie: b.classTeacher.cookie })).status).toBe(404);
    expect((await call(path(a), { cookie: otherWing.cookie })).status).toBe(404);
  });

  it("a student and the Accountant are refused, and a subject teacher gets what the ledger gives them", async () => {
    expect((await call(path(a), { cookie: a.pupils[0]!.person.cookie })).status).toBe(403);
    expect((await call(path(a), { cookie: accountant.cookie })).status).toBe(403);
    const fromLedger = (await call(ledger(a), { cookie: teacher.cookie })).status;
    expect(fromLedger).not.toBe(200);
    expect((await call(path(a), { cookie: teacher.cookie })).status).toBe(fromLedger);
  });
});

describe("what is not there", () => {
  it("a school without the layout, an exam not published and a class that does not exist get not found", async () => {
    await setLayout(null);
    expect((await call(path(a), { cookie: coordinator.cookie })).status).toBe(404);
    await setLayout(layout);
    expect((await call(`/api/results/classes/${a.classId}/terminals/${"0".repeat(32)}/grade-sheets`, { cookie: coordinator.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/${"0".repeat(32)}/final/grade-sheets`, { cookie: coordinator.cookie })).status).toBe(404);
  });
});
