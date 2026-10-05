import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import {
  addComponent,
  addLevel,
  createGroup,
  createOffering,
  createProgramme,
  createSubject,
  updateComponent,
  updateGroup,
  updateLevel,
  updateOffering,
  updateProgramme,
} from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person, programmesAdmin } from "./academics-helpers";

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
const groups = () => count("SELECT COUNT(*) AS n FROM elective_groups");
const offerings = () => count("SELECT COUNT(*) AS n FROM subject_offerings");
const components = () => count("SELECT COUNT(*) AS n FROM mark_components");
const noId = "0".repeat(32);
let n = 0;
const label = (prefix: string) => `${prefix} ${++n} ${crypto.randomUUID().slice(0, 6)}`;

const ok = <T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(`setup failed (${what}): ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
};

/** A programme with one level in the given section. */
async function newLevel(sectionKey: "plus2" | "bachelors" = "bachelors") {
  const p = ok(await createProgramme(db, auditKey, (await programmesAdmin()).publicId, { name: label("Programme"), sectionKey, affiliation: "Board" }), "programme");
  const l = ok(await addLevel(db, auditKey, (await programmesAdmin()).publicId, p.publicId, { name: "Level 1", usualMonths: 12 }), "level");
  return { programmeId: p.publicId, levelId: l.publicId };
}
const newSubject = async (over: Record<string, unknown> = {}) => ok(await createSubject(db, auditKey, coordinator.publicId, { name: label("Subject"), ...over }), "subject").publicId;
const newGroup = async (levelId: string, over: Record<string, unknown> = {}) => ok(await createGroup(db, auditKey, coordinator.publicId, levelId, { name: label("Group"), ...over }), "group").publicId;
const newOffering = async (levelId: string, subjectId?: string, extra: Record<string, unknown> = {}) =>
  ok(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: subjectId ?? (await newSubject()), ...extra } as never), "offering").publicId;

// ---------------------------------------------------------------------------------------------
describe("elective groups", () => {
  it("adds a group to a level with one pick unless said otherwise, and records who did it", async () => {
    const { levelId } = await newLevel();
    const id = await newGroup(levelId, { name: "Science option" });
    expect(await db.prepare("SELECT name, pick_count, is_active FROM elective_groups WHERE public_id = ?1").bind(id).first()).toEqual({ name: "Science option", pick_count: 1, is_active: 1 });
    const two = await newGroup(levelId, { pickCount: 2 });
    expect(await db.prepare("SELECT pick_count FROM elective_groups WHERE public_id = ?1").bind(two).first()).toEqual({ pick_count: 2 });
    expect(await auditActions(id)).toEqual(["academics.group.created"]);
  });

  it("a name is used once per level (a conflict), and a pick count is 1 to 10", async () => {
    const { levelId } = await newLevel();
    await newGroup(levelId, { name: "Option" });
    const before = [await groups(), await audits()];
    expect(await createGroup(db, auditKey, coordinator.publicId, levelId, { name: "Option" })).toEqual({ ok: false, reason: "conflict" });
    expect(await createGroup(db, auditKey, coordinator.publicId, levelId, { name: "Zero", pickCount: 0 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createGroup(db, auditKey, coordinator.publicId, levelId, { name: "Eleven", pickCount: 11 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createGroup(db, auditKey, coordinator.publicId, levelId, { name: " " })).toMatchObject({ ok: false, reason: "invalid" });
    expect([await groups(), await audits()]).toEqual(before);
  });

  it("renames, changes how many are picked, and switches off and on; changing nothing records nothing", async () => {
    const { levelId } = await newLevel();
    const id = await newGroup(levelId, { name: "Option" });
    expect(await updateGroup(db, auditKey, coordinator.publicId, id, { name: "Science option", pickCount: 2 })).toEqual({ ok: true });
    expect(await updateGroup(db, auditKey, coordinator.publicId, id, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, pick_count, is_active FROM elective_groups WHERE public_id = ?1").bind(id).first()).toEqual({ name: "Science option", pick_count: 2, is_active: 0 });
    const before = await audits();
    expect(await updateGroup(db, auditKey, coordinator.publicId, id, { name: "Science option" })).toEqual({ ok: true });
    expect(await audits()).toBe(before);
    expect(await auditActions(id)).toEqual(["academics.group.created", "academics.group.updated", "academics.group.updated"]);
  });

  it("another section's Co-ordinator gets nothing, even with the right ids; the Admin and the rest are refused", async () => {
    const { levelId } = await newLevel("bachelors");
    const id = await newGroup(levelId);
    const before = [await groups(), await audits()];
    expect(await createGroup(db, auditKey, plus2Coordinator.publicId, levelId, { name: "Sneaky" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateGroup(db, auditKey, plus2Coordinator.publicId, id, { name: "Hijacked" })).toEqual({ ok: false, reason: "not_allowed" });
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createGroup(db, auditKey, who.publicId, levelId, { name: "x" }), name).toEqual({ ok: false, reason: "not_allowed" });
      expect(await updateGroup(db, auditKey, who.publicId, id, { name: "x" }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await groups(), await audits()]).toEqual(before);
    expect((await createGroup(db, auditKey, bachelorsCoordinator.publicId, levelId, { name: "Ours" })).ok).toBe(true);
  });

  it("an unknown level or group is not found; a switched-off level takes no group", async () => {
    expect(await createGroup(db, auditKey, coordinator.publicId, noId, { name: "x" })).toEqual({ ok: false, reason: "not_found" });
    expect(await updateGroup(db, auditKey, coordinator.publicId, noId, { name: "x" })).toEqual({ ok: false, reason: "not_found" });
    const { levelId } = await newLevel();
    await updateLevel(db, auditKey, (await programmesAdmin()).publicId, levelId, { active: false });
    expect(await createGroup(db, auditKey, coordinator.publicId, levelId, { name: "x" })).toMatchObject({ ok: false, reason: "invalid" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("subject offerings", () => {
  it("adds a subject to a level, with or without credit hours and a group, and records who did it", async () => {
    const { levelId } = await newLevel();
    const group = await newGroup(levelId);
    const plain = await newOffering(levelId);
    const full = await newOffering(levelId, undefined, { creditHundredths: 375, groupId: group });
    expect(await db.prepare("SELECT credit_hundredths, elective_group_id, is_active FROM subject_offerings WHERE public_id = ?1").bind(plain).first()).toEqual({ credit_hundredths: null, elective_group_id: null, is_active: 1 });
    const row = await db
      .prepare("SELECT o.credit_hundredths, g.public_id AS group_id FROM subject_offerings o JOIN elective_groups g ON g.id = o.elective_group_id WHERE o.public_id = ?1")
      .bind(full)
      .first();
    expect(row).toEqual({ credit_hundredths: 375, group_id: group });
    expect(await auditActions(full)).toEqual(["academics.offering.created"]);
  });

  it("a subject is offered once per level (a conflict); credit outside 1 to 10000 is invalid", async () => {
    const { levelId } = await newLevel();
    const subjectId = await newSubject();
    await newOffering(levelId, subjectId);
    const other = await newSubject();
    const before = [await offerings(), await audits()];
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId })).toEqual({ ok: false, reason: "conflict" });
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: other, creditHundredths: 0 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: other, creditHundredths: 10001 })).toMatchObject({ ok: false, reason: "invalid" });
    expect([await offerings(), await audits()]).toEqual(before);
  });

  it("refuses an archived subject, a switched-off level, a switched-off programme, and a switched-off group", async () => {
    const { levelId, programmeId } = await newLevel();
    const archived = await newSubject();
    await db.prepare("UPDATE subjects SET is_archived = 1 WHERE public_id = ?1").bind(archived).run();
    const offeringEntries = () => count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'academics.offering.created'");
    const before = [await offerings(), await offeringEntries()];
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: archived })).toMatchObject({ ok: false, reason: "invalid" });

    const group = await newGroup(levelId);
    await updateGroup(db, auditKey, coordinator.publicId, group, { active: false });
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: await newSubject(), groupId: group })).toMatchObject({ ok: false, reason: "invalid" });

    await updateProgramme(db, auditKey, (await programmesAdmin()).publicId, programmeId, { active: false });
    const fresh = await newSubject();
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: fresh })).toMatchObject({ ok: false, reason: "invalid" });
    await updateProgramme(db, auditKey, (await programmesAdmin()).publicId, programmeId, { active: true });
    await updateLevel(db, auditKey, (await programmesAdmin()).publicId, levelId, { active: false });
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: fresh })).toMatchObject({ ok: false, reason: "invalid" });
    expect([await offerings(), await offeringEntries()]).toEqual(before);
  });

  it("refuses a group of another level, and nothing is written", async () => {
    const a = await newLevel();
    const b = await newLevel();
    const groupOfB = await newGroup(b.levelId);
    const before = [await offerings(), await audits()];
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId: a.levelId, subjectId: await newSubject(), groupId: groupOfB })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId: a.levelId, subjectId: await newSubject(), groupId: noId })).toMatchObject({ ok: false, reason: "invalid" });
    expect((await offerings()) - before[0]!).toBe(0);
  });

  it("another section's Co-ordinator gets nothing even with the right ids; the Admin and the rest are refused; unknown ids are not found", async () => {
    const { levelId } = await newLevel("bachelors");
    const subjectId = await newSubject();
    const offering = await newOffering(levelId);
    const before = [await offerings(), await audits()];
    expect(await createOffering(db, auditKey, plus2Coordinator.publicId, { levelId, subjectId })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateOffering(db, auditKey, plus2Coordinator.publicId, offering, { active: false })).toEqual({ ok: false, reason: "not_allowed" });
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createOffering(db, auditKey, who.publicId, { levelId, subjectId }), name).toEqual({ ok: false, reason: "not_allowed" });
      expect(await updateOffering(db, auditKey, who.publicId, offering, { active: false }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await offerings(), await audits()]).toEqual(before);
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId: noId, subjectId })).toEqual({ ok: false, reason: "not_found" });
    expect(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: noId })).toEqual({ ok: false, reason: "not_found" });
    expect(await updateOffering(db, auditKey, coordinator.publicId, noId, { active: false })).toEqual({ ok: false, reason: "not_found" });
  });

  it("changes credit hours (and takes them away), moves between groups of its level, takes the group away, switches off and on", async () => {
    const { levelId } = await newLevel();
    const g1 = await newGroup(levelId);
    const g2 = await newGroup(levelId);
    const id = await newOffering(levelId);
    const state = () => db.prepare("SELECT o.credit_hundredths AS credit, g.public_id AS grp, o.is_active AS active FROM subject_offerings o LEFT JOIN elective_groups g ON g.id = o.elective_group_id WHERE o.public_id = ?1").bind(id).first();

    expect(await updateOffering(db, auditKey, coordinator.publicId, id, { creditHundredths: 400, groupId: g1 })).toEqual({ ok: true });
    expect(await state()).toEqual({ credit: 400, grp: g1, active: 1 });
    expect(await updateOffering(db, auditKey, coordinator.publicId, id, { groupId: g2 })).toEqual({ ok: true });
    expect(await updateOffering(db, auditKey, coordinator.publicId, id, { creditHundredths: null, groupId: null })).toEqual({ ok: true });
    expect(await state()).toEqual({ credit: null, grp: null, active: 1 });
    expect(await updateOffering(db, auditKey, coordinator.publicId, id, { active: false })).toEqual({ ok: true });
    expect(await updateOffering(db, auditKey, coordinator.publicId, id, { active: true })).toEqual({ ok: true });
    expect(await auditActions(id)).toHaveLength(6);
  });

  it("a group of another level in an update is invalid and nothing changes; changing nothing records nothing", async () => {
    const a = await newLevel();
    const b = await newLevel();
    const id = await newOffering(a.levelId);
    const groupOfB = await newGroup(b.levelId);
    const before = await audits();
    expect(await updateOffering(db, auditKey, coordinator.publicId, id, { groupId: groupOfB })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await updateOffering(db, auditKey, coordinator.publicId, id, { groupId: noId })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await updateOffering(db, auditKey, coordinator.publicId, id, {})).toEqual({ ok: true });
    expect(await db.prepare("SELECT elective_group_id FROM subject_offerings WHERE public_id = ?1").bind(id).first()).toEqual({ elective_group_id: null });
    expect(await audits()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("mark components", () => {
  it("are numbered 1, 2, 3 in the order added (including several at once), and recorded", async () => {
    const { levelId } = await newLevel();
    const offering = await newOffering(levelId);
    const results = await Promise.all(["Theory", "Practical", "Internal"].map((name) => addComponent(db, auditKey, coordinator.publicId, offering, { name, maxHundredths: 5000 })));
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = (await db.prepare("SELECT c.ordinal FROM mark_components c JOIN subject_offerings o ON o.id = c.offering_id WHERE o.public_id = ?1 ORDER BY c.ordinal").bind(offering).all<{ ordinal: number }>()).results;
    expect(rows.map((r) => r.ordinal)).toEqual([1, 2, 3]);
    const first = results[0]!;
    if (first.ok) expect(await auditActions(first.publicId)).toEqual(["academics.component.created"]);
  });

  it("a repeat name is a conflict, the 11th component is invalid, and a maximum outside 1 to 100000 is invalid", async () => {
    const { levelId } = await newLevel();
    const offering = await newOffering(levelId);
    ok(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "Theory", maxHundredths: 7500 }), "component");
    const before = [await components(), await audits()];
    expect(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "Theory", maxHundredths: 100 })).toEqual({ ok: false, reason: "conflict" });
    expect(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "Zero", maxHundredths: 0 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "Huge", maxHundredths: 100001 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "Decimal", maxHundredths: 12.5 })).toMatchObject({ ok: false, reason: "invalid" });
    expect([await components(), await audits()]).toEqual(before);
    for (let i = 2; i <= 10; i++) ok(await addComponent(db, auditKey, coordinator.publicId, offering, { name: `C${i}`, maxHundredths: 100 }), `component ${i}`);
    expect(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "C11", maxHundredths: 100 })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/at most 10/) });
  });

  it("renames, changes the maximum, and switches off and on; changing nothing records nothing", async () => {
    const { levelId } = await newLevel();
    const offering = await newOffering(levelId);
    const id = ok(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "Theory", maxHundredths: 7500 }), "component").publicId;
    expect(await updateComponent(db, auditKey, coordinator.publicId, id, { name: "Written", maxHundredths: 8000 })).toEqual({ ok: true });
    expect(await updateComponent(db, auditKey, coordinator.publicId, id, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT name, max_hundredths, is_active FROM mark_components WHERE public_id = ?1").bind(id).first()).toEqual({ name: "Written", max_hundredths: 8000, is_active: 0 });
    const before = await audits();
    expect(await updateComponent(db, auditKey, coordinator.publicId, id, { name: "Written" })).toEqual({ ok: true });
    expect(await audits()).toBe(before);
  });

  it("another section's Co-ordinator gets nothing; the Admin and the rest are refused; unknown ids are not found", async () => {
    const { levelId } = await newLevel("bachelors");
    const offering = await newOffering(levelId);
    const id = ok(await addComponent(db, auditKey, coordinator.publicId, offering, { name: "Theory", maxHundredths: 7500 }), "component").publicId;
    const before = [await components(), await audits()];
    expect(await addComponent(db, auditKey, plus2Coordinator.publicId, offering, { name: "Sneaky", maxHundredths: 100 })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateComponent(db, auditKey, plus2Coordinator.publicId, id, { name: "Hijacked" })).toEqual({ ok: false, reason: "not_allowed" });
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await addComponent(db, auditKey, who.publicId, offering, { name: "x", maxHundredths: 100 }), name).toEqual({ ok: false, reason: "not_allowed" });
      expect(await updateComponent(db, auditKey, who.publicId, id, { name: "x" }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await components(), await audits()]).toEqual(before);
    expect(await addComponent(db, auditKey, coordinator.publicId, noId, { name: "x", maxHundredths: 100 })).toEqual({ ok: false, reason: "not_found" });
    expect(await updateComponent(db, auditKey, coordinator.publicId, noId, { name: "x" })).toEqual({ ok: false, reason: "not_found" });
  });
});

it("a switched-off Co-ordinator with a valid sign-in is refused, and nothing is written", async () => {
  const off = await person("coordinator", "institution");
  await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
  const { levelId } = await newLevel();
  const subjectId = await newSubject();
  const before = [await groups(), await offerings(), await audits()];
  expect(await createGroup(db, auditKey, off.publicId, levelId, { name: "x" })).toEqual({ ok: false, reason: "not_allowed" });
  expect(await createOffering(db, auditKey, off.publicId, { levelId, subjectId })).toEqual({ ok: false, reason: "not_allowed" });
  expect([await groups(), await offerings(), await audits()]).toEqual(before);
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
