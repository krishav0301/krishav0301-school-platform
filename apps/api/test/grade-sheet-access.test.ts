import { beforeAll, describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, examTerm, pattern, resultsClass, runTerminal, type Subject } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * Who opens what, in a school with Lahan's settings: the grade-point marks card, the class mark ledger, the class result
 * sheet, and giving a class its roll numbers. Written by hand from the requirements (the PM, 2026-10-29), role by role, and
 * checked against the real routes: 200 yes; 403 the role has no such right; 404 the role has the right but not for this
 * record (someone else's card, a class they do not lead); 401 not signed in.
 */
let student: Person, otherStudent: Person, classTeacher: Person, subjectTeacher: Person, otherClassTeacher: Person;
let coordinator: Person, principal: Person, accountant: Person, support: Person;
let a: ClassFixture, b: ClassFixture, science: Subject;
let terminalId: string;
let ownCard: string, classmatesCard: string;

const anyone = (who: Person | null) => (who ? { cookie: who.cookie } : {});
const status = async (path: string, who: Person | null, method = "GET") => (await call(path, { method, ...anyone(who) })).status;

beforeAll(async () => {
  await seedSections();
  await db
    .prepare("INSERT INTO school (id, name, short_name, grade_sheet_json) VALUES (1, 'Lahan', 'Lahan', ?1) ON CONFLICT (id) DO UPDATE SET grade_sheet_json = excluded.grade_sheet_json")
    .bind(JSON.stringify(parsePack(lahanJson).school.gradeSheet))
    .run();
  coordinator = await person("coordinator", "institution");
  principal = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  support = await person("super_admin", "institution");
  const term = await examTerm(pattern(false, [{ name: "First Terminal Examination", weight: 100, hasPractical: false }]));
  terminalId = term.terminals[0]!;
  a = await resultsClass("plus2", 3, term);
  b = await resultsClass("plus2", 2, term);
  science = await addSubject(a, { full: 100 });
  const bScience = await addSubject(b, { full: 100 });
  expect((await runTerminal(a, [science], terminalId, 80, coordinator)).status).toBe(201);
  expect((await runTerminal(b, [bScience], terminalId, 80, coordinator)).status).toBe(201);
  student = a.pupils[0]!.person;
  otherStudent = a.pupils[1]!.person;
  classTeacher = a.classTeacher;
  subjectTeacher = science.teacher;
  otherClassTeacher = b.classTeacher;
  const cardOf = async (c: ClassFixture, i: number) =>
    ((await (await call("/api/results/me", { cookie: c.pupils[i]!.person.cookie })).json()) as { results: { kind: string; card: { id: string } }[] }).results.find((r) => r.kind === "terminal")!.card.id;
  ownCard = await cardOf(a, 0);
  classmatesCard = await cardOf(a, 1);
});

const cardPath = () => `/api/results/grade-sheets/${ownCard}`;
const ledgerPath = () => `/api/results/classes/${a.classId}/terminals/${terminalId}/ledger`;
const sheetPath = () => `/api/results/classes/${a.classId}/terminals/${terminalId}/sheet`;

describe("a student's own marks card", () => {
  it("is the student's alone: nobody else in the class, not a subject teacher who teaches them, not the Accountant", async () => {
    expect(await status(cardPath(), student)).toBe(200);
    expect(await status(cardPath(), otherStudent)).toBe(404);
    expect(await status(cardPath(), null)).toBe(401);
  });

  it("the Class Teacher of the class, the Co-ordinator, the Principal and Support open it", async () => {
    for (const who of [classTeacher, coordinator, principal, support]) expect(await status(cardPath(), who)).toBe(200);
  });

  it("a subject teacher who does not lead the class, and another class's Class Teacher, find nothing; the Accountant has no right to it", async () => {
    expect(await status(cardPath(), subjectTeacher)).toBe(404);
    expect(await status(cardPath(), otherClassTeacher)).toBe(404);
    expect(await status(cardPath(), accountant)).toBe(403);
  });

  it("every other card of the class opens for the same people, and a student's own is still theirs", async () => {
    expect(await status(`/api/results/grade-sheets/${classmatesCard}`, classTeacher)).toBe(200);
    expect(await status(`/api/results/grade-sheets/${classmatesCard}`, student)).toBe(404);
    expect(await status(`/api/results/grade-sheets/${classmatesCard}`, otherStudent)).toBe(200);
  });
});

describe("the class mark ledger and the class result sheet", () => {
  it("are for the Class Teacher of that class, the Co-ordinator, the Principal and Support", async () => {
    for (const path of [ledgerPath(), sheetPath()]) for (const who of [classTeacher, coordinator, principal, support]) expect(await status(path, who), path).toBe(200);
  });

  it("are not for a student (403), a subject teacher who leads no such class or another class's Class Teacher (404), the Accountant (403) or the public (401)", async () => {
    for (const path of [ledgerPath(), sheetPath()]) {
      expect(await status(path, student), path).toBe(403);
      expect(await status(path, subjectTeacher), path).toBe(404);
      expect(await status(path, otherClassTeacher), path).toBe(404);
      expect(await status(path, accountant), path).toBe(403);
      expect(await status(path, null), path).toBe(401);
    }
  });
});

describe("giving a class its roll numbers", () => {
  it("is the Co-ordinator's, and Support's: nobody else, not even the Principal or the Class Teacher", async () => {
    const forCoordinator = a.classId;
    const forSupport = b.classId;
    const give = (classId: string, who: Person | null) => status(`/api/classes/${classId}/roll-numbers`, who, "POST");
    for (const who of [student, classTeacher, subjectTeacher, principal, accountant]) expect(await give(forCoordinator, who)).toBe(403);
    expect(await give(forCoordinator, null)).toBe(401);
    expect(await give(forCoordinator, coordinator)).toBe(200);
    expect(await give(forSupport, support)).toBe(200);
  });
});
