import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, resultsClass, sheetIdOf, terminal, type Subject } from "./results-helpers";
import { setModule, type ClassFixture } from "./schoolday-helpers";

/**
 * What people read (Phase 7, slice 4, D-082) and rechecks (slice 5, D-083). CLAUDE.md section 6: Top 20 is name and
 * rank only for students, ranked per section, only after the class is published; published marks cards are snapshots.
 * Section 9: ties share a rank; the Admin is told of every post-publish change, with a required reason; Top 20 is shown
 * to students. Source 6.3: the whole-class sheet with totals and rank, exportable. Source 6.9: a recheck button on a
 * published mark, the Co-ordinator notified and able to edit and republish, the student told of any change. Also the
 * grading policy on a programme and the kind of a mark component (slice 1, D-079), set through the real routes.
 */

let coordinator: Person, bachelorsCoordinator: Person, admin: Person;
let fixture: ClassFixture, sibling: ClassFixture, bachelors: ClassFixture;
let maths: Subject, siblingMaths: Subject;
let term: string;
let publicationId: string;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const publish = async (cls: ClassFixture, subjects: Subject[]) => {
  await post("/api/results/review/verify", { sheetIds: await Promise.all(subjects.map((s) => sheetIdOf(cls, s, term))) }, coordinator);
  const response = await post(`/api/results/classes/${cls.classId}/publish`, { terminalId: term }, coordinator);
  if (response.status !== 201) throw new Error(`publish ${response.status} ${await response.text()}`);
  return ((await response.json()) as { publicationId: string }).publicationId;
};

beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  term = await terminal(true);
  // Two +2 classes of the same level ordinal (Grade 11 of two programmes), and a Bachelor's class.
  fixture = await resultsClass("plus2", 4, "percentage_division");
  sibling = await resultsClass("plus2", 2, "percentage_division");
  bachelors = await resultsClass("bachelors", 1, "percentage_division");
  maths = await addSubject(fixture, [[100, "theory"]]);
  siblingMaths = await addSubject(sibling, [[100, "theory"]]);
  const bachelorsMaths = await addSubject(bachelors, [[100, "theory"]], { section: "bachelors" });
  // Percentages: 90, 80, 80, 20 (fails); the sibling class 85 and 70; the Bachelor's student 99.
  await enterAndSubmit(fixture, maths, term, (p) => [90, 80, 80, 20][p]!);
  await enterAndSubmit(sibling, siblingMaths, term, (p) => [85, 70][p]!);
  await enterAndSubmit(bachelors, bachelorsMaths, term, 99);
  publicationId = await publish(fixture, [maths]);
  await publish(bachelors, [bachelorsMaths]);
});

describe("setup: the grading policy and component kinds (slice 1)", () => {
  it("the Co-ordinator sets a programme's grading policy; it shows in the programme list, and the pack's is used where none was set", async () => {
    const list = (await (await call("/api/academics/programmes", { cookie: coordinator.cookie })).json()) as { programmes: { id: string; levels: { id: string }[]; gradingPolicy: string | null }[] };
    const programme = list.programmes.find((p) => p.levels.some((l) => l.id === fixture.levelId))!;
    expect(programme.gradingPolicy).toBe("percentage_division");
    expect((await call(`/api/academics/programmes/${programme.id}`, { method: "PATCH", body: { gradingPolicy: "neb_gpa" }, cookie: coordinator.cookie })).status).toBe(200);
    expect((await call(`/api/academics/programmes/${programme.id}`, { method: "PATCH", body: { gradingPolicy: "letters" }, cookie: coordinator.cookie })).status).toBe(400);
    expect((await call(`/api/academics/programmes/${programme.id}`, { method: "PATCH", body: { gradingPolicy: "neb_gpa" }, cookie: admin.cookie })).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'academics.programme.updated' AND entity_public_id = ?1 AND after_json LIKE '%neb_gpa%'", programme.id)).toBe(1);
    await call(`/api/academics/programmes/${programme.id}`, { method: "PATCH", body: { gradingPolicy: "percentage_division" }, cookie: coordinator.cookie });
  });

  it("a mark component is theory or practical", async () => {
    const offering = (await (await call(`/api/academics/offerings/${maths.offeringId}/components`, { method: "POST", body: { name: "Lab", maxHundredths: 2500, kind: "practical" }, cookie: coordinator.cookie })).json()) as { id: string };
    const curriculum = (await (await call(`/api/academics/curriculum?level=${fixture.levelId}`, { cookie: coordinator.cookie })).json()) as { offerings: { id: string; components: { id: string; kind: string }[] }[] };
    expect(curriculum.offerings.find((o) => o.id === maths.offeringId)!.components.find((c) => c.id === offering.id)!.kind).toBe("practical");
    expect((await call(`/api/academics/components/${offering.id}`, { method: "PATCH", body: { kind: "theory", active: false }, cookie: coordinator.cookie })).status).toBe(200);
  });
});

describe("the student's own results", () => {
  it("shows each published result with its marks card, from the snapshot", async () => {
    const own = (await (await call("/api/results/me", { cookie: fixture.pupils[0]!.person.cookie })).json()) as { results: { publicationId: string; card: { version: number; body: { percentHundredths: number; outcome: string; student: { sid: string } } } }[] };
    expect(own.results).toHaveLength(1);
    expect(own.results[0]!.card).toMatchObject({ version: 1, body: { percentHundredths: 9000, outcome: "Distinction" } });
  });

  it("a student never reaches another's card, the class sheet or the recheck list", async () => {
    const other = (await (await call("/api/results/me", { cookie: fixture.pupils[1]!.person.cookie })).json()) as { results: { card: { id: string } }[] };
    const cardId = other.results[0]!.card.id;
    const student = fixture.pupils[0]!.person;
    expect((await call(`/api/results/cards/${cardId}`, { cookie: student.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/${fixture.classId}/terminals/${term}/sheet`, { cookie: student.cookie })).status).toBe(404);
    expect((await call("/api/results/rechecks", { cookie: student.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/${fixture.classId}/terminals/${term}/sheet.csv`, { cookie: student.cookie })).status).toBe(403);
  });

  it("staff reach a card only in their own sections", async () => {
    const other = (await (await call("/api/results/me", { cookie: fixture.pupils[1]!.person.cookie })).json()) as { results: { card: { id: string } }[] };
    const cardId = other.results[0]!.card.id;
    expect((await call(`/api/results/cards/${cardId}`, { cookie: admin.cookie })).status).toBe(200);
    expect((await call(`/api/results/cards/${cardId}`, { cookie: bachelorsCoordinator.cookie })).status).toBe(404);
  });
});

describe("the whole-class sheet", () => {
  it("lists students by subject with the result and the rank in the class, ties sharing", async () => {
    const sheet = (await (await call(`/api/results/classes/${fixture.classId}/terminals/${term}/sheet`, { cookie: coordinator.cookie })).json()) as { students: { enrollmentId: string; rank: number | null; outcome: string }[] };
    const rank = (i: number) => sheet.students.find((s) => s.enrollmentId === fixture.pupils[i]!.enrollmentId)!.rank;
    expect([rank(0), rank(1), rank(2), rank(3)]).toEqual([1, 2, 2, null]);
  });

  it("exports as CSV with no spreadsheet formulas", async () => {
    await db.prepare("UPDATE students SET first_name = '=cmd' WHERE public_id = ?1").bind(fixture.pupils[3]!.studentId).run();
    // The card is a snapshot: the name on it was taken at publish, so the CSV still shows the old name.
    const csv = await (await call(`/api/results/classes/${fixture.classId}/terminals/${term}/sheet.csv`, { cookie: admin.cookie })).text();
    expect(csv.split("\r\n")[0]).toContain('"Rank","SID","Student"');
    expect(csv).not.toMatch(/(^|,)"?=/m);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(5);
  });

  it("does not exist before the class is published", async () => {
    expect((await call(`/api/results/classes/${sibling.classId}/terminals/${term}/sheet`, { cookie: coordinator.cookie })).status).toBe(404);
  });
});

describe("the Top 20", () => {
  it("a student sees their own section and level only, name and rank only, and only once their class is published", async () => {
    const siblingStudent = sibling.pupils[0]!.person;
    const before = (await (await call(`/api/results/top20?terminalId=${term}`, { cookie: siblingStudent.cookie })).json()) as { pools: unknown[] };
    expect(before.pools).toHaveLength(0);
    const mine = (await (await call(`/api/results/top20?terminalId=${term}`, { cookie: fixture.pupils[3]!.person.cookie })).json()) as { pools: { entries: Record<string, unknown>[] }[] };
    expect(mine.pools).toHaveLength(1);
    expect(mine.pools[0]!.entries.map((e) => e.rank)).toEqual([1, 2, 2]);
    for (const entry of mine.pools[0]!.entries) expect(Object.keys(entry).sort()).toEqual(["name", "rank"]);
  });

  it("ranks the same level across the section's classes once each is published; the Bachelor's student is never in it", async () => {
    await publish(sibling, [siblingMaths]);
    const list = (await (await call(`/api/results/top20?terminalId=${term}`, { cookie: fixture.pupils[0]!.person.cookie })).json()) as { pools: { entries: { rank: number; name: string }[] }[] };
    expect(list.pools[0]!.entries.map((e) => e.rank)).toEqual([1, 2, 3, 3, 5]); // 90, 85, 80, 80, 70
  });

  it("staff see every list in reach with the class and score", async () => {
    const all = (await (await call(`/api/results/top20?terminalId=${term}`, { cookie: coordinator.cookie })).json()) as { pools: { sectionName: string; entries: { score?: number; className?: string }[] }[] };
    expect(all.pools.length).toBeGreaterThanOrEqual(2);
    expect(all.pools.every((p) => p.entries.every((e) => typeof e.score === "number" && typeof e.className === "string"))).toBe(true);
    const bachelorsOnly = (await (await call(`/api/results/top20?terminalId=${term}`, { cookie: bachelorsCoordinator.cookie })).json()) as { pools: { sectionName: string }[] };
    expect(bachelorsOnly.pools.every((p) => p.sectionName === "Bachelor's")).toBe(true);
  });

  it("is not there when the school switches it off; teachers and Accountants never see it", async () => {
    await setModule("top20", false);
    expect((await call("/api/results/top20", { cookie: fixture.pupils[0]!.person.cookie })).status).toBe(404);
    await setModule("top20", true);
    const accountant = await person("accountant", "institution");
    expect((await call("/api/results/top20", { cookie: accountant.cookie })).status).toBe(403);
    expect((await call("/api/results/top20", { cookie: maths.teacher.cookie })).status).toBe(403);
  });
});

describe("rechecks", () => {
  let recheckId: string;

  it("a student asks for a recheck of a published subject, with a reason; one open at a time", async () => {
    const student = fixture.pupils[1]!.person;
    expect((await post(`/api/results/publications/${publicationId}/rechecks`, { offeringId: maths.offeringId, reason: "x" }, student)).status).toBe(400);
    const made = await post(`/api/results/publications/${publicationId}/rechecks`, { offeringId: maths.offeringId, reason: "I think question 4 was not counted" }, student);
    expect(made.status).toBe(201);
    recheckId = ((await made.json()) as { id: string }).id;
    const again = await post(`/api/results/publications/${publicationId}/rechecks`, { offeringId: maths.offeringId, reason: "Again please" }, student);
    expect(again.status).toBe(409);
  });

  it("a student cannot ask about someone else's result or an unpublished one", async () => {
    expect((await post(`/api/results/publications/${publicationId}/rechecks`, { offeringId: maths.offeringId, reason: "Not my class" }, sibling.pupils[1]!.person)).status).toBe(404);
    expect((await post(`/api/results/publications/${publicationId}/rechecks`, { offeringId: maths.offeringId, reason: "Not a student" }, coordinator)).status).toBe(403);
  });

  it("the Co-ordinator sees it at once with the current marks; a Co-ordinator of another section does not", async () => {
    const list = (await (await call("/api/results/rechecks", { cookie: coordinator.cookie })).json()) as { rechecks: { id: string; status: string; marks: { valueHundredths: number }[] }[] };
    expect(list.rechecks.find((r) => r.id === recheckId)).toMatchObject({ status: "open", marks: [{ valueHundredths: 8000 }] });
    const other = (await (await call("/api/results/rechecks", { cookie: bachelorsCoordinator.cookie })).json()) as { rechecks: { id: string }[] };
    expect(other.rechecks.some((r) => r.id === recheckId)).toBe(false);
    expect((await post(`/api/results/rechecks/${recheckId}/decide`, { outcome: "unchanged", reason: "Checked" }, bachelorsCoordinator)).status).toBe(404);
    expect((await post(`/api/results/rechecks/${recheckId}/decide`, { outcome: "unchanged", reason: "Checked" }, admin)).status).toBe(403);
  });

  it("changed: the marks are corrected and the next card version is made in one batch, with the reason; the first card is kept", async () => {
    const response = await post(
      `/api/results/rechecks/${recheckId}/decide`,
      { outcome: "changed", reason: "Question 4 was not added", marks: [{ componentId: maths.components[0]!.id, valueHundredths: 9500 }] },
      coordinator,
    );
    expect(response.status).toBe(200);
    const own = (await (await call("/api/results/me", { cookie: fixture.pupils[1]!.person.cookie })).json()) as { results: { card: { version: number; reason: string; body: { percentHundredths: number } }; rechecks: { status: string; decisionReason: string }[] }[] };
    expect(own.results[0]!.card).toMatchObject({ version: 2, reason: "Question 4 was not added", body: { percentHundredths: 9500 } });
    expect(own.results[0]!.rechecks[0]).toMatchObject({ status: "changed", decisionReason: "Question 4 was not added" });
    expect(await count("SELECT COUNT(*) AS n FROM marks_cards mc JOIN enrollments en ON en.id = mc.enrollment_id WHERE en.public_id = ?1", fixture.pupils[1]!.enrollmentId)).toBe(2);
    // The class sheet and the Top 20 now read the new version: pupil 1 is first.
    const sheet = (await (await call(`/api/results/classes/${fixture.classId}/terminals/${term}/sheet`, { cookie: coordinator.cookie })).json()) as { students: { enrollmentId: string; rank: number; version: number }[] };
    expect(sheet.students.find((s) => s.enrollmentId === fixture.pupils[1]!.enrollmentId)).toMatchObject({ rank: 1, version: 2 });
  });

  it("is decided once; the Admin sees every post-publish change with who made it and why", async () => {
    expect((await post(`/api/results/rechecks/${recheckId}/decide`, { outcome: "unchanged", reason: "Second look" }, coordinator)).status).toBe(409);
    const list = (await (await call("/api/results/rechecks", { cookie: admin.cookie })).json()) as { rechecks: { id: string; status: string; decidedBy: string; decisionReason: string }[] };
    expect(list.rechecks.find((r) => r.id === recheckId)).toMatchObject({ status: "changed", decisionReason: "Question 4 was not added" });
    expect(list.rechecks.find((r) => r.id === recheckId)!.decidedBy).toBeTruthy();
  });

  it("unchanged needs a reason and leaves the card alone; after that the published marks are locked again", async () => {
    const made = await post(`/api/results/publications/${publicationId}/rechecks`, { offeringId: maths.offeringId, reason: "Please look again" }, fixture.pupils[2]!.person);
    const id = ((await made.json()) as { id: string }).id;
    expect((await post(`/api/results/rechecks/${id}/decide`, { outcome: "unchanged", reason: "" }, coordinator)).status).toBe(400);
    expect((await post(`/api/results/rechecks/${id}/decide`, { outcome: "unchanged", reason: "Marks are correct" }, coordinator)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM marks_cards mc JOIN enrollments en ON en.id = mc.enrollment_id WHERE en.public_id = ?1", fixture.pupils[2]!.enrollmentId)).toBe(1);
    await expect(db.prepare("UPDATE marks SET value_hundredths = 0 WHERE enrollment_id = (SELECT id FROM enrollments WHERE public_id = ?1)").bind(fixture.pupils[2]!.enrollmentId).run()).rejects.toThrow(/draft/);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
