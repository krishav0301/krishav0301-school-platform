import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { listSubjects } from "../src/modules/academics/queries";
import { createSubject, updateSubject } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");
const subjects = () => count("SELECT COUNT(*) AS n FROM subjects");
let n = 0;
const fresh = (over: Record<string, unknown> = {}) => ({ name: `Subject ${++n} ${crypto.randomUUID().slice(0, 6)}`, sectionKey: "plus2", ...over });

async function newSubject(who: Person = coordinator, over: Record<string, unknown> = {}): Promise<string> {
  const result = await createSubject(db, auditKey, who.publicId, fresh(over));
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.publicId;
}

// ---------------------------------------------------------------------------------------------
describe("createSubject", () => {
  it("adds a subject to the catalogue, active, and records who did it", async () => {
    const id = await newSubject(coordinator, { name: "Mathematics ", code: "MAT" });
    expect(await db.prepare("SELECT name, code, is_archived FROM subjects WHERE public_id = ?1").bind(id).first()).toEqual({ name: "Mathematics", code: "MAT", is_archived: 0 });
    const entry = await db.prepare("SELECT a.action, u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1").bind(id).first();
    expect(entry).toEqual({ action: "academics.subject.created", actor: coordinator.publicId });
  });

  it("the Super Admin may, and so may a section-scoped Co-ordinator (a catalogue entry is only a name)", async () => {
    expect((await createSubject(db, auditKey, superAdmin.publicId, fresh())).ok).toBe(true);
    expect((await createSubject(db, auditKey, plus2Coordinator.publicId, fresh())).ok).toBe(true);
  });

  it("a repeat name (in any letter case) or a repeat code is a conflict, with no false audit entry", async () => {
    const name = `Physics ${crypto.randomUUID().slice(0, 6)}`;
    await createSubject(db, auditKey, coordinator.publicId, { name, code: `P${n}`, sectionKey: "plus2" });
    const before = [await subjects(), await audits()];
    expect(await createSubject(db, auditKey, coordinator.publicId, { name: name.toUpperCase(), sectionKey: "plus2" })).toEqual({ ok: false, reason: "conflict" });
    expect(await createSubject(db, auditKey, coordinator.publicId, fresh({ code: `p${n}` }))).toEqual({ ok: false, reason: "conflict" });
    expect([await subjects(), await audits()]).toEqual(before);
  });

  it.each([
    ["an empty name", { name: "  " }],
    ["a name over 120 characters", { name: "x".repeat(121) }],
    ["a code over 20 characters", { code: "x".repeat(21) }],
    ["a field that is not allowed", { archived: true }],
  ])("refuses %s, and writes nothing", async (_label, over) => {
    const before = [await subjects(), await audits()];
    expect(await createSubject(db, auditKey, coordinator.publicId, fresh(over) as never)).toMatchObject({ ok: false, reason: "invalid" });
    expect([await subjects(), await audits()]).toEqual(before);
  });

  it("belongs to a wing (D-114): one is required and must exist; the same name may be used once in each wing", async () => {
    const before = [await subjects(), await audits()];
    expect(await createSubject(db, auditKey, coordinator.publicId, { name: "No wing" } as never)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createSubject(db, auditKey, coordinator.publicId, fresh({ sectionKey: "nowhere" }))).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/wing/i) });
    expect([await subjects(), await audits()]).toEqual(before);
    const name = `English ${crypto.randomUUID().slice(0, 6)}`;
    const code = `E${crypto.randomUUID().slice(0, 6)}`;
    const plus2 = await newSubject(coordinator, { name, code });
    const bachelors = await newSubject(coordinator, { name, code, sectionKey: "bachelors" });
    expect(plus2).not.toBe(bachelors);
    expect(await createSubject(db, auditKey, coordinator.publicId, fresh({ name: name.toLowerCase() }))).toEqual({ ok: false, reason: "conflict" });
  });

  it("a wing's Co-ordinator adds subjects to their own wing only", async () => {
    const before = [await subjects(), await audits()];
    expect(await createSubject(db, auditKey, plus2Coordinator.publicId, fresh({ sectionKey: "bachelors" }))).toEqual({ ok: false, reason: "not_allowed" });
    expect([await subjects(), await audits()]).toEqual(before);
    expect((await createSubject(db, auditKey, plus2Coordinator.publicId, fresh({ sectionKey: "plus2" }))).ok).toBe(true);
  });

  it("refuses every other role and a switched-off Co-ordinator, and writes nothing", async () => {
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = [await subjects(), await audits()];
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student], ["switched off", off]] as const) {
      expect(await createSubject(db, auditKey, who.publicId, fresh()), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await subjects(), await audits()]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateSubject", () => {
  it("renames, recodes and archives, with each recorded", async () => {
    const id = await newSubject();
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { name: "Computer Science" })).toEqual({ ok: true });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { code: "CS" })).toEqual({ ok: true });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { archived: true })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, code, is_archived FROM subjects WHERE public_id = ?1").bind(id).first()).toEqual({ name: "Computer Science", code: "CS", is_archived: 1 });
    expect(await auditActions(id)).toEqual(["academics.subject.created", "academics.subject.updated", "academics.subject.updated", "academics.subject.updated"]);
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { archived: false })).toEqual({ ok: true });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { code: null })).toEqual({ ok: true });
    expect(await db.prepare("SELECT code, is_archived FROM subjects WHERE public_id = ?1").bind(id).first()).toEqual({ code: null, is_archived: 0 });
  });

  it("changing nothing records nothing", async () => {
    const id = await newSubject(coordinator, { name: "Nepali" });
    const before = await audits();
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { name: "Nepali" })).toEqual({ ok: true });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, {})).toEqual({ ok: true });
    expect(await audits()).toBe(before);
  });

  it("renaming to a name that is taken is a conflict and changes nothing", async () => {
    const taken = `Taken ${crypto.randomUUID().slice(0, 6)}`;
    await createSubject(db, auditKey, coordinator.publicId, { name: taken, sectionKey: "plus2" });
    const id = await newSubject();
    const before = await audits();
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { name: taken.toLowerCase() })).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });

  it("changing a word every section uses needs a whole-school Co-ordinator: a +2 Co-ordinator, the Admin and the rest are refused", async () => {
    const id = await newSubject(plus2Coordinator, { name: "English" });
    const before = await audits();
    for (const [name, who] of [["+2 Co-ordinator", plus2Coordinator], ["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await updateSubject(db, auditKey, who.publicId, id, { name: "Hijacked" }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await audits()).toBe(before);
    expect(await updateSubject(db, auditKey, superAdmin.publicId, id, { code: "ENG" })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name FROM subjects WHERE public_id = ?1").bind(id).first()).toEqual({ name: "English" });
  });

  it("an old subject with no wing is given one by a whole-school Co-ordinator; once given, the wing stays (D-114)", async () => {
    const id = await newSubject();
    await db.prepare("UPDATE subjects SET section_id = NULL WHERE public_id = ?1").bind(id).run();
    expect(await updateSubject(db, auditKey, plus2Coordinator.publicId, id, { sectionKey: "plus2" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { sectionKey: "bachelors" })).toEqual({ ok: true });
    expect(await db.prepare("SELECT s.key FROM subjects x JOIN sections s ON s.id = x.section_id WHERE x.public_id = ?1").bind(id).first()).toEqual({ key: "bachelors" });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { sectionKey: "plus2" })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/wing/i) });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { sectionKey: "bachelors" })).toEqual({ ok: true }); // the same wing: nothing to do
  });

  it("an unknown subject is not found, and a bad change is invalid", async () => {
    expect(await updateSubject(db, auditKey, coordinator.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });
    const id = await newSubject();
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { name: "" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { nonsense: true } as never)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("listSubjects (D-114)", () => {
  it("each subject says its wing; a wing's Co-ordinator sees only their wing's, everyone else every subject and the unsorted ones", async () => {
    const plus2 = await newSubject(coordinator, { sectionKey: "plus2" });
    const bachelors = await newSubject(coordinator, { sectionKey: "bachelors" });
    const unsorted = await newSubject(coordinator, { sectionKey: "plus2" });
    await db.prepare("UPDATE subjects SET section_id = NULL WHERE public_id = ?1").bind(unsorted).run();
    const all = (await listSubjects(db, "all")).subjects;
    expect(all.find((s) => s.id === plus2)?.sectionKey).toBe("plus2");
    expect(all.find((s) => s.id === bachelors)?.sectionKey).toBe("bachelors");
    expect(all.find((s) => s.id === unsorted)?.sectionKey).toBeNull();
    const ids = (await listSubjects(db, ["plus2"])).subjects.map((s) => s.id);
    expect(ids).toContain(plus2);
    expect(ids).not.toContain(bachelors);
    expect(ids).not.toContain(unsorted);
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
