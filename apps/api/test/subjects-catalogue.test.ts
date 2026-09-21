import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
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
const fresh = (over: Record<string, unknown> = {}) => ({ name: `Subject ${++n} ${crypto.randomUUID().slice(0, 6)}`, ...over });

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
    await createSubject(db, auditKey, coordinator.publicId, { name, code: `P${n}` });
    const before = [await subjects(), await audits()];
    expect(await createSubject(db, auditKey, coordinator.publicId, { name: name.toUpperCase() })).toEqual({ ok: false, reason: "conflict" });
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
    await createSubject(db, auditKey, coordinator.publicId, { name: taken });
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

  it("an unknown subject is not found, and a bad change is invalid", async () => {
    expect(await updateSubject(db, auditKey, coordinator.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });
    const id = await newSubject();
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { name: "" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await updateSubject(db, auditKey, coordinator.publicId, id, { nonsense: true } as never)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
