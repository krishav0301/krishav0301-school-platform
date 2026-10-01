import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { addLevel, createProgramme, updateLevel, updateProgramme } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
});

const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");
const rows = () => count("SELECT (SELECT COUNT(*) FROM programmes) + (SELECT COUNT(*) FROM levels) AS n");
const input = (over: Record<string, unknown> = {}) => ({ name: "BBS", sectionKey: "bachelors", affiliation: "TU", ...over });

async function newProgramme(who: Person = admin, over: Record<string, unknown> = {}): Promise<string> {
  const result = await createProgramme(db, auditKey, who.publicId, input(over));
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.publicId;
}

// ---------------------------------------------------------------------------------------------
describe("createProgramme", () => {
  it("adds an active programme in its section, in order, and records who did it", async () => {
    const first = await newProgramme();
    const second = await newProgramme(admin, { name: "BBA", sectionKey: "bachelors" });
    const row = await db
      .prepare("SELECT p.name, p.affiliation, p.is_active, s.key AS section, p.ordering FROM programmes p JOIN sections s ON s.id = p.section_id WHERE p.public_id = ?1")
      .bind(first)
      .first<{ name: string; affiliation: string; is_active: number; section: string; ordering: number }>();
    expect(row).toMatchObject({ name: "BBS", affiliation: "TU", is_active: 1, section: "bachelors" });
    const next = await db.prepare("SELECT ordering FROM programmes WHERE public_id = ?1").bind(second).first<{ ordering: number }>();
    expect(next!.ordering).toBeGreaterThan(row!.ordering);
    expect(await auditActions(first)).toEqual(["academics.programme.created"]);
  });

  it("no Co-ordinator creates a programme, whole-school or one section, in their own section or another (D-087); nothing is written", async () => {
    const before = [await rows(), await audits()];
    for (const who of [coordinator, plus2Coordinator, bachelorsCoordinator]) {
      for (const sectionKey of ["plus2", "bachelors"]) expect(await createProgramme(db, auditKey, who.publicId, input({ sectionKey }))).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await rows(), await audits()]).toEqual(before);
  });

  it("the Admin and Support may create in any section", async () => {
    const support = await person("super_admin", "institution");
    expect((await createProgramme(db, auditKey, admin.publicId, input({ sectionKey: "plus2" }))).ok).toBe(true);
    expect((await createProgramme(db, auditKey, support.publicId, input({ sectionKey: "bachelors" }))).ok).toBe(true);
  });

  it("refuses an unknown section", async () => {
    expect(await createProgramme(db, auditKey, admin.publicId, input({ sectionKey: "nowhere" }))).toEqual({ ok: false, reason: "not_found" });
  });

  it.each([
    ["an empty name", { name: " " }],
    ["an empty affiliation", { affiliation: "" }],
    ["a name that is too long", { name: "x".repeat(121) }],
    ["a section written in capitals", { sectionKey: "Plus 2" }],
    ["a field that is not allowed", { key: "mine" }],
  ])("refuses %s, and writes nothing", async (_label, over) => {
    const before = [await rows(), await audits()];
    expect(await createProgramme(db, auditKey, admin.publicId, input(over) as never)).toMatchObject({ ok: false, reason: "invalid" });
    expect([await rows(), await audits()]).toEqual(before);
  });

  it("refuses every other role, and a switched-off Admin, and writes nothing", async () => {
    const off = await person("admin", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = [await rows(), await audits()];
    for (const [name, who] of [["coordinator", coordinator], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createProgramme(db, auditKey, who.publicId, input()), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await createProgramme(db, auditKey, off.publicId, input())).toEqual({ ok: false, reason: "not_allowed" });
    expect([await rows(), await audits()]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateProgramme", () => {
  it("renames, and deactivates, with before and after in the audit entry", async () => {
    const id = await newProgramme();
    expect(await updateProgramme(db, auditKey, admin.publicId, id, { name: "BBS (4 years)" })).toEqual({ ok: true });
    expect(await updateProgramme(db, auditKey, admin.publicId, id, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, is_active FROM programmes WHERE public_id = ?1").bind(id).first()).toEqual({ name: "BBS (4 years)", is_active: 0 });
    expect(await auditActions(id)).toEqual(["academics.programme.created", "academics.programme.updated", "academics.programme.updated"]);
  });

  it("changing nothing records nothing", async () => {
    const id = await newProgramme();
    const before = await audits();
    expect(await updateProgramme(db, auditKey, admin.publicId, id, { name: "BBS" })).toEqual({ ok: true });
    expect(await audits()).toBe(before);
  });

  it("no Co-ordinator changes a programme, even its own section's, and the programme is untouched (D-087)", async () => {
    const id = await newProgramme(admin, { sectionKey: "bachelors" });
    for (const who of [coordinator, plus2Coordinator, bachelorsCoordinator]) {
      expect(await updateProgramme(db, auditKey, who.publicId, id, { name: "Hijacked" })).toEqual({ ok: false, reason: "not_allowed" });
      expect(await updateProgramme(db, auditKey, who.publicId, id, { gradingPolicy: "percentage_division" })).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await updateProgramme(db, auditKey, admin.publicId, id, { name: "Ours" })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, grading_policy FROM programmes WHERE public_id = ?1").bind(id).first()).toEqual({ name: "Ours", grading_policy: null });
  });

  it("an unknown programme is not found", async () => {
    expect(await updateProgramme(db, auditKey, admin.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("addLevel", () => {
  it("numbers levels 1, 2, 3 in the order they are added", async () => {
    const id = await newProgramme();
    for (const name of ["Year 1", "Year 2", "Year 3"]) expect((await addLevel(db, auditKey, admin.publicId, id, { name })).ok).toBe(true);
    const levels = (await db.prepare("SELECT l.ordinal, l.name FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE p.public_id = ?1 ORDER BY l.ordinal").bind(id).all()).results;
    expect(levels).toEqual([{ ordinal: 1, name: "Year 1" }, { ordinal: 2, name: "Year 2" }, { ordinal: 3, name: "Year 3" }]);
  });

  it("numbers levels added at the same moment without a clash", async () => {
    const id = await newProgramme();
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => addLevel(db, auditKey, admin.publicId, id, { name: `Level ${n}` })));
    expect(results.every((r) => r.ok)).toBe(true);
    const ordinals = (await db.prepare("SELECT l.ordinal FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE p.public_id = ?1 ORDER BY l.ordinal").bind(id).all<{ ordinal: number }>()).results.map((r) => r.ordinal);
    expect(ordinals).toEqual([1, 2, 3, 4, 5]);
  });

  it("no Co-ordinator adds a level, even with the right id (D-087)", async () => {
    const id = await newProgramme(admin, { sectionKey: "bachelors" });
    const before = [await rows(), await audits()];
    for (const who of [coordinator, plus2Coordinator, bachelorsCoordinator]) expect(await addLevel(db, auditKey, who.publicId, id, { name: "Year 1" })).toEqual({ ok: false, reason: "not_allowed" });
    expect([await rows(), await audits()]).toEqual(before);
  });

  it("refuses an unknown programme, an inactive one, an empty name, and a 21st level", async () => {
    expect(await addLevel(db, auditKey, admin.publicId, "0".repeat(32), { name: "Year 1" })).toEqual({ ok: false, reason: "not_found" });

    const off = await newProgramme();
    await updateProgramme(db, auditKey, admin.publicId, off, { active: false });
    expect(await addLevel(db, auditKey, admin.publicId, off, { name: "Year 1" })).toMatchObject({ ok: false, reason: "invalid" });

    const id = await newProgramme();
    expect(await addLevel(db, auditKey, admin.publicId, id, { name: " " })).toMatchObject({ ok: false, reason: "invalid" });
    for (let n = 1; n <= 20; n++) expect((await addLevel(db, auditKey, admin.publicId, id, { name: `L${n}` })).ok).toBe(true);
    expect(await addLevel(db, auditKey, admin.publicId, id, { name: "L21" })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/at most 20/) });
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateLevel", () => {
  const level = async (programmeId: string, name = "Year 1") => {
    const r = await addLevel(db, auditKey, admin.publicId, programmeId, { name });
    if (!r.ok) throw new Error("setup failed");
    return r.publicId;
  };

  it("renames and deactivates a level, and records it", async () => {
    const levelId = await level(await newProgramme());
    expect(await updateLevel(db, auditKey, admin.publicId, levelId, { name: "First year" })).toEqual({ ok: true });
    expect(await updateLevel(db, auditKey, admin.publicId, levelId, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, is_active FROM levels WHERE public_id = ?1").bind(levelId).first()).toEqual({ name: "First year", is_active: 0 });
    expect(await auditActions(levelId)).toEqual(["academics.level.created", "academics.level.updated", "academics.level.updated"]);
  });

  it("every Co-ordinator and an unknown id are refused (D-087)", async () => {
    const levelId = await level(await newProgramme(admin, { sectionKey: "bachelors" }));
    for (const who of [coordinator, plus2Coordinator, bachelorsCoordinator]) expect(await updateLevel(db, auditKey, who.publicId, levelId, { name: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateLevel(db, auditKey, admin.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });
    expect(await db.prepare("SELECT name FROM levels WHERE public_id = ?1").bind(levelId).first()).toEqual({ name: "Year 1" });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
