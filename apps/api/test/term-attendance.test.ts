import { beforeAll, describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { attendanceOf } from "../src/modules/results/gradesheet";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, examTerm, pattern, resultsClass, runTerminal } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * The Class Teacher's attendance for an exam's marks card (the PM, 2026-11-10): the class's working days, each student's days
 * present, the percentage on the grade-point card. Who may give it is written by hand: the Class Teacher of the class and
 * Support only; another class's Class Teacher, a subject teacher, the Co-ordinator, the Principal, the Accountant and a student
 * may not.
 */
let coordinator: Person, principal: Person, accountant: Person, support: Person;
let a: ClassFixture, b: ClassFixture;
let terminalId: string;

const path = (c: ClassFixture) => `/api/results/classes/${c.classId}/terminals/${terminalId}/attendance`;
const put = (c: ClassFixture, who: Person | null, body: unknown) =>
  call(path(c), { method: "PUT", ...(who ? { cookie: who.cookie } : {}), body });
const give = (c: ClassFixture, who: Person | null, workingDays: number, present: (number | null)[]) =>
  put(c, who, { workingDays, students: c.pupils.map((p, i) => ({ enrollmentId: p.enrollmentId, daysPresent: present[i] ?? null })) });
const read = async (c: ClassFixture, who: Person) => (await call(path(c), { cookie: who.cookie })).json() as Promise<{ workingDays: number | null; locked: boolean; students: { enrollmentId: string; daysPresent: number | null }[] }>;
const sheetOf = async (c: ClassFixture, i: number) => {
  const card = ((await (await call("/api/results/me", { cookie: c.pupils[i]!.person.cookie })).json()) as { results: { kind: string; card: { id: string } }[] }).results.find((r) => r.kind === "terminal")!.card.id;
  return (await (await call(`/api/results/grade-sheets/${card}`, { cookie: c.pupils[i]!.person.cookie })).json()) as { attendance: { workingDays: number; presentDays: number; percentHundredths: number } | null };
};

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
  const term = await examTerm(pattern(false, [{ name: "Second Terminal", weight: 100, hasPractical: false }]));
  terminalId = term.terminals[0]!;
  a = await resultsClass("plus2", 3, term);
  b = await resultsClass("plus2", 2, term);
  const science = await addSubject(a, { full: 100 });
  const bScience = await addSubject(b, { full: 100 });
  expect((await runTerminal(a, [science], terminalId, 80, coordinator)).status).toBe(201);
  expect((await runTerminal(b, [bScience], terminalId, 80, coordinator)).status).toBe(201);
});

describe("the percentage", () => {
  it("is the days present over the working days, to hundredths, half up", () => {
    expect(attendanceOf({ workingDays: 200, presentDays: 187 })).toEqual({ workingDays: 200, presentDays: 187, percentHundredths: 9350 });
    expect(attendanceOf({ workingDays: 3, presentDays: 2 })?.percentHundredths).toBe(6667);
    expect(attendanceOf({ workingDays: 90, presentDays: 90 })?.percentHundredths).toBe(10_000);
    expect(attendanceOf({ workingDays: 90, presentDays: 0 })?.percentHundredths).toBe(0);
  });
  it("is nothing when there is nothing to divide by, and never goes above 100", () => {
    expect(attendanceOf(null)).toBeNull();
    expect(attendanceOf({ workingDays: 0, presentDays: 0 })).toBeNull();
    expect(attendanceOf({ workingDays: 10, presentDays: 12 })?.percentHundredths).toBe(10_000);
  });
});

describe("giving the attendance", () => {
  it("starts empty", async () => {
    const got = await read(a, a.classTeacher);
    expect(got.workingDays).toBeNull();
    expect(got.students).toHaveLength(3);
    expect(got.students.every((s) => s.daysPresent === null)).toBe(true);
    expect((await sheetOf(a, 0)).attendance).toBeNull();
  });

  it("is saved by the Class Teacher and shows on each student's card as a percentage", async () => {
    expect((await give(a, a.classTeacher, 200, [180, 150, null])).status).toBe(200);
    const got = await read(a, a.classTeacher);
    expect(got.workingDays).toBe(200);
    expect(got.students.map((s) => s.daysPresent)).toEqual([180, 150, null]);
    expect((await sheetOf(a, 0)).attendance).toEqual({ workingDays: 200, presentDays: 180, percentHundredths: 9000 });
    expect((await sheetOf(a, 1)).attendance).toEqual({ workingDays: 200, presentDays: 150, percentHundredths: 7500 });
    // Working days without a student's days: nothing to print for that student.
    expect((await sheetOf(a, 2)).attendance).toBeNull();
    // Another class is untouched.
    expect((await sheetOf(b, 0)).attendance).toBeNull();
  });

  it("can be corrected: sending it again replaces it, and a student sent with no days has none", async () => {
    expect((await give(a, a.classTeacher, 190, [190, null, 0])).status).toBe(200);
    expect((await read(a, a.classTeacher)).students.map((s) => s.daysPresent)).toEqual([190, null, 0]);
    expect((await sheetOf(a, 0)).attendance?.percentHundredths).toBe(10_000);
    expect((await sheetOf(a, 1)).attendance).toBeNull();
    expect((await sheetOf(a, 2)).attendance).toEqual({ workingDays: 190, presentDays: 0, percentHundredths: 0 });
  });

  it("refuses more days present than working days, whole numbers outside 0 to 366, and a student listed twice (400: the shape is wrong) or from another class (422)", async () => {
    expect((await give(a, a.classTeacher, 100, [101, 5, 5])).status).toBe(400);
    expect((await give(a, a.classTeacher, 0, [0, 0, 0])).status).toBe(400);
    expect((await give(a, a.classTeacher, 367, [1, 1, 1])).status).toBe(400);
    expect((await give(a, a.classTeacher, 100, [-1, 1, 1])).status).toBe(400);
    expect((await put(a, a.classTeacher, { workingDays: 100.5, students: [] })).status).toBe(400);
    const first = a.pupils[0]!.enrollmentId;
    expect((await put(a, a.classTeacher, { workingDays: 100, students: [{ enrollmentId: first, daysPresent: 1 }, { enrollmentId: first, daysPresent: 2 }] })).status).toBe(400);
    expect((await put(a, a.classTeacher, { workingDays: 100, students: [{ enrollmentId: b.pupils[0]!.enrollmentId, daysPresent: 1 }] })).status).toBe(422);
    // Nothing above changed what was given.
    expect((await read(a, a.classTeacher)).workingDays).toBe(190);
  });

  it("leaves a trail: the audit log records who gave it", async () => {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.term_attendance.saved' AND entity_public_id = ?1").bind(a.classId).first<{ n: number }>();
    expect(row!.n).toBeGreaterThanOrEqual(2);
  });
});

describe("who may give it", () => {
  it("is the class's own Class Teacher and Support; nobody else", async () => {
    const body = (c: ClassFixture) => [190, 100, 100].slice(0, c.pupils.length);
    expect((await give(a, support, 190, body(a))).status).toBe(200);
    for (const who of [coordinator, principal, accountant]) {
      expect((await give(a, who, 190, body(a))).status, "write").toBe(403);
      expect((await call(path(a), { cookie: who.cookie })).status, "read").toBe(403);
    }
  });
  it("is 404 for the Class Teacher of another class, and 403 for a student and 401 for the public", async () => {
    // Another class's Class Teacher holds the right, but not for this class.
    expect((await give(a, b.classTeacher, 190, [1, 1, 1])).status).toBe(404);
    expect((await call(path(a), { cookie: b.classTeacher.cookie })).status).toBe(404);
    expect((await give(a, a.pupils[0]!.person, 190, [1, 1, 1])).status).toBe(403);
    expect((await give(a, null, 190, [1, 1, 1])).status).toBe(401);
    expect((await call(path(a), { cookie: a.pupils[0]!.person.cookie })).status).toBe(403);
  });
  it("is refused once the class's year is closed", async () => {
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-11-10T00:00:00Z' WHERE id = (SELECT academic_year_id FROM classes WHERE public_id = ?1)").bind(b.classId).run();
    expect((await give(b, b.classTeacher, 100, [1, 1])).status).toBe(409);
    expect((await read(b, b.classTeacher)).locked).toBe(true);
  });
});
