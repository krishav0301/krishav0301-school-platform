import { beforeAll, describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, examTerm, pattern, resultsClass, runTerminal } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * The grade-point marks card and the mark ledger through the real routes (the PM, 2026-10-28, the first school). A school
 * whose file has the layout gets both from the stored cards; a student reads only their own card; one without the layout
 * gets nothing new. Fixed rules: Student A cannot open Student B's card; a student cannot read a class ledger.
 */

let coordinator: Person;
let fixture: ClassFixture;
let terminalId: string;
const layout = JSON.stringify(parsePack(lahanJson).school.gradeSheet);

const setLayout = (json: string | null) =>
  db.prepare("INSERT INTO school (id, name, short_name, grade_sheet_json) VALUES (1, 'Test school', 'Test', ?1) ON CONFLICT (id) DO UPDATE SET grade_sheet_json = excluded.grade_sheet_json").bind(json).run();

interface Own {
  results: { kind: "terminal" | "final"; card: { id: string } }[];
}
/** The one terminal's card (the class has one terminal, so its final came out with it), or the final's. */
const cardIdOf = async (pupil: number, kind: "terminal" | "final" = "terminal") =>
  ((await (await call("/api/results/me", { cookie: fixture.pupils[pupil]!.person.cookie })).json()) as Own).results.find((r) => r.kind === kind)!.card.id;
const sheetOf = (cardId: string, who: Person) => call(`/api/results/grade-sheets/${cardId}`, { cookie: who.cookie });

beforeAll(async () => {
  await seedSections();
  await setLayout(layout);
  coordinator = await person("coordinator", "institution");
  const term = await examTerm(pattern(false, [{ name: "First Terminal Examination", weight: 100, hasPractical: false }]));
  terminalId = term.terminals[0]!;
  fixture = await resultsClass("plus2", 3, term);
  const english = await addSubject(fixture, { full: 100 });
  const maths = await addSubject(fixture, { full: 50 });
  // Pupil 0: 90 and 45 of 50 (90); pupil 1: 70 and 35; pupil 2: 50 and 25.
  const percents = [90, 70, 50];
  const published = await runTerminal(fixture, [english, maths], terminalId, (p) => percents[p]!, coordinator);
  expect(published.status).toBe(201);
});

describe("the grade sheet of a card", () => {
  it("is the student's own card, with the school's words, grade points, the class's highest, percentage, average and rank", async () => {
    const response = await sheetOf(await cardIdOf(0), fixture.pupils[0]!.person);
    expect(response.status).toBe(200);
    const sheet = (await response.json()) as { school: { name: string; address: string }; examName: string; student: { name: string }; subjects: { name: string; finalGrade: string; pointHundredths: number; highestPointHundredths: number }[]; totalObtainedHundredths: number; totalFullHundredths: number; percentHundredths: number; averagePointTenths: number; rank: number; classSize: number; division: string; scale: unknown[] };
    expect(sheet.school).toMatchObject({ address: "Lahan Municipality-8, Siraha" });
    expect(sheet.examName).toBe("First Terminal Examination");
    expect(sheet.subjects).toHaveLength(2);
    // 90 per cent is an A on the shared cards (a mark on a band's number stays in the band below).
    expect(sheet.subjects.map((s) => [s.finalGrade, s.pointHundredths, s.highestPointHundredths])).toEqual([["A", 360, 360], ["A", 360, 360]]);
    expect([sheet.totalObtainedHundredths, sheet.totalFullHundredths, sheet.percentHundredths]).toEqual([13_500, 15_000, 9000]);
    expect([sheet.averagePointTenths, sheet.rank, sheet.classSize, sheet.division]).toEqual([36, 1, 3, "Distinction"]);
    expect(sheet.scale).toHaveLength(8);
    expect((sheet as unknown as { paper: string }).paper).toBe("accent");
  });

  it("on the final result is out of 100 a subject, with no exam name", async () => {
    const sheet = (await (await sheetOf(await cardIdOf(0, "final"), fixture.pupils[0]!.person)).json()) as { examName: string | null; totalFullHundredths: number; subjects: { fullHundredths: number; theory: unknown }[] };
    expect(sheet.examName).toBeNull();
    expect(sheet.totalFullHundredths).toBe(20_000);
    expect(sheet.subjects.map((s) => [s.fullHundredths, s.theory])).toEqual([[10_000, null], [10_000, null]]);
  });

  it("shows the roll number the student has now, even if it was given after the class was published", async () => {
    await db.prepare("UPDATE enrollments SET roll_no = 17 WHERE public_id = ?1").bind(fixture.pupils[0]!.enrollmentId).run();
    const sheet = (await (await sheetOf(await cardIdOf(0), fixture.pupils[0]!.person)).json()) as { student: { rollNo: number | null } };
    expect(sheet.student.rollNo).toBe(17);
    await db.prepare("UPDATE enrollments SET roll_no = NULL WHERE public_id = ?1").bind(fixture.pupils[0]!.enrollmentId).run(); // the other tests do not number the class
  });

  it("is refused to another student (they get what a missing card gets), and read by the Co-ordinator", async () => {
    const first = await cardIdOf(0);
    expect((await sheetOf(first, fixture.pupils[1]!.person)).status).toBe(404);
    expect((await sheetOf(first, coordinator)).status).toBe(200);
    expect((await sheetOf("0".repeat(32), coordinator)).status).toBe(404);
  });

  it("is not there for a school whose file has no such layout", async () => {
    await setLayout(null);
    expect((await sheetOf(await cardIdOf(0), coordinator)).status).toBe(404);
    await setLayout(layout);
  });
});

describe("the mark ledger of a class", () => {
  const ledgerPath = () => `/api/results/classes/${fixture.classId}/terminals/${terminalId}/ledger`;

  it("lists every student by roll number with the marks, the total, the percentage and the rank", async () => {
    const response = await call(ledgerPath(), { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    const ledger = (await response.json()) as { examName: string; className: string; subjects: { name: string }[]; students: { rollNo: number | null; totalHundredths: number; percentHundredths: number; rank: number; marks: ({ valueHundredths: number } | null)[] }[] };
    expect(ledger.examName).toBe("First Terminal Examination");
    expect(ledger.subjects).toHaveLength(2);
    expect(ledger.students.map((s) => s.rank)).toEqual([1, 2, 3]);
    expect(ledger.students.map((s) => s.totalHundredths)).toEqual([13_500, 10_500, 7_500]);
    expect(ledger.students.map((s) => s.percentHundredths)).toEqual([9000, 7000, 5000]);
    expect(ledger.students[0]!.marks.map((m) => m!.valueHundredths)).toEqual([9000, 4500]);
    const rolls = ledger.students.map((s) => s.rollNo ?? 0);
    expect(rolls).toEqual([...rolls].sort((a, b) => a - b));
  });

  it("is not for a student, and is not there for a school without the layout", async () => {
    expect((await call(ledgerPath(), { cookie: fixture.pupils[0]!.person.cookie })).status).toBe(403);
    await setLayout(null);
    expect((await call(ledgerPath(), { cookie: coordinator.cookie })).status).toBe(404);
    await setLayout(layout);
  });

  it("the final result has its own ledger, out of 100 a subject", async () => {
    const response = await call(`/api/results/classes/${fixture.classId}/final/ledger`, { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { examName: string | null }).examName).toBeNull();
  });
});
