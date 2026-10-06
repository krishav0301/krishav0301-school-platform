import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { getSetupChecklist } from "../src/modules/academics/queries";

const db = env.DB;
let counter = 0;
let yearCounter = 2090;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;
const at = "2026-09-22T00:00:00.000Z";

async function addSection(): Promise<{ id: number; key: string }> {
  const key = uniq("sec");
  const result = await db.prepare("INSERT INTO sections (key, name) VALUES (?1, 'Section')").bind(key).run();
  return { id: result.meta.last_row_id, key };
}
async function addProgramme(sectionId: number, active = true): Promise<number> {
  const result = await db
    .prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation, is_active) VALUES (?1, ?2, 'Programme', ?3, 'Board', ?4)")
    .bind(uniq("p"), uniq("key"), sectionId, active ? 1 : 0)
    .run();
  return result.meta.last_row_id;
}
let levelOrdinal = 0;
async function addLevel(programmeId: number, active = true): Promise<number> {
  const result = await db
    .prepare("INSERT INTO levels (public_id, programme_id, ordinal, name, is_active) VALUES (?1, ?2, ?3, 'Level', ?4)")
    .bind(uniq("l"), programmeId, ++levelOrdinal, active ? 1 : 0)
    .run();
  return result.meta.last_row_id;
}
/** Only one year may be `active` at once (a database-wide index): closes any other before adding one. */
async function addYear(status: "draft" | "active" | "closed"): Promise<number> {
  if (status === "active") await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?1 WHERE status = 'active'").bind(at).run();
  const result = await db
    .prepare(
      `INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at, closed_at)
       VALUES (?1, ?2, 'T' || CAST(?2 AS INTEGER), ?3, '2026-04-14', '2027-04-13', ?4, ?5, ?6)`,
    )
    .bind(uniq("y"), ++yearCounter, uniq("label"), status, at, status === "closed" ? at : null)
    .run();
  return result.meta.last_row_id;
}
async function addClass(yearId: number, programmeId: number, levelId: number, active = true, label = ""): Promise<number> {
  await db.prepare("INSERT OR IGNORE INTO term_levels (academic_year_id, level_id) VALUES (?1, ?2)").bind(yearId, levelId).run();
  const result = await db
    .prepare("INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label, is_active) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(uniq("c"), yearId, programmeId, levelId, label, active ? 1 : 0)
    .run();
  return result.meta.last_row_id;
}
/** The term's exam pattern (D-114): what the checklist's "terminals" item now asks for. */
const addTerminal = (yearId: number) =>
  db
    .prepare("INSERT INTO exam_patterns (public_id, academic_year_id, graded, theory_min_percent, practical_min_percent, created_at, updated_at) VALUES (?1, ?2, 0, 35, 40, 'x', 'x')")
    .bind(uniq("p"), yearId)
    .run();
async function addSubject(): Promise<number> {
  const result = await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(uniq("s"), uniq("Subject")).run();
  return result.meta.last_row_id;
}
async function addOffering(levelId: number, active = true): Promise<number> {
  const subjectId = await addSubject();
  const result = await db
    .prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id, is_active) VALUES (?1, ?2, ?3, ?4)")
    .bind(uniq("o"), levelId, subjectId, active ? 1 : 0)
    .run();
  return result.meta.last_row_id;
}
async function addTeacher(): Promise<number> {
  const publicId = uniq("u");
  await db.prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, 'hash', 'Teacher')").bind(publicId, `${publicId}@school.example`).run();
  const userId = (await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(publicId).first<{ id: number }>())!.id;
  await db.prepare("INSERT INTO role_assignments (user_id, role, scope_type, section_id) VALUES (?1, 'teacher', 'assigned', NULL)").bind(userId).run();
  return userId;
}
const setClassTeacher = (classId: number, teacherUserId: number | null) => db.prepare("UPDATE classes SET class_teacher_user_id = ?2 WHERE id = ?1").bind(classId, teacherUserId).run();

// ---------------------------------------------------------------------------------------------
describe("getSetupChecklist", () => {
  it("every item is false on an empty setup", async () => {
    const { key } = await addSection();
    expect(await getSetupChecklist(db, [key])).toEqual({ year: false, structure: false, classes: false, terminals: false, subjects: false, teachers: false, classTeachers: false });
  });

  it("builds up to every item true, step by step, for one section", async () => {
    const { id: sectionId, key } = await addSection();
    const sections = [key];

    expect((await getSetupChecklist(db, sections)).year).toBe(false);
    const draftYear = await addYear("draft");
    expect((await getSetupChecklist(db, sections)).year).toBe(false); // a draft year does not count
    let yearId = await addYear("active");
    expect((await getSetupChecklist(db, sections)).year).toBe(true);
    void draftYear;

    expect((await getSetupChecklist(db, sections)).structure).toBe(false);
    const switchedOffProgramme = await addProgramme(sectionId, false);
    await addLevel(switchedOffProgramme);
    expect((await getSetupChecklist(db, sections)).structure, "a switched-off programme does not count").toBe(false);
    const programmeId = await addProgramme(sectionId);
    const switchedOffLevel = await addLevel(programmeId, false);
    expect((await getSetupChecklist(db, sections)).structure, "a switched-off level does not count").toBe(false);
    const levelId = await addLevel(programmeId);
    expect((await getSetupChecklist(db, sections)).structure).toBe(true);
    void switchedOffLevel;

    expect((await getSetupChecklist(db, sections)).classes).toBe(false);
    // A class in a closed year does not count. A year can only be closed by transitioning it while it is
    // still active (closing is Phase 8, so there is no "insert directly as closed" path in real data), so:
    // put a class in the current active year, close that year, then open a fresh one for the rest of the test.
    const closedYearClass = await addClass(yearId, programmeId, levelId, true, "closed-year");
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?1 WHERE id = ?2").bind(at, yearId).run();
    expect((await getSetupChecklist(db, sections)).classes, "a class in a closed year does not count").toBe(false);
    void closedYearClass;
    yearId = await addYear("active");
    const switchedOffClass = await addClass(yearId, programmeId, levelId, false, "off");
    expect((await getSetupChecklist(db, sections)).classes, "a switched-off class does not count").toBe(false);
    const classId = await addClass(yearId, programmeId, levelId, true, "on");
    expect((await getSetupChecklist(db, sections)).classes).toBe(true);
    void switchedOffClass;

    expect((await getSetupChecklist(db, sections)).terminals).toBe(false);
    await addTerminal(yearId);
    expect((await getSetupChecklist(db, sections)).terminals).toBe(true);

    expect((await getSetupChecklist(db, sections)).subjects).toBe(false);
    const switchedOffOffering = await addOffering(levelId, false);
    expect((await getSetupChecklist(db, sections)).subjects, "a switched-off offering does not count").toBe(false);
    await addOffering(levelId);
    expect((await getSetupChecklist(db, sections)).subjects).toBe(true);
    void switchedOffOffering;

    expect((await getSetupChecklist(db, sections)).teachers).toBe(false);
    const teacherId = await addTeacher();
    expect((await getSetupChecklist(db, sections)).teachers).toBe(true);

    expect((await getSetupChecklist(db, sections)).classTeachers, "a class exists but has no Class Teacher yet").toBe(false);
    await setClassTeacher(classId, teacherId);
    expect((await getSetupChecklist(db, sections)).classTeachers, "every active class in the active year now has one").toBe(true);
  });

  it("classTeachers is false, not true, when there are no active classes at all (an empty set is not done)", async () => {
    const { key } = await addSection();
    await addYear("active");
    expect((await getSetupChecklist(db, [key])).classTeachers).toBe(false);
  });

  it("classTeachers stays false while even one active class lacks a Class Teacher", async () => {
    const { id: sectionId, key } = await addSection();
    const yearId = await addYear("active");
    const programmeId = await addProgramme(sectionId);
    const levelId = await addLevel(programmeId);
    const classA = await addClass(yearId, programmeId, levelId, true, "A");
    const classB = await addClass(yearId, programmeId, levelId, true, "B");
    const teacherA = await addTeacher();
    const teacherB = await addTeacher();
    await setClassTeacher(classA, teacherA);
    expect((await getSetupChecklist(db, [key])).classTeachers, "classB still has none").toBe(false);
    await setClassTeacher(classB, teacherB);
    expect((await getSetupChecklist(db, [key])).classTeachers).toBe(true);
  });

  it("a section-scoped viewer sees structure, classes and subjects only from their own section; year, terminals and teachers are whole-school facts", async () => {
    const alone = await addSection();
    const other = await addSection();
    const yearId = await addYear("active");
    await addTerminal(yearId);
    await addTeacher();

    const otherProgramme = await addProgramme(other.id);
    const otherLevel = await addLevel(otherProgramme);
    await addClass(yearId, otherProgramme, otherLevel);
    await addOffering(otherLevel);

    const scoped = await getSetupChecklist(db, [alone.key]);
    expect(scoped.structure, "the other section's programme does not count for this viewer").toBe(false);
    expect(scoped.classes, "the other section's class does not count for this viewer").toBe(false);
    expect(scoped.subjects, "the other section's offering does not count for this viewer").toBe(false);
    expect(scoped.year, "a whole-school fact").toBe(true);
    expect(scoped.terminals, "a whole-school fact").toBe(true);
    expect(scoped.teachers, "a whole-school fact").toBe(true);

    const wide = await getSetupChecklist(db, "all");
    expect(wide.structure).toBe(true);
    expect(wide.classes).toBe(true);
    expect(wide.subjects).toBe(true);
  });
});
