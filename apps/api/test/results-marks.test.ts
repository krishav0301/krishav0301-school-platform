import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { newPublicId } from "../src/core/ids";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, examTerm, pattern, resultsClass, runTerminal, sheetIdOf, sheetPath, type Subject, type Term } from "./results-helpers";
import { assign, classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Elective picks and the marks grid (Phase 7, slice 2, D-080), verify and publish (slice 3, D-081), on the exam pattern
 * (D-117). CLAUDE.md section 6: marks in a bulk grid; teachers edit until the Co-ordinator verifies; Draft, Under review,
 * Verified, Published; publish a whole class per terminal, disabled until every subject is verified; published marks
 * cards are snapshots. D-117, the PM's rules: a class with no exam pattern cannot be published; the teacher enters marks
 * out of the paper, theory and (where the terminal holds it and the subject has one) practical; a terminal's card is for
 * information, no pass or fail; the final result is published automatically with the class's last terminal.
 */

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person;
let fixture: ClassFixture;
let english: Subject, physics: Subject;
let term: Term;
/** Terminal 1 holds no practical; terminals 2 and 3 do (30 / 30 / 40). */
let first: string, second: string, third: string;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const put = (path: string, body: unknown, who: Person) => call(path, { method: "PUT", body, cookie: who.cookie });

beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  term = await examTerm(pattern(true));
  [first, second, third] = term.terminals as [string, string, string];
  fixture = await resultsClass("plus2", 3, term);
  english = await addSubject(fixture);
  physics = await addSubject(fixture, { practical: 25 });
});

describe("elective picks", () => {
  let groupId: string;
  let biology: Subject, computing: Subject;

  beforeAll(async () => {
    groupId = newPublicId();
    await db.prepare("INSERT INTO elective_groups (public_id, level_id, name) SELECT ?1, id, 'Fourth subject' FROM levels WHERE public_id = ?2").bind(groupId, fixture.levelId).run();
    biology = await addSubject(fixture, {}, { groupId });
    computing = await addSubject(fixture, {}, { groupId });
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
    const sheet = (await (await call(sheetPath(fixture, biology, first), { cookie: biology.teacher.cookie })).json()) as { students: { enrollmentId: string }[] };
    expect(sheet.students.map((s) => s.enrollmentId)).toEqual([fixture.pupils[0]!.enrollmentId]);
    const all = (await (await call(sheetPath(fixture, english, first), { cookie: english.teacher.cookie })).json()) as { students: unknown[] };
    expect(all.students).toHaveLength(3);
  });

  it("a subject the student already has marks in cannot be dropped; switching an unmarked pick can", async () => {
    const [a, b] = fixture.pupils;
    await put(sheetPath(fixture, biology, first), { marks: [{ enrollmentId: a!.enrollmentId, componentId: "theory", valueHundredths: 5000 }] }, biology.teacher);
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
  it("the teacher sees their subjects with each terminal's state, and the terminal's weight", async () => {
    const mine = (await (await call("/api/results/mine", { cookie: physics.teacher.cookie })).json()) as { terminals: { id: string; weight: number }[]; subjects: { offeringId: string; sheets: { terminalId: string; status: string }[] }[] };
    expect(mine.terminals.filter((t) => term.terminals.includes(t.id)).map((t) => t.weight)).toEqual([30, 30, 40]);
    const entry = mine.subjects.find((s) => s.offeringId === physics.offeringId)!;
    expect(entry.sheets.find((s) => s.terminalId === second)!.status).toBe("not_started");
  });

  it("shows the paper's parts out of the paper's own marks: theory only where the terminal holds no practical", async () => {
    const one = (await (await call(sheetPath(fixture, physics, first), { cookie: physics.teacher.cookie })).json()) as { components: { id: string; maxHundredths: number }[]; missing: number };
    expect(one.components).toEqual([{ id: "theory", name: "Theory", kind: "theory", maxHundredths: 10000 }]);
    const two = (await (await call(sheetPath(fixture, physics, second), { cookie: physics.teacher.cookie })).json()) as { status: string; components: { id: string; maxHundredths: number }[]; missing: number };
    expect(two.status).toBe("not_started");
    expect(two.components.map((c) => [c.id, c.maxHundredths])).toEqual([["theory", 7500], ["practical", 2500]]);
    // A subject with no practical stays theory only, out of its full marks, in every terminal.
    const english2 = (await (await call(sheetPath(fixture, english, second), { cookie: english.teacher.cookie })).json()) as { components: { id: string; maxHundredths: number }[] };
    expect(english2.components.map((c) => [c.id, c.maxHundredths])).toEqual([["theory", 10000]]);
    // The grid counts every empty box: three students, two parts.
    expect(two.missing).toBe(6);
  });

  it("saves a draft (a partial one too), replaces on a second save, and writes one audit entry each time", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.marks.saved'");
    const p0 = fixture.pupils[0]!.enrollmentId;
    expect((await put(sheetPath(fixture, physics, second), { marks: [{ enrollmentId: p0, componentId: "theory", valueHundredths: 6000 }] }, physics.teacher)).status).toBe(200);
    expect((await put(sheetPath(fixture, physics, second), { marks: [{ enrollmentId: p0, componentId: "theory", valueHundredths: 6250 }] }, physics.teacher)).status).toBe(200);
    const sheet = (await (await call(sheetPath(fixture, physics, second), { cookie: physics.teacher.cookie })).json()) as { status: string; students: { enrollmentId: string; marks: { valueHundredths: number | null }[] }[]; missing: number };
    expect(sheet.status).toBe("draft");
    expect(sheet.students.find((s) => s.enrollmentId === p0)!.marks[0]!.valueHundredths).toBe(6250);
    expect(sheet.missing).toBe(5); // pupil 0 still lacks the practical
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.marks.saved'")).toBe(before + 2);
  });

  it("refuses a mark above the paper's maximum, a negative or fractional one, a practical where none is held, and a student not on the sheet", async () => {
    const p0 = fixture.pupils[0]!.enrollmentId;
    // Not a valid mark at all: refused before anything is looked up (400).
    const malformed = [
      { enrollmentId: p0, componentId: "practical", valueHundredths: -1 },
      { enrollmentId: p0, componentId: "practical", valueHundredths: 10.5 },
      { enrollmentId: p0, componentId: "practical", valueHundredths: 100, absent: true },
      { enrollmentId: p0, componentId: newPublicId(), valueHundredths: 100 },
    ];
    for (const mark of malformed) expect((await put(sheetPath(fixture, physics, second), { marks: [mark] }, physics.teacher)).status).toBe(400);
    // A valid number that does not fit this sheet (422).
    const misfit = [
      { enrollmentId: p0, componentId: "practical", valueHundredths: 2600 },
      { enrollmentId: p0, componentId: "theory", valueHundredths: 7600 },
      { enrollmentId: newPublicId(), componentId: "practical", valueHundredths: 100 },
    ];
    for (const mark of misfit) expect((await put(sheetPath(fixture, physics, second), { marks: [mark] }, physics.teacher)).status).toBe(422);
    expect((await put(sheetPath(fixture, english, second), { marks: [{ enrollmentId: p0, componentId: "practical", valueHundredths: 100 }] }, english.teacher)).status).toBe(422);
    expect((await put(sheetPath(fixture, physics, first), { marks: [{ enrollmentId: p0, componentId: "practical", valueHundredths: 100 }] }, physics.teacher)).status).toBe(422);
  });

  it("only the subject's own teacher enters marks; the Co-ordinator and others cannot", async () => {
    const mark = { marks: [{ enrollmentId: fixture.pupils[1]!.enrollmentId, componentId: "theory", valueHundredths: 100 }] };
    expect((await put(sheetPath(fixture, physics, second), mark, english.teacher)).status).toBe(404);
    expect((await call(sheetPath(fixture, physics, second), { cookie: english.teacher.cookie })).status).toBe(404);
    for (const who of [coordinator, admin, fixture.pupils[0]!.person]) expect((await put(sheetPath(fixture, physics, second), mark, who)).status).toBe(403);
  });

  it("cannot be sent for review while a mark is missing; an absence counts as entered", async () => {
    const refused = await post(`${sheetPath(fixture, physics, second)}/submit`, undefined, physics.teacher);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("missing");
    const [p0, p1, p2] = fixture.pupils.map((p) => p.enrollmentId);
    const marks = [
      { enrollmentId: p0, componentId: "practical", valueHundredths: 2000 },
      { enrollmentId: p1, componentId: "theory", valueHundredths: 5000 },
      { enrollmentId: p1, componentId: "practical", valueHundredths: 2500 },
      { enrollmentId: p2, componentId: "theory", valueHundredths: null, absent: true },
      { enrollmentId: p2, componentId: "practical", valueHundredths: 1500 },
    ];
    expect((await put(sheetPath(fixture, physics, second), { marks }, physics.teacher)).status).toBe(200);
    expect((await post(`${sheetPath(fixture, physics, second)}/submit`, undefined, physics.teacher)).status).toBe(200);
  });

  it("once sent, the teacher can no longer change it, and the database refuses too", async () => {
    const mark = { marks: [{ enrollmentId: fixture.pupils[1]!.enrollmentId, componentId: "theory", valueHundredths: 100 }] };
    expect((await put(sheetPath(fixture, physics, second), mark, physics.teacher)).status).toBe(409);
    await expect(db.prepare("UPDATE marks SET value_hundredths = 0 WHERE sheet_id = (SELECT id FROM mark_sheets WHERE public_id = ?1)").bind(await sheetIdOf(fixture, physics, second)).run()).rejects.toThrow(/draft/);
    await expect(db.prepare("DELETE FROM marks").run()).rejects.toThrow(/never deleted/);
  });

  it("the sheet keeps the paper it was made with: a later change to the subject applies only to new sheets", async () => {
    await db.prepare("UPDATE subject_offerings SET practical_hundredths = 3000 WHERE public_id = ?1").bind(physics.offeringId).run();
    const kept = (await (await call(sheetPath(fixture, physics, second), { cookie: physics.teacher.cookie })).json()) as { components: { id: string; maxHundredths: number }[] };
    expect(kept.components.map((c) => c.maxHundredths)).toEqual([7500, 2500]);
    const fresh = (await (await call(sheetPath(fixture, physics, third), { cookie: physics.teacher.cookie })).json()) as { components: { id: string; maxHundredths: number }[] };
    expect(fresh.components.map((c) => c.maxHundredths)).toEqual([7000, 3000]);
    await db.prepare("UPDATE subject_offerings SET practical_hundredths = 2500 WHERE public_id = ?1").bind(physics.offeringId).run();
    await expect(db.prepare("UPDATE mark_sheets SET practical_max_hundredths = 3000 WHERE public_id = ?1").bind(await sheetIdOf(fixture, physics, second)).run()).rejects.toThrow(/stays with/);
  });
});

describe("review", () => {
  it("the board shows each class's subjects, their state and what is missing", async () => {
    const board = (await (await call(`/api/results/review?terminalId=${second}`, { cookie: coordinator.cookie })).json()) as { classes: { classId: string; ready: boolean; subjects: { offeringId: string; status: string; missing: number }[] }[] };
    const cls = board.classes.find((c) => c.classId === fixture.classId)!;
    expect(cls.ready).toBe(false);
    expect(cls.subjects.find((s) => s.offeringId === physics.offeringId)).toMatchObject({ status: "under_review", missing: 0 });
    expect(cls.subjects.find((s) => s.offeringId === english.offeringId)).toMatchObject({ status: "not_started", missing: 3 });
  });

  it("opens on the terminal in progress, not the last one", async () => {
    const board = (await (await call("/api/results/review", { cookie: coordinator.cookie })).json()) as { terminalId: string };
    // The latest terminal any marks were started for: the second (the third has none yet), not the last.
    expect(board.terminalId).toBe(second);
    // The board counts each student missing a mark once, however many parts they lack (Co-ordinator FUT F-07).
    const fresh = (await (await call(`/api/results/review?terminalId=${third}`, { cookie: coordinator.cookie })).json()) as { classes: { classId: string; subjects: { offeringId: string; missing: number }[] }[] };
    expect(fresh.classes.find((c) => c.classId === fixture.classId)!.subjects.find((x) => x.offeringId === physics.offeringId)!.missing).toBe(fixture.pupils.length);
  });

  it("sends a sheet back with a note (required); the teacher sees the note and can change it again", async () => {
    const sheetId = await sheetIdOf(fixture, physics, second);
    expect((await post(`/api/results/review/sheets/${sheetId}/send-back`, { note: "" }, coordinator)).status).toBe(400);
    expect((await post(`/api/results/review/sheets/${sheetId}/send-back`, { note: "Check Ram's practical" }, coordinator)).status).toBe(200);
    const sheet = (await (await call(sheetPath(fixture, physics, second), { cookie: physics.teacher.cookie })).json()) as { status: string; note: string };
    expect(sheet).toMatchObject({ status: "draft", note: "Check Ram's practical" });
    expect((await put(sheetPath(fixture, physics, second), { marks: [{ enrollmentId: fixture.pupils[0]!.enrollmentId, componentId: "practical", valueHundredths: 2100 }] }, physics.teacher)).status).toBe(200);
    expect((await post(`${sheetPath(fixture, physics, second)}/submit`, undefined, physics.teacher)).status).toBe(200);
  });

  it("verifies in bulk: only sheets under review and in reach count", async () => {
    await enterAndSubmit(fixture, english, second, 85);
    const ids = [await sheetIdOf(fixture, physics, second), await sheetIdOf(fixture, english, second)];
    expect(((await (await post("/api/results/review/verify", { sheetIds: ids }, bachelorsCoordinator)).json()) as { verified: number }).verified).toBe(0);
    expect(((await (await post("/api/results/review/verify", { sheetIds: ids }, coordinator)).json()) as { verified: number }).verified).toBe(2);
    expect(((await (await post("/api/results/review/verify", { sheetIds: ids }, coordinator)).json()) as { verified: number }).verified).toBe(0);
  });

  it("only the Co-ordinator (and Super Admin) verifies; a teacher and the Admin cannot", async () => {
    for (const who of [physics.teacher, admin]) expect((await post("/api/results/review/verify", { sheetIds: [newPublicId()] }, who)).status).toBe(403);
    expect((await call(`/api/results/review/sheets/${await sheetIdOf(fixture, physics, second)}`, { cookie: bachelorsCoordinator.cookie })).status).toBe(404);
    expect((await call(`/api/results/review/sheets/${await sheetIdOf(fixture, physics, second)}`, { cookie: plus2Coordinator.cookie })).status).toBe(200);
  });
});

interface OwnCard {
  kind: "terminal" | "final";
  terminalName: string | null;
  card: { body: { percentHundredths: number; grade: string | null; outcome: string; passed?: boolean; subjects: { name: string; grade: string | null; percentHundredths?: number; scaledHundredths?: number; finalHundredths?: number; passed?: boolean }[] } };
}
const own = async (pupil: number) => ((await (await call("/api/results/me", { cookie: fixture.pupils[pupil]!.person.cookie })).json()) as { results: OwnCard[] }).results;

describe("publish", () => {
  it("is refused for a class of another section", async () => {
    expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: second }, bachelorsCoordinator)).status).toBe(404);
  });

  it("a term with no exam pattern: no grid, and nothing can be published", async () => {
    const yearId = newPublicId();
    await db
      .prepare(`INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at) VALUES (?1, 2083, ?2, ?3, '2026-04-14', '2027-04-13', 'active', 'x')`)
      .bind(yearId, `NP${Math.random().toString(36).slice(2, 7).toUpperCase()}`, `No pattern ${yearId.slice(0, 6)}`)
      .run();
    const old = newPublicId();
    await db.prepare("INSERT INTO terminals (public_id, academic_year_id, name, ordinal) SELECT ?1, id, 'Old', 1 FROM academic_years WHERE public_id = ?2").bind(old, yearId).run();
    const bare = await classWith("plus2", 1, { yearId });
    const subject = { offeringId: bare.offeringId, teacher: bare.classTeacher, name: "x" };
    await assign(bare.classTeacher, bare.classId, bare.offeringId);
    expect((await call(sheetPath(bare, subject, old), { cookie: bare.classTeacher.cookie })).status).toBe(404);
    const refused = await post(`/api/results/classes/${bare.classId}/publish`, { terminalId: old }, coordinator);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("no_pattern");
  });

  it("the student sees nothing before publish", async () => {
    expect(await own(0)).toHaveLength(0);
  });

  it("publishes a terminal for the whole class in one batch: every sheet Published, a card per student, one audit entry, no pass or fail", async () => {
    const response = await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: second }, coordinator);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ cards: 3, finalPublicationId: null });
    expect(await count("SELECT COUNT(*) AS n FROM mark_sheets ms JOIN classes c ON c.id = ms.class_id WHERE c.public_id = ?1 AND ms.status = 'published'", fixture.classId)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.published' AND entity_public_id = ?1", fixture.classId)).toBe(1);
    // Ram (pupil 0): English 85/100 (85.00%, 25.50 of 30); Physics 62.5 + 21 of 100 (83.50%, 25.05 of 30). Average 84.25: an A.
    const [card] = await own(0);
    expect(card).toMatchObject({ kind: "terminal", card: { body: { percentHundredths: 8425, grade: "A", outcome: "A" } } });
    const subject = (name: string) => card!.card.body.subjects.find((s) => s.name === name)!;
    expect([subject(english.name).percentHundredths, subject(english.name).scaledHundredths, subject(english.name).grade]).toEqual([8500, 2550, "A"]);
    expect([subject(physics.name).percentHundredths, subject(physics.name).scaledHundredths, subject(physics.name).grade]).toEqual([8350, 2505, "A"]);
    expect(await count("SELECT COUNT(*) AS n FROM marks_cards mc JOIN result_publications rp ON rp.id = mc.publication_id JOIN classes c ON c.id = rp.class_id WHERE c.public_id = ?1 AND mc.passed IS NOT NULL", fixture.classId)).toBe(0);
  });

  it("happens once: a second publish is refused, and a published sheet can no longer be sent back", async () => {
    expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: second }, coordinator)).status).toBe(409);
    expect((await post(`/api/results/review/sheets/${await sheetIdOf(fixture, physics, second)}/send-back`, { note: "Too late" }, coordinator)).status).toBe(409);
  });

  it("the pattern is now locked: marks have been entered", async () => {
    const locked = await put(`/api/academics/years/${term.yearId}/exam-pattern`, { ...pattern(false) }, coordinator);
    expect(locked.status).toBe(409);
    expect(((await locked.json()) as { error: string }).error).toBe("locked");
  });

  it("the final waits for every terminal, in any order, and comes out with the last one, in the same batch", async () => {
    // Terminal 3: everyone 90%; pupil 1 only 10% of the Physics theory.
    const t3 = await runTerminal(fixture, [english, physics], third, (p, part, subject) => (p === 1 && subject === 1 && part === 0 ? 10 : 90), coordinator);
    expect(t3.status).toBe(201);
    expect(await t3.json()).toMatchObject({ finalPublicationId: null });
    expect((await own(0)).some((r) => r.kind === "final")).toBe(false);
    // Terminal 1 (no practical): everyone 80%; pupil 1 only 10% in Physics. The last one: the final comes with it.
    const t1 = await runTerminal(fixture, [english, physics], first, (p, _part, subject) => (p === 1 && subject === 1 ? 10 : 80), coordinator);
    expect(t1.status).toBe(201);
    expect(((await t1.json()) as { finalPublicationId: string | null }).finalPublicationId).toEqual(expect.any(String));
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'results.published' AND entity_public_id = ?1", fixture.classId)).toBe(3);
  });

  it("the final adds the scaled terminals, checks theory and practical, and passes only with every subject", async () => {
    const byName = (r: OwnCard[]) => r.find((x) => x.kind === "final")!.card.body;
    // Ram: English 24 + 25.50 + 36 = 85.50; Physics 24 + 25.05 + 36 = 85.05; overall 85.275 → 85.28, an A.
    const ram = byName(await own(0));
    expect(ram).toMatchObject({ percentHundredths: 8528, passed: true, grade: "A", outcome: "A" });
    expect(ram.subjects.map((s) => s.finalHundredths).sort()).toEqual([8505, 8550]);
    // Pupil 1: Physics theory 3 + 15 + 3 = 21 of 82.5 (25.45%) is under 35%: Physics NG, the result NG, though the total is 37.50.
    const weak = byName(await own(1));
    expect(weak).toMatchObject({ passed: false, grade: "NG", outcome: "NG", percentHundredths: 6150 });
    expect(weak.subjects.find((s) => s.name === physics.name)).toMatchObject({ finalHundredths: 3750, passed: false, grade: "NG" });
    // Pupil 2 was absent in Terminal 2's Physics theory (counted 0) and still passes over the term: 64.50 and 85.50 → 75.00, a B+.
    expect(byName(await own(2))).toMatchObject({ passed: true, percentHundredths: 7500, grade: "B+" });
  });

  it("the database refuses to change or delete a card or a publication", async () => {
    await expect(db.prepare("UPDATE marks_cards SET percent_hundredths = 10000").run()).rejects.toThrow(/snapshot/);
    await expect(db.prepare("DELETE FROM marks_cards").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("UPDATE result_publications SET pattern = '{}'").run()).rejects.toThrow(/never changes/);
    await expect(db.prepare("DELETE FROM result_publications").run()).rejects.toThrow(/never deleted/);
  });

  it("is refused while any subject is not verified, and the board says which one", async () => {
    const other = await resultsClass("plus2", 2, term);
    const a = await addSubject(other);
    const b = await addSubject(other);
    await enterAndSubmit(other, a, first, 70);
    await enterAndSubmit(other, b, first, 70);
    await post("/api/results/review/verify", { sheetIds: [await sheetIdOf(other, a, first)] }, coordinator);
    const refused = await post(`/api/results/classes/${other.classId}/publish`, { terminalId: first }, coordinator);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("not_ready");
    const board = (await (await call(`/api/results/review?terminalId=${first}`, { cookie: coordinator.cookie })).json()) as { classes: { classId: string; ready: boolean; subjects: { offeringId: string; status: string }[] }[] };
    const cls = board.classes.find((c) => c.classId === other.classId)!;
    expect(cls.ready).toBe(false);
    expect(cls.subjects.find((s) => s.offeringId === b.offeringId)!.status).toBe("under_review");
  });

  it("only the Co-ordinator (and Super Admin) publishes", async () => {
    for (const who of [admin, physics.teacher, fixture.pupils[0]!.person]) expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: first }, who)).status).toBe(403);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
