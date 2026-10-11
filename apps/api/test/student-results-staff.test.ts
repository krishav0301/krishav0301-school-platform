import { beforeAll, describe, expect, it } from "vitest";

import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, examTerm, pattern, resultsClass, sheetIdOf, type Subject } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * A student's published results, read by staff (the PM, 2026-10-11): the Principal opens a student's record and sees each
 * published exam and the final result with a link to the marks card. Only staff whose wings reach the student's class;
 * anyone else, and a student who is not there, get "not found".
 */

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, teacher: Person;
let fixture: ClassFixture, unpublished: ClassFixture;
let maths: Subject;

beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  const terms = await examTerm(pattern(false, [{ name: "First", weight: 40, hasPractical: false }, { name: "Final", weight: 60, hasPractical: false }]));
  fixture = await resultsClass("plus2", 2, terms);
  unpublished = await resultsClass("plus2", 1, terms);
  maths = await addSubject(fixture);
  const first = terms.terminals[0]!;
  await enterAndSubmit(fixture, maths, first, (p) => [90, 55][p]!);
  const sheet = await sheetIdOf(fixture, maths, first);
  await call("/api/results/review/verify", { method: "POST", body: { sheetIds: [sheet] }, cookie: coordinator.cookie });
  const published = await call(`/api/results/classes/${fixture.classId}/publish`, { method: "POST", body: { terminalId: first }, cookie: coordinator.cookie });
  expect(published.status).toBe(201);
});

type Results = { results: { kind: "terminal" | "final"; terminalName: string | null; yearLabel: string; card: { id: string; body: { student: { name: string } } } }[] };
const read = (studentId: string, who: Person) => call(`/api/results/students/${studentId}`, { cookie: who.cookie });

describe("a student's published results, for staff", () => {
  it("the Principal sees the published exam with its marks card, and not an exam that is not published", async () => {
    const response = await read(fixture.pupils[0]!.studentId, admin);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Results;
    expect(body.results).toHaveLength(1); // First is out; the Final is not published yet
    expect(body.results[0]).toMatchObject({ kind: "terminal", terminalName: "First" });
    expect(typeof body.results[0]!.card.id).toBe("string");
    // The card link works for the same person.
    expect((await call(`/api/results/cards/${body.results[0]!.card.id}`, { cookie: admin.cookie })).status).toBe(200);
  });

  it("each student has only their own results", async () => {
    const a = (await (await read(fixture.pupils[0]!.studentId, coordinator)).json()) as Results;
    const b = (await (await read(fixture.pupils[1]!.studentId, coordinator)).json()) as Results;
    expect(a.results[0]!.card.body.student.name).not.toBe(b.results[0]!.card.body.student.name);
  });

  it("a student whose class is not published yet has an empty list, not an error", async () => {
    const response = await read(unpublished.pupils[0]!.studentId, admin);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Results).results).toEqual([]);
  });

  it("a wing the person does not reach, and an unknown student, are both not found", async () => {
    expect((await read(fixture.pupils[0]!.studentId, plus2Coordinator)).status).toBe(200);
    expect((await read(fixture.pupils[0]!.studentId, bachelorsCoordinator)).status).toBe(404);
    expect((await read("0".repeat(32), admin)).status).toBe(404);
  });

  it("the Accountant and a teacher may not read it, and a student cannot read another's", async () => {
    expect((await read(fixture.pupils[0]!.studentId, accountant)).status).toBe(403);
    expect((await read(fixture.pupils[0]!.studentId, teacher)).status).toBe(403);
    expect((await read(fixture.pupils[0]!.studentId, fixture.pupils[1]!.person)).status).toBe(404);
  });
});

describe("it is a read only", () => {
  it("nothing is written by reading", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>())!.n;
    await read(fixture.pupils[0]!.studentId, admin);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>())!.n).toBe(before);
  });
});
