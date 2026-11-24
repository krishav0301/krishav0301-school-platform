import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { closeCheck } from "../src/modules/academics/years";
import { auditKey, call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, examTerm, pattern, resultsClass, runTerminal, sheetIdOf, type Subject, type Term } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * Taking a published exam back to be corrected (D-199, the PM, 2026-11-23). The Principal and Support take back one
 * class's exam, naming the subjects entered wrongly and why: those go back to their teachers as drafts, the rest wait as
 * verified, nobody sees the exam's result (nor the final) until the Co-ordinator publishes again, and publishing again adds
 * the next version of every card. Nothing is deleted. CLAUDE.md section 6: published marks cards are snapshots; a closed
 * year rejects writes; results publish for a whole class per terminal. Section 5: permissions are role + action + scope.
 */

let coordinator: Person, admin: Person, support: Person, accountant: Person;
let term: Term;
let fixture: ClassFixture;
let maths: Subject, english: Subject;
let first: string, second: string;
let firstPublication: string, finalPublication: string;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const takeBack = (cls: ClassFixture, terminalId: string, body: unknown, who: Person) => post(`/api/results/classes/${cls.classId}/terminals/${terminalId}/take-back`, body, who);
const own = async (who: Person) =>
  (await (await call("/api/results/me", { cookie: who.cookie })).json()) as {
    results: { kind: string; terminalName: string | null; card: { id: string; version: number; reason: string | null; body: { percentHundredths: number } } }[];
    beingCorrected: { yearLabel: string; terminalName: string | null }[];
  };
const sheetStatus = async (cls: ClassFixture, subject: Subject, terminalId: string) =>
  (await db.prepare("SELECT status, note FROM mark_sheets WHERE public_id = ?1").bind(await sheetIdOf(cls, subject, terminalId)).first<{ status: string; note: string | null }>())!;

beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  support = await person("super_admin", "institution");
  accountant = await person("accountant", "institution");
  term = await examTerm(pattern(false, [{ name: "First terminal", weight: 50, hasPractical: false }, { name: "Final", weight: 50, hasPractical: false }]));
  [first, second] = term.terminals as [string, string];
  fixture = await resultsClass("plus2", 3, term);
  maths = await addSubject(fixture);
  english = await addSubject(fixture);
  // First terminal: Maths entered wrongly as 40 for everyone; English right at 70.
  const one = await runTerminal(fixture, [maths, english], first, (_p, _c, s) => (s === 0 ? 40 : 70), coordinator);
  expect(one.status).toBe(201);
  firstPublication = ((await one.json()) as { publicationId: string }).publicationId;
  const two = await runTerminal(fixture, [maths, english], second, 80, coordinator);
  expect(two.status).toBe(201);
  finalPublication = ((await two.json()) as { finalPublicationId: string }).finalPublicationId;
});

describe("who may take a result back", () => {
  it("only the Principal and Support: the Co-ordinator who publishes, the Accountant, a teacher and a student are refused", async () => {
    const body = { reason: "Maths entered wrongly", offeringIds: [maths.offeringId] };
    for (const who of [coordinator, accountant, maths.teacher, fixture.pupils[0]!.person]) expect((await takeBack(fixture, first, body, who)).status).toBe(403);
    expect((await call(`/api/results/classes/${fixture.classId}/terminals/${first}/take-back`, { method: "POST", body })).status).toBe(401);
  });

  it("refuses a bad request: no subject, a short reason, a subject not in the result, an exam not published", async () => {
    expect((await takeBack(fixture, first, { reason: "Maths entered wrongly", offeringIds: [] }, admin)).status).toBe(400);
    expect((await takeBack(fixture, first, { reason: "x", offeringIds: [maths.offeringId] }, admin)).status).toBe(400);
    expect((await takeBack(fixture, first, { reason: "Not this one", offeringIds: [fixture.offeringId] }, admin)).status).toBe(422);
    const other = await resultsClass("plus2", 1, term);
    const subject = await addSubject(other);
    expect(await (await takeBack(other, first, { reason: "Never published", offeringIds: [subject.offeringId] }, admin)).json()).toEqual({ error: "not_published" });
  });

  it("waits for an open recheck of the exam to be decided first", async () => {
    const student = fixture.pupils[2]!.person;
    const asked = await post(`/api/results/publications/${firstPublication}/rechecks`, { offeringId: english.offeringId, reason: "Please check question 2" }, student);
    expect(asked.status).toBe(201);
    const response = await takeBack(fixture, first, { reason: "Maths entered wrongly", offeringIds: [maths.offeringId] }, admin);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "open_rechecks" });
    const recheckId = ((await asked.json()) as { id: string }).id;
    expect((await post(`/api/results/rechecks/${recheckId}/decide`, { outcome: "unchanged", reason: "Counted correctly" }, coordinator)).status).toBe(200);
  });
});

describe("taking it back, correcting it and publishing it again", () => {
  it("sends the chosen subject back to its teacher with the reason, and keeps the rest verified", async () => {
    const response = await takeBack(fixture, first, { reason: "Maths entered as 40 for everyone at the initial load", offeringIds: [maths.offeringId] }, admin);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ sentBack: 1 });
    expect(await sheetStatus(fixture, maths, first)).toEqual({ status: "draft", note: "Maths entered as 40 for everyone at the initial load" });
    expect((await sheetStatus(fixture, english, first)).status).toBe("verified");
    // The other exam is untouched.
    expect((await sheetStatus(fixture, maths, second)).status).toBe("published");
  });

  it("hides the exam and the final from everyone until it is published again, and names it for the student", async () => {
    const student = fixture.pupils[0]!.person;
    const mine = await own(student);
    expect(mine.results.map((r) => [r.kind, r.terminalName])).toEqual([["terminal", "Final"]]);
    expect(mine.beingCorrected.map((r) => r.terminalName)).toEqual([null, "First terminal"]);
    // The sheets, the ledger and the published list.
    expect((await call(`/api/results/classes/${fixture.classId}/terminals/${first}/sheet`, { cookie: admin.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/${fixture.classId}/final/sheet`, { cookie: coordinator.cookie })).status).toBe(404);
    expect((await call(`/api/results/classes/${fixture.classId}/terminals/${second}/sheet`, { cookie: coordinator.cookie })).status).toBe(200);
    const listed = (await (await call("/api/results/published", { cookie: admin.cookie })).json()) as { results: { classId: string; terminal: { id: string } | null }[] };
    expect(listed.results.filter((r) => r.classId === fixture.classId).map((r) => r.terminal?.id ?? null)).toEqual([second]);
    // The Top 20 ranks the final only, so the class drops out of it.
    const top = (await (await call("/api/results/top20", { cookie: student.cookie })).json()) as { pools: unknown[] };
    expect(top.pools).toEqual([]);
  });

  it("the Co-ordinator's board shows it as not published, with the reason, and not ready while the teacher corrects", async () => {
    const board = (await (await call(`/api/results/review?terminalId=${first}`, { cookie: coordinator.cookie })).json()) as { classes: { classId: string; published: boolean; finalPublished: boolean; ready: boolean; takenBack: string | null }[] };
    expect(board.classes.find((x) => x.classId === fixture.classId)).toMatchObject({ published: false, finalPublished: false, ready: false, takenBack: "Maths entered as 40 for everyone at the initial load" });
  });

  it("refuses a second take-back of the class, a recheck, and publishing before the subject is verified again", async () => {
    expect(await (await takeBack(fixture, first, { reason: "Again", offeringIds: [english.offeringId] }, support)).json()).toEqual({ error: "already_taken_back" });
    expect(await (await takeBack(fixture, second, { reason: "The other exam", offeringIds: [english.offeringId] }, admin)).json()).toEqual({ error: "already_taken_back" });
    expect((await post(`/api/results/publications/${firstPublication}/rechecks`, { offeringId: english.offeringId, reason: "While corrected" }, fixture.pupils[0]!.person)).status).not.toBe(201);
    expect(await (await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: first }, coordinator)).json()).toEqual({ error: "not_ready" });
  });

  it("the term cannot close while a result is taken back", async () => {
    const check = (await closeCheck(db, term.yearId))!;
    expect(check.missing.some((m) => m.classId === fixture.classId && m.examId === first)).toBe(true);
  });

  it("the teacher corrects, the Co-ordinator verifies and publishes again: the next version of every card, the old one kept", async () => {
    const oldFinal = (await db
      .prepare("SELECT mc.public_id AS id, mc.percent_hundredths AS percent FROM marks_cards mc JOIN result_publications rp ON rp.id = mc.publication_id JOIN enrollments en ON en.id = mc.enrollment_id WHERE rp.public_id = ?1 AND en.public_id = ?2 AND mc.version = 1")
      .bind(finalPublication, fixture.pupils[1]!.enrollmentId)
      .first<{ id: string; percent: number }>())!;
    await enterAndSubmit(fixture, maths, first, 90);
    await post("/api/results/review/verify", { sheetIds: [await sheetIdOf(fixture, maths, first)] }, coordinator);
    const again = await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: first }, coordinator);
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ publicationId: firstPublication, finalPublicationId: finalPublication, cards: 3 });

    const after = await own(fixture.pupils[1]!.person);
    expect(after.beingCorrected).toEqual([]);
    expect(after.results.map((r) => [r.kind, r.terminalName, r.card.version])).toEqual([
      ["final", null, 2],
      ["terminal", "Final", 1],
      ["terminal", "First terminal", 2],
    ]);
    // First terminal: (90 + 70) / 2; the final: half of it plus half of 80.
    expect(after.results[2]!.card).toMatchObject({ reason: "Maths entered as 40 for everyone at the initial load", body: { percentHundredths: 8000 } });
    expect(after.results[0]!.card.body.percentHundredths).toBe(8000);
    expect(oldFinal.percent).toBe(6750);
    // The old card is still there for staff, never changed.
    const kept = (await (await call(`/api/results/cards/${oldFinal.id}`, { cookie: coordinator.cookie })).json()) as { version: number; body: { percentHundredths: number } };
    expect(kept).toMatchObject({ version: 1, body: { percentHundredths: 6750 } });
    for (const s of [maths, english]) expect((await sheetStatus(fixture, s, first)).status).toBe("published");
    expect(await (await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: first }, coordinator)).json()).toEqual({ error: "already_published" });
  });

  it("records both in the audit log, and the chain holds", async () => {
    const actions = (await db.prepare("SELECT action, reason FROM audit_events WHERE entity_public_id = ?1 AND action IN ('results.taken_back', 'results.republished') ORDER BY id").bind(fixture.classId).all<{ action: string; reason: string }>()).results;
    expect(actions.map((a) => a.action)).toEqual(["results.taken_back", "results.republished"]);
    expect(actions[0]!.reason).toBe("Maths entered as 40 for everyone at the initial load");
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });

  it("Support may take back too; a student who joined since gets a first card when it is published again", async () => {
    expect((await takeBack(fixture, second, { reason: "English entered wrongly", offeringIds: [english.offeringId] }, support)).status).toBe(201);
    await enterAndSubmit(fixture, english, second, 60);
    await post("/api/results/review/verify", { sheetIds: [await sheetIdOf(fixture, english, second)] }, coordinator);
    expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: second }, coordinator)).status).toBe(201);
    const mine = await own(fixture.pupils[0]!.person);
    expect(mine.results.map((r) => r.card.version)).toEqual([3, 2, 2]);
  });
});

describe("the class's other exams wait while one is taken back", () => {
  it("the next exam cannot be published while an earlier one is being corrected", async () => {
    const three = await examTerm(pattern(false));
    const cls = await resultsClass("plus2", 1, three);
    const subject = await addSubject(cls);
    expect((await runTerminal(cls, [subject], three.terminals[0]!, 50, coordinator)).status).toBe(201);
    expect((await takeBack(cls, three.terminals[0]!, { reason: "Wrong marks", offeringIds: [subject.offeringId] }, admin)).status).toBe(201);
    const response = await runTerminal(cls, [subject], three.terminals[1]!, 50, coordinator);
    expect(await response.json()).toEqual({ error: "taken_back_elsewhere" });
  });
});

describe("the database guards, without the code", () => {
  it("a published sheet cannot go back to draft without an open withdrawal, and a withdrawal is never deleted or edited", async () => {
    const id = await sheetIdOf(fixture, maths, first);
    await expect(db.prepare("UPDATE mark_sheets SET status = 'draft', note = 'by hand' WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/status change is not allowed/);
    await expect(db.prepare("DELETE FROM result_withdrawals").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("UPDATE result_withdrawals SET reason = 'changed'").run()).rejects.toThrow(/closed once|never changes/);
    await expect(db.prepare("UPDATE result_withdrawals SET republished_at = NULL, republished_by_user_id = NULL").run()).rejects.toThrow(/closed once/);
  });
});
