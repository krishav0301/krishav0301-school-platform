import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.DB;
let counter = 0;
let yearCounter = 2050;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;
const at = "2026-09-22T00:00:00.000Z";

async function addYear(status: "draft" | "active" | "closed" = "draft"): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at, closed_at)
       VALUES (?1, ?2, 'T' || CAST(?2 AS INTEGER), ?3, '2026-04-14', '2027-04-13', ?4, ?5, ?6)`,
    )
    .bind(uniq("y"), ++yearCounter, uniq("label"), status, at, status === "closed" ? at : null)
    .run();
  return result.meta.last_row_id;
}

async function addSection(): Promise<number> {
  const result = await db.prepare("INSERT INTO sections (key, name) VALUES (?1, 'Section')").bind(uniq("sec")).run();
  return result.meta.last_row_id;
}

async function addProgramme(): Promise<number> {
  const sectionId = await addSection();
  const result = await db
    .prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation) VALUES (?1, ?2, 'Programme', ?3, 'Board')")
    .bind(uniq("p"), uniq("key"), sectionId)
    .run();
  return result.meta.last_row_id;
}

async function addLevel(programmeId: number, ordinal = 1): Promise<number> {
  const result = await db.prepare("INSERT INTO levels (public_id, programme_id, ordinal, name) VALUES (?1, ?2, ?3, 'Level')").bind(uniq("l"), programmeId, ordinal).run();
  return result.meta.last_row_id;
}

async function addClass(yearId: number, programmeId: number, levelId: number): Promise<number> {
  await db.prepare("INSERT OR IGNORE INTO term_levels (academic_year_id, level_id) VALUES (?1, ?2)").bind(yearId, levelId).run();
  const result = await db
    .prepare("INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label) VALUES (?1, ?2, ?3, ?4, '')")
    .bind(uniq("c"), yearId, programmeId, levelId)
    .run();
  return result.meta.last_row_id;
}

async function addSubject(): Promise<number> {
  const result = await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(uniq("s"), uniq("Subject")).run();
  return result.meta.last_row_id;
}

async function addOffering(levelId: number): Promise<number> {
  const subjectId = await addSubject();
  const result = await db.prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id) VALUES (?1, ?2, ?3)").bind(uniq("o"), levelId, subjectId).run();
  return result.meta.last_row_id;
}

async function addUser(): Promise<number> {
  const result = await db
    .prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, 'hash', 'Teacher')")
    .bind(uniq("u"), `${uniq("t")}@example.com`)
    .run();
  return result.meta.last_row_id;
}

const addAssignment = (classId: number, offeringId: number, teacherId: number) =>
  db
    .prepare("INSERT INTO teacher_assignments (public_id, class_id, offering_id, teacher_user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(uniq("ta"), classId, offeringId, teacherId, at)
    .run();

// ---------------------------------------------------------------------------------------------
describe("teacher_assignments", () => {
  it("refuses an offering that is not the class's own level", async () => {
    const programmeId = await addProgramme();
    const levelA = await addLevel(programmeId, 1);
    const levelB = await addLevel(programmeId, 2);
    const yearId = await addYear();
    const classId = await addClass(yearId, programmeId, levelA);
    const offeringOfB = await addOffering(levelB);
    const teacherId = await addUser();
    await expect(addAssignment(classId, offeringOfB, teacherId)).rejects.toThrow(/not this class's level/);
  });

  it("allows only one active assignment per class and offering, but a replaced one keeps its history", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const yearId = await addYear();
    const classId = await addClass(yearId, programmeId, levelId);
    const offeringId = await addOffering(levelId);
    const teacherA = await addUser();
    const teacherB = await addUser();

    await addAssignment(classId, offeringId, teacherA);
    await expect(addAssignment(classId, offeringId, teacherB)).rejects.toThrow(/UNIQUE/);

    await db.prepare("UPDATE teacher_assignments SET is_active = 0 WHERE class_id = ?1 AND offering_id = ?2").bind(classId, offeringId).run();
    await addAssignment(classId, offeringId, teacherB); // now succeeds: the old row is inactive

    const rows = await db.prepare("SELECT is_active FROM teacher_assignments WHERE class_id = ?1 AND offering_id = ?2 ORDER BY id").bind(classId, offeringId).all();
    expect(rows.results.map((r) => r.is_active)).toEqual([0, 1]);
  });

  it("refuses an insert or an update once the year is closed", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const yearId = await addYear();
    const classId = await addClass(yearId, programmeId, levelId);
    const offeringId = await addOffering(levelId);
    const teacherId = await addUser();
    await addAssignment(classId, offeringId, teacherId);

    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(yearId, at).run();

    const offering2 = await addOffering(levelId);
    await expect(addAssignment(classId, offering2, teacherId)).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("UPDATE teacher_assignments SET is_active = 0 WHERE class_id = ?1 AND offering_id = ?2").bind(classId, offeringId).run()).rejects.toThrow(
      /academic year is closed/,
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("classes.class_teacher_user_id", () => {
  it("lets a teacher be Class Teacher of at most one class per academic year", async () => {
    const programmeId = await addProgramme();
    const levelA = await addLevel(programmeId, 1);
    const levelB = await addLevel(programmeId, 2);
    const yearId = await addYear();
    const classA = await addClass(yearId, programmeId, levelA);
    const classB = await addClass(yearId, programmeId, levelB);
    const teacherId = await addUser();

    await db.prepare("UPDATE classes SET class_teacher_user_id = ?2 WHERE id = ?1").bind(classA, teacherId).run();
    await expect(db.prepare("UPDATE classes SET class_teacher_user_id = ?2 WHERE id = ?1").bind(classB, teacherId).run()).rejects.toThrow(/UNIQUE/);
  });

  it("allows the same teacher as Class Teacher in two different years", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const teacherId = await addUser();
    const yearA = await addYear();
    const classA = await addClass(yearA, programmeId, levelId);
    await db.prepare("UPDATE classes SET class_teacher_user_id = ?2 WHERE id = ?1").bind(classA, teacherId).run();
    // The level moves to the next term once this one closes (D-110: a level is in only one open term).
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE id = ?1").bind(yearA).run();
    const yearB = await addYear();
    const classB = await addClass(yearB, programmeId, levelId);
    await db.prepare("UPDATE classes SET class_teacher_user_id = ?2 WHERE id = ?1").bind(classB, teacherId).run();
  });

  it("a closed year refuses changing the Class Teacher too (the existing classes trigger)", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const yearId = await addYear();
    const classId = await addClass(yearId, programmeId, levelId);
    const teacherId = await addUser();
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(yearId, at).run();
    await expect(db.prepare("UPDATE classes SET class_teacher_user_id = ?2 WHERE id = ?1").bind(classId, teacherId).run()).rejects.toThrow(/academic year is closed/);
  });
});
