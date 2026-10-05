import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/core/config";
import { listClasses, listProgrammes } from "../src/modules/academics/queries";
import { addLevel, createProgramme, createSection, deleteClass, deleteLevel, deleteProgramme, deleteSection, updateSection } from "../src/modules/academics/service";
import { auditKey, db, person } from "./academics-helpers";
import { classWith } from "./schoolday-helpers";

/**
 * D-097: a section, programme or level may be deleted only while nothing is attached to it; otherwise it can only be
 * switched off. A switched-off section takes no new programmes and is no longer offered where a section is chosen.
 */

const key = auditKey;
const sectionRow = (k: string) => db.prepare("SELECT key, is_active FROM sections WHERE key = ?1").bind(k).first<{ key: string; is_active: number }>();
const audited = (entity: string, action: string) =>
  db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_public_id = ?1 AND action = ?2").bind(entity, action).first<{ n: number }>().then((r) => r!.n);

async function admin() {
  return (await person("admin", "institution")).publicId;
}

async function newSection(actor: string, name = `Section ${crypto.randomUUID().slice(0, 6)}`) {
  const made = await createSection(db, key, actor, { name });
  if (!made.ok) throw new Error(`section: ${made.reason}`);
  return made.key;
}

describe("deleting what nothing is attached to", () => {
  it("an empty section shows it can be deleted, is deleted, and the deletion is audited", async () => {
    const actor = await admin();
    const sectionKey = await newSection(actor);
    expect((await listProgrammes(db, "all")).sections.find((s) => s.key === sectionKey)).toMatchObject({ canDelete: true, active: true });

    expect(await deleteSection(db, key, actor, sectionKey)).toEqual({ ok: true });
    expect(await sectionRow(sectionKey)).toBeNull();
    expect(await audited(sectionKey, "academics.section.deleted")).toBe(1);
  });

  it("works from the bottom up: a level, then its programme, then its section, each only once the one below is gone", async () => {
    const actor = await admin();
    const sectionKey = await newSection(actor);
    const programme = await createProgramme(db, key, actor, { name: "BCA", sectionKey, affiliation: "TU" });
    if (!programme.ok) throw new Error("programme");
    const level = await addLevel(db, key, actor, programme.publicId, { name: "Year 1", usualMonths: 12 });
    if (!level.ok) throw new Error("level");

    const before = await listProgrammes(db, "all");
    expect(before.sections.find((s) => s.key === sectionKey)!.canDelete).toBe(false);
    expect(before.programmes.find((p) => p.id === programme.publicId)!.canDelete).toBe(false);
    expect(await deleteSection(db, key, actor, sectionKey)).toEqual({ ok: false, reason: "in_use" });
    expect(await deleteProgramme(db, key, actor, programme.publicId)).toEqual({ ok: false, reason: "in_use" });

    expect(await deleteLevel(db, key, actor, level.publicId)).toEqual({ ok: true });
    expect(await deleteProgramme(db, key, actor, programme.publicId)).toEqual({ ok: true });
    expect(await deleteSection(db, key, actor, sectionKey)).toEqual({ ok: true });
  });

  it("a level with a class (and so its students) can never be deleted, nor anything above it", async () => {
    const actor = await admin();
    const fixture = await classWith("plus2", 2);
    const list = await listProgrammes(db, "all");
    expect(list.programmes.flatMap((p) => p.levels).find((l) => l.id === fixture.levelId)!.canDelete).toBe(false);
    expect(await deleteLevel(db, key, actor, fixture.levelId)).toEqual({ ok: false, reason: "in_use" });
    expect(await deleteSection(db, key, actor, "plus2")).toEqual({ ok: false, reason: "in_use" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM levels WHERE public_id = ?1").bind(fixture.levelId).first<{ n: number }>()).toEqual({ n: 1 });
  });

  it("a section that is a staff member's home or a role's scope is in use, even with no programmes", async () => {
    const actor = await admin();
    const sectionKey = await newSection(actor);
    const teacher = await person("teacher", "assigned");
    await db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) SELECT u.id, s.id FROM users u, sections s WHERE u.public_id = ?1 AND s.key = ?2").bind(teacher.publicId, sectionKey).run();
    expect(await deleteSection(db, key, actor, sectionKey)).toEqual({ ok: false, reason: "in_use" });
  });

  it("only the Admin or the Super Admin may delete; an unknown id is not found", async () => {
    const actor = await admin();
    const sectionKey = await newSection(actor);
    for (const [role, scope] of [["coordinator", "institution"], ["accountant", "institution"], ["teacher", "assigned"]] as const) {
      const other = await person(role, scope);
      expect(await deleteSection(db, key, other.publicId, sectionKey), role).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await sectionRow(sectionKey)).not.toBeNull();
    expect(await deleteLevel(db, key, actor, "0123456789abcdef0123456789abcdef")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("switching a section off", () => {
  it("keeps it and everything in it, takes no new programmes, and stops offering it where a section is chosen", async () => {
    const actor = await admin();
    const sectionKey = await newSection(actor, `Evening ${crypto.randomUUID().slice(0, 4)}`);
    expect(await updateSection(db, key, actor, sectionKey, { active: false })).toEqual({ ok: true });

    expect(await sectionRow(sectionKey)).toEqual({ key: sectionKey, is_active: 0 });
    expect((await listProgrammes(db, "all")).sections.find((s) => s.key === sectionKey)).toMatchObject({ active: false });
    expect((await loadConfig(db))?.sections.map((s) => s.key) ?? []).not.toContain(sectionKey);
    expect(await createProgramme(db, key, actor, { name: "Late BBS", sectionKey, affiliation: "TU" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await audited(sectionKey, "academics.section.updated")).toBe(1);

    expect(await updateSection(db, key, actor, sectionKey, { active: true })).toEqual({ ok: true });
    expect((await createProgramme(db, key, actor, { name: "Late BBS", sectionKey, affiliation: "TU" })).ok).toBe(true);
  });
});

describe("deleting a class (D-097)", () => {
  it("a class with students can never be deleted; an empty one can, by the Co-ordinator, and it is audited", async () => {
    const coordinator = (await person("coordinator", "institution")).publicId;
    const full = await classWith("bachelors", 1);
    expect(await deleteClass(db, key, coordinator, full.classId)).toEqual({ ok: false, reason: "in_use" });

    const empty = await classWith("bachelors", 0);
    const listed = (await listClasses(db, "all")).classes;
    expect(listed.find((c) => c.id === full.classId)!.canDelete).toBe(false);
    expect(listed.find((c) => c.id === empty.classId)!.canDelete).toBe(true);
    expect(await deleteClass(db, key, coordinator, empty.classId)).toEqual({ ok: true });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM classes WHERE public_id = ?1").bind(empty.classId).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await audited(empty.classId, "academics.class.deleted")).toBe(1);
  });

  it("only a Co-ordinator of the class's section (or the Super Admin) may delete it", async () => {
    const empty = await classWith("bachelors", 0);
    const plus2Only = await person("coordinator", "section", "plus2");
    const teacher = await person("teacher", "assigned");
    expect(await deleteClass(db, key, plus2Only.publicId, empty.classId)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await deleteClass(db, key, teacher.publicId, empty.classId)).toEqual({ ok: false, reason: "not_allowed" });
  });
});
