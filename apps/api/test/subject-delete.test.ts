import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { addLevel, createOffering, createProgramme, createSubject, deleteSubject, updateOffering } from "../src/modules/academics/service";
import { auditKey, db, person, programmesAdmin, seedSections, type Person } from "./academics-helpers";

/**
 * Deleting a subject made by mistake (the PM, 2026-10-10): allowed only while no level teaches it, since marks, teaching
 * and students all hang off a level's offering of it. One more exception to "no hard deletes", like D-097. Otherwise it is
 * archived instead, which keeps its history.
 */

let coordinator: Person, plus2Coordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
});

let n = 0;
const label = (prefix: string) => `${prefix} ${++n} ${crypto.randomUUID().slice(0, 6)}`;
const ok = <T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(`setup failed (${what}): ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
};
const newSubject = async () => ok(await createSubject(db, auditKey, coordinator.publicId, { name: label("Subject"), sectionKey: "bachelors" }), "subject").publicId;
const rowOf = (id: string) => db.prepare("SELECT 1 AS n FROM subjects WHERE public_id = ?1").bind(id).first();
const audited = (id: string) => db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_public_id = ?1 AND action = 'academics.subject.deleted'").bind(id).first<{ n: number }>().then((r) => r!.n);

async function levelWith(subjectId: string) {
  const actor = (await programmesAdmin()).publicId;
  const p = ok(await createProgramme(db, auditKey, actor, { name: label("Programme"), sectionKey: "bachelors", affiliation: "Board" }), "programme");
  const l = ok(await addLevel(db, auditKey, actor, p.publicId, { name: "Year 1", usualMonths: 12 }), "level");
  const o = ok(await createOffering(db, auditKey, coordinator.publicId, { levelId: l.publicId, subjectId }), "offering");
  return { levelId: l.publicId, offeringId: o.publicId };
}

describe("deleting a subject nothing uses", () => {
  it("a subject no level teaches is deleted, and the deletion is audited with what it was", async () => {
    const id = await newSubject();
    expect(await deleteSubject(db, auditKey, coordinator.publicId, id)).toEqual({ ok: true });
    expect(await rowOf(id)).toBeNull();
    expect(await audited(id)).toBe(1);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });

  it("a subject a level teaches cannot be deleted, even when switched off for that level, and is kept", async () => {
    const id = await newSubject();
    const { offeringId } = await levelWith(id);
    expect(await deleteSubject(db, auditKey, coordinator.publicId, id)).toEqual({ ok: false, reason: "in_use" });
    ok(await updateOffering(db, auditKey, coordinator.publicId, offeringId, { active: false }), "switch off");
    expect(await deleteSubject(db, auditKey, coordinator.publicId, id)).toEqual({ ok: false, reason: "in_use" });
    expect(await rowOf(id)).not.toBeNull();
    expect(await audited(id)).toBe(0);
  });

  it("an archived subject nothing uses can still be deleted, and an unknown one is not found", async () => {
    const id = await newSubject();
    await db.prepare("UPDATE subjects SET is_archived = 1 WHERE public_id = ?1").bind(id).run();
    expect(await deleteSubject(db, auditKey, coordinator.publicId, id)).toEqual({ ok: true });
    expect(await deleteSubject(db, auditKey, coordinator.publicId, "0".repeat(32))).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteSubject(db, auditKey, coordinator.publicId, id)).toEqual({ ok: false, reason: "not_found" }); // already gone
  });

  it("only a whole-school Co-ordinator may delete, like changing a subject; nobody else, and nothing is lost", async () => {
    const id = await newSubject();
    for (const who of [plus2Coordinator, admin, accountant, teacher, student]) {
      expect(await deleteSubject(db, auditKey, who.publicId, id), who.publicId).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await rowOf(id)).not.toBeNull();
  });
});
