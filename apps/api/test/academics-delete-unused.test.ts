import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { newPublicId } from "../src/core/ids";
import { auditActions, auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, examTerm, pattern, resultsClass } from "./results-helpers";

/**
 * Deleting what was set up by mistake (the PM, 2026-10-12): a term, a subject on a level, an elective group and a term's
 * exam pattern can each be deleted while nothing uses it; once something does, the answer is 409 "in_use" (or "locked"
 * for the pattern) and the thing is switched off instead. Only the person who sets each one up may delete it.
 */

let admin: Person, coordinator: Person, bachelorsCoordinator: Person, teacher: Person;

const del = (path: string, who: Person) => call(path, { method: "DELETE", cookie: who.cookie });
const gone = async (table: string, publicId: string) => (await count(`SELECT COUNT(*) AS n FROM ${table} WHERE public_id = ?1`, publicId)) === 0;

beforeAll(async () => {
  await seedSections();
  admin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  teacher = await person("teacher", "assigned");
});

describe("a term", () => {
  it("is deleted by the Principal while nobody has used it, with its exam pattern and exams", async () => {
    const term = await examTerm(pattern(false));
    expect((await del(`/api/academics/years/${term.yearId}`, admin)).status).toBe(200);
    expect(await gone("academic_years", term.yearId)).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM terminals t WHERE t.public_id = ?1", term.terminals[0]!)).toBe(0);
    expect(await auditActions(term.yearId)).toContain("academics.year.deleted");
  });

  it("is refused once it has a class, and only the Principal may delete one", async () => {
    const term = await examTerm(pattern(false));
    expect((await del(`/api/academics/years/${term.yearId}`, coordinator)).status).toBe(403);
    expect((await del(`/api/academics/years/${term.yearId}`, teacher)).status).toBe(403);
    await resultsClass("plus2", 1, term);
    expect((await del(`/api/academics/years/${term.yearId}`, admin)).status).toBe(409);
    expect(await gone("academic_years", term.yearId)).toBe(false);
  });

  it("says whether it can be deleted in the list, and a closed term never can", async () => {
    const free = await examTerm(pattern(false));
    const used = await examTerm(pattern(false));
    await resultsClass("plus2", 1, used);
    const list = (await (await call("/api/academics/years", { cookie: admin.cookie })).json()) as { years: { id: string; canDelete: boolean }[] };
    expect(list.years.find((y) => y.id === free.yearId)!.canDelete).toBe(true);
    expect(list.years.find((y) => y.id === used.yearId)!.canDelete).toBe(false);
    const closed = await examTerm(pattern(false));
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-10-12T00:00:00Z' WHERE public_id = ?1").bind(closed.yearId).run();
    expect((await del(`/api/academics/years/${closed.yearId}`, admin)).status).toBe(409);
  });
});

describe("an exam pattern", () => {
  it("is deleted by the Co-ordinator before any mark, and the term can make another", async () => {
    const term = await examTerm(pattern(false));
    const before = (await (await call(`/api/academics/years/${term.yearId}/exam-pattern`, { cookie: coordinator.cookie })).json()) as { canDelete: boolean };
    expect(before.canDelete).toBe(true);
    expect((await del(`/api/academics/years/${term.yearId}/exam-pattern`, admin)).status).toBe(403);
    expect((await del(`/api/academics/years/${term.yearId}/exam-pattern`, coordinator)).status).toBe(200);
    const after = (await (await call(`/api/academics/years/${term.yearId}/exam-pattern`, { cookie: coordinator.cookie })).json()) as { pattern: unknown; terminals: unknown[]; canDelete: boolean };
    expect(after).toMatchObject({ pattern: null, terminals: [], canDelete: false });
    expect((await del(`/api/academics/years/${term.yearId}/exam-pattern`, coordinator)).status).toBe(404);
  });

  it("is locked, and so cannot be deleted, once a mark has been entered", async () => {
    const term = await examTerm(pattern(false));
    const fixture = await resultsClass("plus2", 1, term);
    const subject = await addSubject(fixture);
    await enterAndSubmit(fixture, subject, term.terminals[0]!, 50, false);
    expect((await del(`/api/academics/years/${term.yearId}/exam-pattern`, coordinator)).status).toBe(409);
    // The database holds the same line, whoever asks.
    await expect(db.prepare("DELETE FROM exam_patterns WHERE academic_year_id = (SELECT id FROM academic_years WHERE public_id = ?1)").bind(term.yearId).run()).rejects.toThrow(/locked/);
  });
});

describe("a subject on a level", () => {
  it("is deleted while no teacher, note, mark sheet or pick uses it, and refused once one does", async () => {
    const term = await examTerm(pattern(false));
    const fixture = await resultsClass("plus2", 1, term);
    const taught = await addSubject(fixture); // a teacher is assigned
    expect((await del(`/api/academics/offerings/${taught.offeringId}`, coordinator)).status).toBe(409);

    // An offering with nobody assigned.
    const subjectId = newPublicId();
    await db.prepare("INSERT INTO subjects (public_id, name, section_id) SELECT ?1, 'Extra subject', id FROM sections WHERE key = 'plus2'").bind(subjectId).run();
    const offeringId = newPublicId();
    await db.prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id) SELECT ?1, ?2, s.id FROM subjects s WHERE s.public_id = ?3").bind(offeringId, (await db.prepare("SELECT l.id FROM levels l JOIN subject_offerings o ON o.level_id = l.id WHERE o.public_id = ?1").bind(taught.offeringId).first<{ id: number }>())!.id, subjectId).run();
    const curriculumLevel = (await db.prepare("SELECT l.public_id AS id FROM levels l JOIN subject_offerings o ON o.level_id = l.id WHERE o.public_id = ?1").bind(offeringId).first<{ id: string }>())!.id;
    const read = (await (await call(`/api/academics/curriculum?level=${curriculumLevel}`, { cookie: coordinator.cookie })).json()) as { offerings: { id: string; canDelete: boolean }[] };
    expect(read.offerings.find((o) => o.id === offeringId)!.canDelete).toBe(true);
    expect(read.offerings.find((o) => o.id === taught.offeringId)!.canDelete).toBe(false);

    expect((await del(`/api/academics/offerings/${offeringId}`, bachelorsCoordinator)).status).toBe(403);
    expect((await del(`/api/academics/offerings/${offeringId}`, teacher)).status).toBe(403);
    expect((await del(`/api/academics/offerings/${offeringId}`, coordinator)).status).toBe(200);
    expect(await gone("subject_offerings", offeringId)).toBe(true);
    expect(await auditActions(offeringId)).toContain("academics.offering.deleted");
  });

  it("is refused once it has a mark sheet, though nobody teaches it any more", async () => {
    const term = await examTerm(pattern(false));
    const fixture = await resultsClass("plus2", 1, term);
    const subject = await addSubject(fixture);
    await enterAndSubmit(fixture, subject, term.terminals[0]!, 60, false);
    await db.prepare("UPDATE teacher_assignments SET is_active = 0").run();
    expect((await del(`/api/academics/offerings/${subject.offeringId}`, coordinator)).status).toBe(409);
  });
});

describe("an elective group", () => {
  it("is deleted when empty, and refused while a subject is in it", async () => {
    const term = await examTerm(pattern(false));
    const fixture = await resultsClass("plus2", 1, term);
    const groupId = newPublicId();
    await db.prepare("INSERT INTO elective_groups (public_id, level_id, name) SELECT ?1, id, 'Option' FROM levels WHERE public_id = ?2").bind(groupId, fixture.levelId).run();
    const inGroup = await addSubject(fixture, {}, { groupId });
    expect((await del(`/api/academics/groups/${groupId}`, coordinator)).status).toBe(409);
    await db.prepare("UPDATE subject_offerings SET elective_group_id = NULL WHERE public_id = ?1").bind(inGroup.offeringId).run();
    expect((await del(`/api/academics/groups/${groupId}`, bachelorsCoordinator)).status).toBe(403);
    expect((await del(`/api/academics/groups/${groupId}`, coordinator)).status).toBe(200);
    expect(await gone("elective_groups", groupId)).toBe(true);
  });
});

describe("after all that", () => {
  it("the audit log is one unbroken chain", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
