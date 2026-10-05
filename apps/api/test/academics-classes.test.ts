import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { addLevel, createClass, createProgramme, createTerminal, createYear, updateClass, updateLevel, updateTerminal } from "../src/modules/academics/service";
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
const classes = () => count("SELECT COUNT(*) AS n FROM classes");
const terminals = () => count("SELECT COUNT(*) AS n FROM terminals");

let bs = 2010;
/** The term the test is working in: a new level runs in it (D-110: a class is only for a level its term runs). */
let currentYear: string | null = null;
async function newYear(): Promise<string> {
  const bsYear = ++bs;
  // The Principal makes the term (D-110).
  const r = await createYear(db, auditKey, (await programmesAdmin()).publicId, {
    bsYear,
    startDate: bsToAd({ year: bsYear, month: 1, day: 1 }),
    endDate: bsToAd({ year: bsYear, month: 12, day: daysInMonth(bsYear, 12) }),
  });
  if (!r.ok) throw new Error(`year setup failed: ${r.reason}`);
  currentYear = r.publicId;
  return r.publicId;
}
const closeYear = (publicId: string) =>
  db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE public_id = ?1").bind(publicId).run();

/** A programme with one level, in the given section. */
async function newLevel(sectionKey: "plus2" | "bachelors" = "bachelors"): Promise<{ programmeId: string; levelId: string }> {
  const p = await createProgramme(db, auditKey, (await programmesAdmin()).publicId, { name: "Programme", sectionKey, affiliation: "Board" });
  if (!p.ok) throw new Error("programme setup failed");
  const l = await addLevel(db, auditKey, (await programmesAdmin()).publicId, p.publicId, { name: "Level 1", usualMonths: 12 });
  if (!l.ok) throw new Error("level setup failed");
  if (currentYear) {
    await db
      .prepare("INSERT OR IGNORE INTO term_levels (academic_year_id, level_id) SELECT y.id, l.id FROM academic_years y, levels l WHERE y.public_id = ?1 AND l.public_id = ?2 AND y.status <> 'closed'")
      .bind(currentYear, l.publicId)
      .run();
  }
  return { programmeId: p.publicId, levelId: l.publicId };
}

// ---------------------------------------------------------------------------------------------
describe("createClass", () => {
  it("adds a class of a level in a year, with no label unless one is given, and records who did it", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    const result = await createClass(db, auditKey, coordinator.publicId, { yearId, levelId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db
      .prepare(
        `SELECT c.label, c.is_active, y.public_id AS year, l.public_id AS level, c.programme_id = l.programme_id AS same_programme
           FROM classes c JOIN academic_years y ON y.id = c.academic_year_id JOIN levels l ON l.id = c.level_id WHERE c.public_id = ?1`,
      )
      .bind(result.publicId)
      .first();
    expect(row).toEqual({ label: "", is_active: 1, year: yearId, level: levelId, same_programme: 1 });
    expect(await auditActions(result.publicId)).toEqual(["academics.class.created"]);
  });

  it("the same level in the same year needs a different label; a repeat is a conflict with no false audit entry", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).ok).toBe(true);
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "Morning" })).ok).toBe(true);
    const before = await audits();
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).toEqual({ ok: false, reason: "conflict" });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "Morning" })).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });

  it("a section-scoped Co-ordinator may make classes only of their own section's programmes", async () => {
    const yearId = await newYear();
    const bachelors = await newLevel("bachelors");
    const plus2 = await newLevel("plus2");
    const before = [await classes(), await audits()];
    expect(await createClass(db, auditKey, plus2Coordinator.publicId, { yearId, levelId: bachelors.levelId })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await createClass(db, auditKey, bachelorsCoordinator.publicId, { yearId, levelId: plus2.levelId })).toEqual({ ok: false, reason: "not_allowed" });
    expect([await classes(), await audits()]).toEqual(before);
    expect((await createClass(db, auditKey, plus2Coordinator.publicId, { yearId, levelId: plus2.levelId })).ok).toBe(true);
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId, levelId: bachelors.levelId })).ok).toBe(true);
  });

  it("refuses an unknown year or level, an inactive level, and a closed year", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId: "0".repeat(32), levelId })).toEqual({ ok: false, reason: "not_found" });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId: "0".repeat(32) })).toEqual({ ok: false, reason: "not_found" });

    await updateLevel(db, auditKey, (await programmesAdmin()).publicId, levelId, { active: false });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).toMatchObject({ ok: false, reason: "invalid" });
    await updateLevel(db, auditKey, (await programmesAdmin()).publicId, levelId, { active: true });

    const before = [await classes(), await audits()];
    await closeYear(yearId);
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId })).toEqual({ ok: false, reason: "year_closed" });
    expect([await classes(), await audits()]).toEqual(before);
  });

  it("refuses every other role, and a switched-off Co-ordinator, and writes nothing", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = [await classes(), await audits()];
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createClass(db, auditKey, who.publicId, { yearId, levelId }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await createClass(db, auditKey, off.publicId, { yearId, levelId })).toEqual({ ok: false, reason: "not_allowed" });
    expect([await classes(), await audits()]).toEqual(before);
  });

  it("refuses a label that is too long and a field that is not allowed", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "x".repeat(41) })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, programmeId: "x" } as never)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateClass", () => {
  const make = async (sectionKey: "plus2" | "bachelors" = "bachelors", label = "") => {
    const yearId = await newYear();
    const { levelId } = await newLevel(sectionKey);
    const r = await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label });
    if (!r.ok) throw new Error("setup failed");
    return { id: r.publicId, yearId, levelId };
  };

  it("relabels and deactivates a class, and records both", async () => {
    const { id } = await make();
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { label: "Evening" })).toEqual({ ok: true });
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { active: false })).toEqual({ ok: true });
    expect(await db.prepare("SELECT label, is_active FROM classes WHERE public_id = ?1").bind(id).first()).toEqual({ label: "Evening", is_active: 0 });
    expect(await auditActions(id)).toEqual(["academics.class.created", "academics.class.updated", "academics.class.updated"]);
  });

  it("a label that another class of the level and year already has is a conflict", async () => {
    const { id, yearId, levelId } = await make();
    await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "Morning" });
    const before = await audits();
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { label: "Morning" })).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });

  it("a closed year cannot be changed, and another section's Co-ordinator cannot touch it", async () => {
    const { id, yearId } = await make("bachelors");
    expect(await updateClass(db, auditKey, plus2Coordinator.publicId, id, { label: "Nope" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateClass(db, auditKey, admin.publicId, id, { label: "Nope" })).toEqual({ ok: false, reason: "not_allowed" });
    await closeYear(yearId);
    expect(await updateClass(db, auditKey, coordinator.publicId, id, { label: "Late" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await db.prepare("SELECT label FROM classes WHERE public_id = ?1").bind(id).first()).toEqual({ label: "" });
  });

  it("an unknown class is not found", async () => {
    expect(await updateClass(db, auditKey, coordinator.publicId, "0".repeat(32), { label: "x" })).toEqual({ ok: false, reason: "not_found" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("createTerminal", () => {
  it("numbers terminals 1, 2, 3 in the order they are added, including several at once", async () => {
    const yearId = await newYear();
    const results = await Promise.all(["First", "Second", "Third"].map((name) => createTerminal(db, auditKey, coordinator.publicId, { yearId, name })));
    expect(results.every((r) => r.ok)).toBe(true);
    const ordinals = (await db.prepare("SELECT t.ordinal FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE y.public_id = ?1 ORDER BY t.ordinal").bind(yearId).all<{ ordinal: number }>()).results.map((r) => r.ordinal);
    expect(ordinals).toEqual([1, 2, 3]);
  });

  it("records who did it", async () => {
    const yearId = await newYear();
    const r = await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: "First terminal" });
    if (!r.ok) throw new Error("setup failed");
    expect(await auditActions(r.publicId)).toEqual(["academics.terminal.created"]);
  });

  it("belongs to the whole school: only an institution-wide Co-ordinator (or the Super Admin) may add one", async () => {
    const yearId = await newYear();
    const before = [await terminals(), await audits()];
    for (const [name, who] of [["+2 Co-ordinator", plus2Coordinator], ["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createTerminal(db, auditKey, who.publicId, { yearId, name: "First" }), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await terminals(), await audits()]).toEqual(before);
  });

  it("refuses an unknown year, a closed year, an empty name, and a 13th terminal", async () => {
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId: "0".repeat(32), name: "First" })).toEqual({ ok: false, reason: "not_found" });

    const closed = await newYear();
    await closeYear(closed);
    const before = [await terminals(), await audits()];
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId: closed, name: "First" })).toEqual({ ok: false, reason: "year_closed" });
    expect([await terminals(), await audits()]).toEqual(before);

    const yearId = await newYear();
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: " " })).toMatchObject({ ok: false, reason: "invalid" });
    for (let n = 1; n <= 12; n++) expect((await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: `T${n}` })).ok).toBe(true);
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: "T13" })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/at most 12/) });
  });
});

describe("updateTerminal", () => {
  it("renames a terminal; refuses the wrong person, a closed year, and an unknown id", async () => {
    const yearId = await newYear();
    const r = await createTerminal(db, auditKey, coordinator.publicId, { yearId, name: "First" });
    if (!r.ok) throw new Error("setup failed");

    expect(await updateTerminal(db, auditKey, coordinator.publicId, r.publicId, { name: "First terminal" })).toEqual({ ok: true });
    expect(await auditActions(r.publicId)).toEqual(["academics.terminal.created", "academics.terminal.updated"]);
    expect(await updateTerminal(db, auditKey, plus2Coordinator.publicId, r.publicId, { name: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateTerminal(db, auditKey, coordinator.publicId, "0".repeat(32), { name: "x" })).toEqual({ ok: false, reason: "not_found" });

    await closeYear(yearId);
    expect(await updateTerminal(db, auditKey, coordinator.publicId, r.publicId, { name: "Late" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await db.prepare("SELECT name FROM terminals WHERE public_id = ?1").bind(r.publicId).first()).toEqual({ name: "First terminal" });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
