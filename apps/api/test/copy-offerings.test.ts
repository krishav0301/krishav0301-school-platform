import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { addLevel, copyOfferings, createGroup, createOffering, createProgramme, createSubject, updateOffering, updateSubject } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person, programmesAdmin } from "./academics-helpers";

/**
 * R-001 (the PM, 2026-10-09): a level copies its subjects from another level of the same programme (Department).
 * It copies each active subject with its credit hours, paper (full marks and practical) and elective group, skips what
 * the level already has, and is one all-or-nothing write with one audit entry.
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

/** A programme in Bachelor's with two levels. */
async function twoLevels() {
  const actor = (await programmesAdmin()).publicId;
  const p = ok(await createProgramme(db, auditKey, actor, { name: label("Programme"), sectionKey: "bachelors", affiliation: "Board" }), "programme");
  const a = ok(await addLevel(db, auditKey, actor, p.publicId, { name: "Year 1", usualMonths: 12 }), "level a");
  const b = ok(await addLevel(db, auditKey, actor, p.publicId, { name: "Year 2", usualMonths: 12 }), "level b");
  return { programmeId: p.publicId, from: a.publicId, to: b.publicId };
}
const newSubject = async () => ok(await createSubject(db, auditKey, coordinator.publicId, { name: label("Subject"), sectionKey: "bachelors" }), "subject").publicId;
const offer = async (levelId: string, subjectId: string, extra: Record<string, unknown> = {}) =>
  ok(await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId, ...extra } as never), "offering").publicId;
const offeringsOf = (levelId: string) =>
  db
    .prepare(
      `SELECT s.public_id AS subject, o.credit_hundredths AS credit, o.full_marks_hundredths AS full, o.practical_hundredths AS practical, o.is_active AS active, g.name AS grp
         FROM subject_offerings o JOIN levels l ON l.id = o.level_id JOIN subjects s ON s.id = o.subject_id LEFT JOIN elective_groups g ON g.id = o.elective_group_id
        WHERE l.public_id = ?1 ORDER BY s.name`,
    )
    .bind(levelId)
    .all<{ subject: string; credit: number | null; full: number; practical: number | null; active: number; grp: string | null }>()
    .then((r) => r.results);

describe("copying a level's subjects", () => {
  it("copies each active subject with its credit hours, paper and elective group, and makes a missing group", async () => {
    const { from, to } = await twoLevels();
    const group = ok(await createGroup(db, auditKey, coordinator.publicId, from, { name: "Option", pickCount: 2 }), "group").publicId;
    const maths = await newSubject();
    const physics = await newSubject();
    await offer(from, maths, { creditHundredths: 300, fullMarksHundredths: 10_000 });
    await offer(from, physics, { fullMarksHundredths: 10_000, practicalHundredths: 2_500, groupId: group });

    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: to })).toEqual({ ok: true, copied: 2 });

    const copied = await offeringsOf(to);
    expect(copied).toHaveLength(2);
    expect(copied.find((o) => o.subject === maths)).toMatchObject({ credit: 300, full: 10_000, practical: null, active: 1, grp: null });
    expect(copied.find((o) => o.subject === physics)).toMatchObject({ credit: null, full: 10_000, practical: 2_500, active: 1, grp: "Option" });
    expect(await db.prepare("SELECT pick_count FROM elective_groups g JOIN levels l ON l.id = g.level_id WHERE l.public_id = ?1 AND g.name = 'Option'").bind(to).first()).toEqual({ pick_count: 2 });
    expect((await offeringsOf(from)).length).toBe(2); // the source is untouched
  });

  it("skips what the level already has, so a second copy adds nothing and changes nothing", async () => {
    const { from, to } = await twoLevels();
    const shared = await newSubject();
    const extra = await newSubject();
    await offer(from, shared, { fullMarksHundredths: 10_000 });
    await offer(from, extra);
    await offer(to, shared, { fullMarksHundredths: 5_000 }); // already there with its own paper

    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: to })).toEqual({ ok: true, copied: 1 });
    expect((await offeringsOf(to)).find((o) => o.subject === shared)!.full).toBe(5_000); // not overwritten
    const audits = await count("SELECT COUNT(*) AS n FROM audit_events");
    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: to })).toEqual({ ok: true, copied: 0 });
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(audits); // nothing copied, nothing recorded
  });

  it("does not copy a switched-off subject or an archived one", async () => {
    const { from, to } = await twoLevels();
    const off = await newSubject();
    const archived = await newSubject();
    const live = await newSubject();
    const offOffering = await offer(from, off);
    await offer(from, archived);
    await offer(from, live);
    ok(await updateOffering(db, auditKey, coordinator.publicId, offOffering, { active: false }), "switch off");
    ok(await updateSubject(db, auditKey, coordinator.publicId, archived, { archived: true }), "archive");

    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: to })).toEqual({ ok: true, copied: 1 });
    expect((await offeringsOf(to)).map((o) => o.subject)).toEqual([live]);
  });

  it("writes one audit entry, and the chain still verifies", async () => {
    const { from, to } = await twoLevels();
    await offer(from, await newSubject());
    await offer(from, await newSubject());
    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: to })).toEqual({ ok: true, copied: 2 });
    expect((await auditActions(to)).filter((a) => a === "academics.offerings.copied")).toEqual(["academics.offerings.copied"]);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});

describe("what may not be copied", () => {
  it("only between two different levels of the SAME programme", async () => {
    const one = await twoLevels();
    const other = await twoLevels();
    await offer(one.from, await newSubject());
    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: one.from, toLevelId: other.to })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: one.from, toLevelId: one.from })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await offeringsOf(other.to)).toEqual([]);
  });

  it("an unknown level is not found, and a switched-off level or programme takes none", async () => {
    const { from, to, programmeId } = await twoLevels();
    await offer(from, await newSubject());
    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: "0".repeat(32) })).toMatchObject({ ok: false, reason: "not_found" });
    await db.prepare("UPDATE levels SET is_active = 0 WHERE public_id = ?1").bind(to).run();
    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: to })).toMatchObject({ ok: false, reason: "invalid" });
    await db.prepare("UPDATE levels SET is_active = 1 WHERE public_id = ?1").bind(to).run();
    await db.prepare("UPDATE programmes SET is_active = 0 WHERE public_id = ?1").bind(programmeId).run();
    expect(await copyOfferings(db, auditKey, coordinator.publicId, { fromLevelId: from, toLevelId: to })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("only a Co-ordinator whose scope covers the wing (or the Super Admin) may copy", async () => {
    const { from, to } = await twoLevels();
    await offer(from, await newSubject());
    for (const who of [plus2Coordinator, admin, accountant, teacher, student]) {
      expect(await copyOfferings(db, auditKey, who.publicId, { fromLevelId: from, toLevelId: to }), who.publicId).toMatchObject({ ok: false, reason: "not_allowed" });
    }
    expect(await offeringsOf(to)).toEqual([]);
  });
});
