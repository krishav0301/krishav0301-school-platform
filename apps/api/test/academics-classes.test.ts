import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { newPublicId } from "../src/core/ids";
import { addLevel, createClass, createProgramme, createYear, getExamPattern, saveExamPattern, updateClass, updateLevel } from "../src/modules/academics/service";
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
/**
 * The exam pattern (D-117), from the PM's rules: one per term, out of 100, made by the Co-ordinator; the terminals'
 * weights add up to 100; each terminal holds the practical or not; Grade = Yes needs grade ranges; it can change until
 * the first mark is entered in the term.
 */
const PATTERN = {
  graded: false,
  theoryMinPercent: 35,
  practicalMinPercent: 40,
  gradeBands: null,
  terminals: [
    { name: "First terminal", weight: 30, hasPractical: false },
    { name: "Second terminal", weight: 30, hasPractical: true },
    { name: "Final", weight: 40, hasPractical: true },
  ],
};
const BANDS = [
  { grade: "A", from: 80 },
  { grade: "B", from: 60 },
  { grade: "C", from: 35 },
];

describe("the exam pattern", () => {
  it("is made once for a term with its terminals in order, and read back", async () => {
    const yearId = await newYear();
    expect(await getExamPattern(db, yearId)).toMatchObject({ pattern: null, terminals: [], locked: false });
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, yearId, PATTERN)).toEqual({ ok: true });
    const read = await getExamPattern(db, yearId);
    expect(read).toMatchObject({ pattern: { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null }, locked: false });
    expect(read!.terminals.map((t) => [t.name, t.ordinal, t.weight, t.hasPractical])).toEqual([
      ["First terminal", 1, 30, false],
      ["Second terminal", 2, 30, true],
      ["Final", 3, 40, true],
    ]);
    expect(await auditActions(yearId)).toContain("academics.exam_pattern.created");
  });

  it("can be changed before marks: a kept terminal keeps its id, a new one is added, a missing one goes", async () => {
    const yearId = await newYear();
    await saveExamPattern(db, auditKey, coordinator.publicId, yearId, PATTERN);
    const [first] = (await getExamPattern(db, yearId))!.terminals;
    const changed = {
      ...PATTERN,
      graded: true,
      gradeBands: BANDS,
      terminals: [
        { id: first!.id, name: "Mid-term", weight: 40, hasPractical: true },
        { name: "Final", weight: 60, hasPractical: true },
      ],
    };
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, yearId, changed)).toEqual({ ok: true });
    const read = (await getExamPattern(db, yearId))!;
    expect(read.pattern).toMatchObject({ graded: true, gradeBands: BANDS });
    expect(read.terminals.map((t) => [t.id === first!.id, t.name, t.weight])).toEqual([
      [true, "Mid-term", 40],
      [false, "Final", 60],
    ]);
    expect(await auditActions(yearId)).toContain("academics.exam_pattern.updated");
  });

  it("refuses weights that do not add up to 100, grade ranges out of place, and a terminal of another term", async () => {
    const yearId = await newYear();
    const before = [await terminals(), await audits()];
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, yearId, { ...PATTERN, terminals: PATTERN.terminals.slice(0, 2) })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/add up to 100/) });
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, yearId, { ...PATTERN, graded: true })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/grade ranges/) });
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, yearId, { ...PATTERN, gradeBands: BANDS })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, yearId, { ...PATTERN, terminals: [{ id: newPublicId(), name: "Final", weight: 100, hasPractical: false }] })).toMatchObject({ ok: false, reason: "invalid" });
    expect([await terminals(), await audits()]).toEqual(before);
  });

  it("belongs to the whole school: only an institution-wide Co-ordinator (or the Super Admin) may make it", async () => {
    const yearId = await newYear();
    const before = [await terminals(), await audits()];
    for (const [name, who] of [["+2 Co-ordinator", plus2Coordinator], ["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await saveExamPattern(db, auditKey, who.publicId, yearId, PATTERN), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await terminals(), await audits()]).toEqual(before);
  });

  it("refuses an unknown term and a closed one", async () => {
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, "0".repeat(32), PATTERN)).toEqual({ ok: false, reason: "not_found" });
    const closed = await newYear();
    await closeYear(closed);
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, closed, PATTERN)).toEqual({ ok: false, reason: "year_closed" });
  });

  it("locks once marks are entered in the term, in the service and in the database", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    const cls = await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "" });
    if (!cls.ok) throw new Error("class setup failed");
    await saveExamPattern(db, auditKey, coordinator.publicId, yearId, PATTERN);
    const subjectId = newPublicId();
    await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(subjectId, `Lock subject ${subjectId.slice(0, 6)}`).run();
    await db.prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id) SELECT ?1, l.id, s.id FROM levels l, subjects s WHERE l.public_id = ?2 AND s.public_id = ?3").bind(newPublicId(), levelId, subjectId).run();
    // A sheet is the first mark (the results module makes it with the first save).
    await db
      .prepare(
        `INSERT INTO mark_sheets (public_id, class_id, offering_id, terminal_id, theory_max_hundredths, created_at, updated_at)
         SELECT ?1, c.id, o.id, t.id, 10000, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'
           FROM classes c JOIN subject_offerings o ON o.level_id = c.level_id JOIN terminals t ON t.academic_year_id = c.academic_year_id AND t.ordinal = 1
          WHERE c.public_id = ?2`,
      )
      .bind(newPublicId(), cls.publicId)
      .run();
    expect((await getExamPattern(db, yearId))!.locked).toBe(true);
    expect(await saveExamPattern(db, auditKey, coordinator.publicId, yearId, { ...PATTERN, graded: true, gradeBands: BANDS })).toEqual({ ok: false, reason: "locked" });
    await expect(db.prepare("UPDATE exam_patterns SET graded = 1, grade_bands = '[]' WHERE academic_year_id = (SELECT id FROM academic_years WHERE public_id = ?1)").bind(yearId).run()).rejects.toThrow(/locked/);
    await expect(db.prepare("UPDATE terminals SET weight = 50 WHERE academic_year_id = (SELECT id FROM academic_years WHERE public_id = ?1)").bind(yearId).run()).rejects.toThrow(/locked/);
    await expect(db.prepare("DELETE FROM terminals WHERE academic_year_id = (SELECT id FROM academic_years WHERE public_id = ?1) AND ordinal = 1").bind(yearId).run()).rejects.toThrow(/locked/);
  });

  it("a term with no pattern takes no mark sheet", async () => {
    const yearId = await newYear();
    const { levelId } = await newLevel();
    const cls = await createClass(db, auditKey, coordinator.publicId, { yearId, levelId, label: "" });
    if (!cls.ok) throw new Error("class setup failed");
    await db.prepare("INSERT INTO terminals (public_id, academic_year_id, name, ordinal) SELECT ?1, id, 'Old', 1 FROM academic_years WHERE public_id = ?2").bind(newPublicId(), yearId).run();
    const subjectId = newPublicId();
    await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(subjectId, `No pattern ${subjectId.slice(0, 6)}`).run();
    await db.prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id) SELECT ?1, l.id, s.id FROM levels l, subjects s WHERE l.public_id = ?2 AND s.public_id = ?3").bind(newPublicId(), levelId, subjectId).run();
    await expect(
      db
        .prepare(
          `INSERT INTO mark_sheets (public_id, class_id, offering_id, terminal_id, theory_max_hundredths, created_at, updated_at)
           SELECT ?1, c.id, o.id, t.id, 10000, 'x', 'x' FROM classes c JOIN subject_offerings o ON o.level_id = c.level_id JOIN terminals t ON t.academic_year_id = c.academic_year_id WHERE c.public_id = ?2`,
        )
        .bind(newPublicId(), cls.publicId)
        .run(),
    ).rejects.toThrow(/no exam pattern/);
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
