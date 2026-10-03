import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { newPublicId } from "../src/core/ids";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, resultsClass, sheetIdOf, sheetPath, terminal, type Subject } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * Elective picks and the marks grid (Phase 7, slice 2, D-080) and verify and publish (slice 3, D-081). CLAUDE.md
 * section 6, "Marks and results": marks per component in a bulk grid; teachers edit until the Co-ordinator verifies;
 * Draft, Under review, Verified, Published; publish a whole class per terminal, disabled until every subject is
 * verified; a class with no grading policy cannot be published; published marks cards are snapshots. D-056: elective
 * groups, so a grid lists only the students who take the subject. Source 6.2 and 6.3: draft-save, missing marks
 * flagged, send back with a note, bulk approve, the inbox shows which subject holds a class up.
 */

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person;
let fixture: ClassFixture;
let english: Subject, physics: Subject;
let term: string;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const put = (path: string, body: unknown, who: Person) => call(path, { method: "PUT", body, cookie: who.cookie });

beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  fixture = await resultsClass("plus2", 3, "neb_gpa");
  term = await terminal();
  english = await addSubject(fixture, [[100, "theory"]], { credit: 4 });
  physics = await addSubject(fixture, [[75, "theory"], [25, "practical"]], { credit: 5 });
});

describe("elective picks", () => {
  let groupId: string;
  let biology: Subject, computing: Subject;

  beforeAll(async () => {
    groupId = newPublicId();
    await db.prepare("INSERT INTO elective_groups (public_id, level_id, name) SELECT ?1, id, 'Fourth subject' FROM levels WHERE public_id = ?2").bind(groupId, fixture.levelId).run();
    biology = await addSubject(fixture, [[100, "theory"]], { groupId });
    computing = await addSubject(fixture, [[100, "theory"]], { groupId });
  });

  it("the Co-ordinator records each student's pick, exactly the group's count, from the group", async () => {
    const [a, b, c] = fixture.pupils;
    expect((await put(`/api/results/enrollments/${a!.enrollmentId}/electives/${groupId}`, { offeringIds: [biology.offeringId] }, coordinator)).status).toBe(200);
    expect((await put(`/api/results/enrollments/${b!.enrollmentId}/electives/${groupId}`, { offeringIds: [computing.offeringId] }, coordinator)).status).toBe(200);
    expect((await put(`/api/results/enrollments/${c!.enrollmentId}/electives/${groupId}`, { offeringIds: [biology.offeringId, computing.offeringId] }, coordinator)).status).toBe(422);
    expect((await put(`/api/results/enrollments/${c!.enrollmentId}/electives/${groupId}`, { offeringIds: [english.offeringId] }, coordinator)).status).toBe(422);
    const view = (await (await call(`/api/results/classes/${fixture.classId}/electives`, { cookie: coordinator.cookie })).json()) as { groups: { subjects: unknown[] }[]; students: { enrollmentId: string; picks: string[] }[] };
    expect(view.groups[0]!.subjects).toHaveLength(2);
    expect(view.students.find((s) => s.enrollmentId === a!.enrollmentId)!.picks).toEqual([biology.offeringId]);
  });

  it("a grid lists only the students who take its subject", async () => {
    const sheet = (await (await call(sheetPath(fixture, biology, term), { cookie: biology.teacher.cookie })).json()) as { students: { enrollmentId: string }[] };
    expect(sheet.students.map((s) => s.enrollmentId)).toEqual([fixture.pupils[0]!.enrollmentId]);
    const all = (await (await call(sheetPath(fixture, english, term), { cookie: english.teacher.cookie })).json()) as { students: unknown[] };
    expect(all.students).toHaveLength(3);
  });

  it("a subject the student already has marks in cannot be dropped; switching an unmarked pick can", async () => {
    const [a, b] = fixture.pupils;
    await put(sheetPath(fixture, biology, term), { marks: [{ enrollmentId: a!.enrollmentId, componentId: biology.components[0]!.id, valueHundredths: 5000 }] }, biology.teacher);
    const refused = await put(`/api/results/enrollments/${a!.enrollmentId}/electives/${groupId}`, { offeringIds: [computing.offeringId] }, coordinator);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("has_marks");
    expect((await put(`/api/results/enrollments/${b!.enrollmentId}/electives/${groupId}`, { offeringIds: [biology.offeringId] }, coordinator)).status).toBe(200);
    expect((await put(`/api/results/enrollments/${b!.enrollmentId}/electives/${groupId}`, { offeringIds: [computing.offeringId] }, coordinator)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM elective_picks ep JOIN enrollments en ON en.id = ep.enrollment_id WHERE en.public_id = ?1", b!.enrollmentId)).toBe(2); // switched off, not deleted
  });

  it("only a Co-ordinator whose section reaches the class; nobody else", async () => {
    const path = `/api/results/enrollments/${fixture.pupils[2]!.enrollmentId}/electives/${groupId}`;
    expect((await put(path, { offeringIds: [biology.offeringId] }, bachelorsCoordinator)).status).toBe(404);
    expect((await call(`/api/results/classes/${fixture.classId}/electives`, { cookie: bachelorsCoordinator.cookie })).status).toBe(404);
    for (const who of [admin, english.teacher, fixture.pupils[0]!.person]) expect((await put(path, { offeringIds: [biology.offeringId] }, who)).status).toBe(403);
    expect((await put(path, { offeringIds: [biology.offeringId] }, plus2Coordinator)).status).toBe(200);
  });

  it("the electives are switched off again so the rest of this file grades two subjects", async () => {
    await db.prepare("UPDATE subject_offerings SET is_active = 0 WHERE elective_group_id = (SELECT id FROM elective_groups WHERE public_id = ?1)").bind(groupId).run();
  });
});

describe("the marks grid", () => {
  it("the teacher sees their subjects with each terminal's state", async () => {
    const mine = (await (await call("/api/results/mine", { cookie: physics.teacher.cookie })).json()) as { subjects: { offeringId: string; sheets: { terminalId: string; status: string }[] }[] };
    const entry = mine.subjects.find((s) => s.offeringId === physics.offeringId)!;
    expect(entry.sheets.find((s) => s.terminalId === term)!.status).toBe("not_started");
  });

  it("shows the components and students, and counts every missing mark", async () => {
    const sheet = (await (await call(sheetPath(fixture, physics, term), { cookie: physics.teacher.cookie })).json()) as { status: string; components: { kind: string }[]; students: unknown[]; missing: number };
    expect(sheet.status).toBe("not_started");
    expect(sheet.components.map((c) => c.kind)).toEqual(["theory", "practical"]);
    expect(sheet.missing).toBe(6);
  });

  it("saves a draft (a partial one too), replaces on a second save, and writes one audit entry each time", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.marks.saved'");
    const p0 = fixture.pupils[0]!.enrollmentId;
    expect((await put(sheetPath(fixture, physics, term), { marks: [{ enrollmentId: p0, componentId: physics.components[0]!.id, valueHundredths: 6000 }] }, physics.teacher)).status).toBe(200);
    expect((await put(sheetPath(fixture, physics, term), { marks: [{ enrollmentId: p0, componentId: physics.components[0]!.id, valueHundredths: 6250 }] }, physics.teacher)).status).toBe(200);
    const sheet = (await (await call(sheetPath(fixture, physics, term), { cookie: physics.teacher.cookie })).json()) as { status: string; students: { enrollmentId: string; marks: { valueHundredths: number | null }[] }[]; missing: number };
    expect(sheet.status).toBe("draft");
    expect(sheet.students.find((s) => s.enrollmentId === p0)!.marks[0]!.valueHundredths).toBe(6250);
    expect(sheet.missing).toBe(5);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.marks.saved'")).toBe(before + 2);
  });

  it("refuses a mark above the maximum, a negative or fractional one, and a student or component not on the sheet", async () => {
    const p0 = fixture.pupils[0]!.enrollmentId;
    // Not a valid mark at all: refused before anything is looked up (400).
    const malformed = [
      { enrollmentId: p0, componentId: physics.components[1]!.id, valueHundredths: -1 },
      { enrollmentId: p0, componentId: physics.components[1]!.id, valueHundredths: 10.5 },
      { enrollmentId: p0, componentId: physics.components[1]!.id, valueHundredths: 100, absent: true },
    ];
    for (const mark of malformed) expect((await put(sheetPath(fixture, physics, term), { marks: [mark] }, physics.teacher)).status).toBe(400);
    // A valid number that does not fit this sheet (422).
    const misfit = [
      { enrollmentId: p0, componentId: physics.components[1]!.id, valueHundredths: 2600 },
      { enrollmentId: p0, componentId: english.components[0]!.id, valueHundredths: 100 },
      { enrollmentId: newPublicId(), componentId: physics.components[1]!.id, valueHundredths: 100 },
    ];
    for (const mark of misfit) expect((await put(sheetPath(fixture, physics, term), { marks: [mark] }, physics.teacher)).status).toBe(422);
  });

  it("only the subject's own teacher enters marks; the Co-ordinator and others cannot", async () => {
    const mark = { marks: [{ enrollmentId: fixture.pupils[1]!.enrollmentId, componentId: physics.components[0]!.id, valueHundredths: 100 }] };
    expect((await put(sheetPath(fixture, physics, term), mark, english.teacher)).status).toBe(404);
    expect((await call(sheetPath(fixture, physics, term), { cookie: english.teacher.cookie })).status).toBe(404);
    for (const who of [coordinator, admin, fixture.pupils[0]!.person]) expect((await put(sheetPath(fixture, physics, term), mark, who)).status).toBe(403);
  });

  it("cannot be sent for review while a mark is missing; an absence counts as entered", async () => {
    const refused = await post(`${sheetPath(fixture, physics, term)}/submit`, undefined, physics.teacher);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("missing");
    const [p0, p1, p2] = fixture.pupils.map((p) => p.enrollmentId);
    const [th, pr] = physics.components.map((c) => c.id);
    const marks = [
      { enrollmentId: p0, componentId: pr, valueHundredths: 2000 },
      { enrollmentId: p1, componentId: th, valueHundredths: 5000 },
      { enrollmentId: p1, componentId: pr, valueHundredths: 2500 },
      { enrollmentId: p2, componentId: th, valueHundredths: null, absent: true },
      { enrollmentId: p2, componentId: pr, valueHundredths: 1500 },
    ];
    expect((await put(sheetPath(fixture, physics, term), { marks }, physics.teacher)).status).toBe(200);
    expect((await post(`${sheetPath(fixture, physics, term)}/submit`, undefined, physics.teacher)).status).toBe(200);
  });

  it("once sent, the teacher can no longer change it, and the database refuses too", async () => {
    const mark = { marks: [{ enrollmentId: fixture.pupils[1]!.enrollmentId, componentId: physics.components[0]!.id, valueHundredths: 100 }] };
    expect((await put(sheetPath(fixture, physics, term), mark, physics.teacher)).status).toBe(409);
    await expect(db.prepare("UPDATE marks SET value_hundredths = 0 WHERE sheet_id = (SELECT id FROM mark_sheets WHERE public_id = ?1)").bind(await sheetIdOf(fixture, physics, term)).run()).rejects.toThrow(/draft/);
    await expect(db.prepare("DELETE FROM marks").run()).rejects.toThrow(/never deleted/);
  });
});

describe("review", () => {
  it("the board shows each class's subjects, their state and what is missing", async () => {
    const board = (await (await call(`/api/results/review?terminalId=${term}`, { cookie: coordinator.cookie })).json()) as { classes: { classId: string; ready: boolean; subjects: { offeringId: string; status: string; missing: number }[] }[] };
    const cls = board.classes.find((c) => c.classId === fixture.classId)!;
    expect(cls.ready).toBe(false);
    expect(cls.subjects.find((s) => s.offeringId === physics.offeringId)).toMatchObject({ status: "under_review", missing: 0 });
    expect(cls.subjects.find((s) => s.offeringId === english.offeringId)).toMatchObject({ status: "not_started", missing: 3 });
  });

  it("opens on the terminal in progress, not the last one, and counts each student missing a mark once (Co-ordinator FUT F-07)", async () => {
    const later = await terminal(true); // a later terminal where nothing has started
    const board = (await (await call("/api/results/review", { cookie: coordinator.cookie })).json()) as { terminalId: string };
    expect(board.terminalId).toBe(term);
    const fresh = (await (await call(`/api/results/review?terminalId=${later}`, { cookie: coordinator.cookie })).json()) as { classes: { classId: string; subjects: { offeringId: string; missing: number }[] }[] };
    const physicsRow = fresh.classes.find((c) => c.classId === fixture.classId)!.subjects.find((x) => x.offeringId === physics.offeringId)!;
    expect(physics.components.length).toBeGreaterThan(1); // theory and practical: the old count doubled the students
    expect(physicsRow.missing).toBe(fixture.pupils.length);
  });

  it("sends a sheet back with a note (required); the teacher sees the note and can change it again", async () => {
    const sheetId = await sheetIdOf(fixture, physics, term);
    expect((await post(`/api/results/review/sheets/${sheetId}/send-back`, { note: "" }, coordinator)).status).toBe(400);
    expect((await post(`/api/results/review/sheets/${sheetId}/send-back`, { note: "Check Ram's practical" }, coordinator)).status).toBe(200);
    const sheet = (await (await call(sheetPath(fixture, physics, term), { cookie: physics.teacher.cookie })).json()) as { status: string; note: string };
    expect(sheet).toMatchObject({ status: "draft", note: "Check Ram's practical" });
    expect((await put(sheetPath(fixture, physics, term), { marks: [{ enrollmentId: fixture.pupils[0]!.enrollmentId, componentId: physics.components[1]!.id, valueHundredths: 2100 }] }, physics.teacher)).status).toBe(200);
    expect((await post(`${sheetPath(fixture, physics, term)}/submit`, undefined, physics.teacher)).status).toBe(200);
  });

  it("verifies in bulk: only sheets under review and in reach count", async () => {
    await enterAndSubmit(fixture, english, term, 85);
    const ids = [await sheetIdOf(fixture, physics, term), await sheetIdOf(fixture, english, term)];
    expect(((await (await post("/api/results/review/verify", { sheetIds: ids }, bachelorsCoordinator)).json()) as { verified: number }).verified).toBe(0);
    expect(((await (await post("/api/results/review/verify", { sheetIds: ids }, coordinator)).json()) as { verified: number }).verified).toBe(2);
    expect(((await (await post("/api/results/review/verify", { sheetIds: ids }, coordinator)).json()) as { verified: number }).verified).toBe(0);
  });

  it("only the Co-ordinator (and Super Admin) verifies; a teacher and the Admin cannot", async () => {
    for (const who of [physics.teacher, admin]) expect((await post("/api/results/review/verify", { sheetIds: [newPublicId()] }, who)).status).toBe(403);
    expect((await call(`/api/results/review/sheets/${await sheetIdOf(fixture, physics, term)}`, { cookie: bachelorsCoordinator.cookie })).status).toBe(404);
    expect((await call(`/api/results/review/sheets/${await sheetIdOf(fixture, physics, term)}`, { cookie: plus2Coordinator.cookie })).status).toBe(200);
  });
});

describe("publish", () => {
  it("is refused for a class of another section, and while the programme has no grading policy", async () => {
    expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: term }, bachelorsCoordinator)).status).toBe(404);
    await db.prepare("UPDATE programmes SET grading_policy = NULL WHERE id = (SELECT programme_id FROM levels WHERE public_id = ?1)").bind(fixture.levelId).run();
    const refused = await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: term }, coordinator);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("no_policy");
    await db.prepare("UPDATE programmes SET grading_policy = 'neb_gpa' WHERE id = (SELECT programme_id FROM levels WHERE public_id = ?1)").bind(fixture.levelId).run();
  });

  it("the student sees nothing before publish", async () => {
    const own = (await (await call("/api/results/me", { cookie: fixture.pupils[0]!.person.cookie })).json()) as { results: unknown[] };
    expect(own.results).toHaveLength(0);
  });

  it("publishes the whole class in one batch: every sheet Published, a snapshot card per student, one audit entry", async () => {
    const response = await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: term }, coordinator);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { cards: number }).cards).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM mark_sheets ms JOIN classes c ON c.id = ms.class_id WHERE c.public_id = ?1 AND ms.status = 'published'", fixture.classId)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.published' AND entity_public_id = ?1", fixture.classId)).toBe(1);
    // Ram (pupil 0): English 85% (A, 3.6 x 4); Physics 62.5/75 + 21/25 = 83.5% (A, 3.6 x 5): GPA 3.60.
    const own = (await (await call("/api/results/me", { cookie: fixture.pupils[0]!.person.cookie })).json()) as { results: { card: { body: { gpaHundredths: number; subjects: { grade: string }[] } } }[] };
    expect(own.results[0]!.card.body.gpaHundredths).toBe(360);
    // Pupil 2 was absent in Physics theory: NG, no GPA.
    const absent = (await (await call("/api/results/me", { cookie: fixture.pupils[2]!.person.cookie })).json()) as { results: { card: { body: { gpaHundredths: number | null; outcome: string } } }[] };
    expect(absent.results[0]!.card.body).toMatchObject({ gpaHundredths: null, outcome: "NG" });
  });

  it("happens once: a second publish is refused, and a published sheet can no longer be sent back", async () => {
    expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: term }, coordinator)).status).toBe(409);
    expect((await post(`/api/results/review/sheets/${await sheetIdOf(fixture, physics, term)}/send-back`, { note: "Too late" }, coordinator)).status).toBe(409);
  });

  it("a later grading policy change does not touch the published card (a snapshot)", async () => {
    await db.prepare("UPDATE programmes SET grading_policy = 'percentage_division' WHERE id = (SELECT programme_id FROM levels WHERE public_id = ?1)").bind(fixture.levelId).run();
    const own = (await (await call("/api/results/me", { cookie: fixture.pupils[0]!.person.cookie })).json()) as { results: { card: { body: { policy: string; gpaHundredths: number } } }[] };
    expect(own.results[0]!.card.body).toMatchObject({ policy: "neb_gpa", gpaHundredths: 360 });
    await db.prepare("UPDATE programmes SET grading_policy = 'neb_gpa' WHERE id = (SELECT programme_id FROM levels WHERE public_id = ?1)").bind(fixture.levelId).run();
  });

  it("the database refuses to change or delete a card or a publication", async () => {
    await expect(db.prepare("UPDATE marks_cards SET gpa_hundredths = 400").run()).rejects.toThrow(/snapshot/);
    await expect(db.prepare("DELETE FROM marks_cards").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("UPDATE result_publications SET grading_policy = 'percentage_division'").run()).rejects.toThrow(/never changes/);
  });

  it("is refused while any subject is not verified, and the board says which one", async () => {
    const other = await resultsClass("plus2", 2, "neb_gpa");
    const a = await addSubject(other, [[100, "theory"]]);
    const b = await addSubject(other, [[100, "theory"]]);
    await enterAndSubmit(other, a, term, 70);
    await enterAndSubmit(other, b, term, 70);
    await post("/api/results/review/verify", { sheetIds: [await sheetIdOf(other, a, term)] }, coordinator);
    const refused = await post(`/api/results/classes/${other.classId}/publish`, { terminalId: term }, coordinator);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("not_ready");
    const board = (await (await call(`/api/results/review?terminalId=${term}`, { cookie: coordinator.cookie })).json()) as { classes: { classId: string; ready: boolean; subjects: { offeringId: string; status: string }[] }[] };
    const cls = board.classes.find((c) => c.classId === other.classId)!;
    expect(cls.ready).toBe(false);
    expect(cls.subjects.find((s) => s.offeringId === b.offeringId)!.status).toBe("under_review");
  });

  it("an NEB class whose subject has no credit hours cannot be graded, and nothing is written", async () => {
    const other = await resultsClass("plus2", 1, "neb_gpa");
    const a = await addSubject(other, [[100, "theory"]], { credit: null });
    await enterAndSubmit(other, a, term, 70);
    await post("/api/results/review/verify", { sheetIds: [await sheetIdOf(other, a, term)] }, coordinator);
    const refused = await post(`/api/results/classes/${other.classId}/publish`, { terminalId: term }, coordinator);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toMatch(/credit hours/);
    expect(await count("SELECT COUNT(*) AS n FROM result_publications rp JOIN classes c ON c.id = rp.class_id WHERE c.public_id = ?1", other.classId)).toBe(0);
  });

  it("only the Co-ordinator (and Super Admin) publishes", async () => {
    for (const who of [admin, physics.teacher, fixture.pupils[0]!.person]) expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: term }, who)).status).toBe(403);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
