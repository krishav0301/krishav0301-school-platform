import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { newPublicId } from "../src/core/ids";
import { addLevel, createOffering, createProgramme, createSubject, setAssignment, setClassTeacher } from "../src/modules/academics/service";
import { getTeaching } from "../src/modules/academics/queries";
import { auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, superAdmin: Person, student: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  superAdmin = await person("super_admin", "institution");
  student = await person("student", "own");
});

let yc = 2060;
const at = "2026-09-22T00:00:00.000Z";

/** A raw academic year (bypassing createYear's BS-calendar check, which is not what this file tests). */
async function newYear(status: "draft" | "active" | "closed" = "draft"): Promise<string> {
  const publicId = newPublicId();
  await db
    .prepare(
      `INSERT INTO academic_years (public_id, bs_year, label, start_date, end_date, status, created_at, closed_at)
       VALUES (?1, ?2, ?3, '2026-04-14', '2027-04-13', ?4, ?5, ?6)`,
    )
    .bind(publicId, ++yc, `Year ${yc}`, status, at, status === "closed" ? at : null)
    .run();
  return publicId;
}

/** Closes an already-made year, since a class cannot be inserted into a year that starts out closed. */
async function closeYear(yearId: string): Promise<void> {
  await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE public_id = ?1").bind(yearId, at).run();
}

/** A raw class (bypassing createClass, which is exercised elsewhere): a level, in a year. */
async function newClass(yearId: string, levelId: string): Promise<string> {
  const publicId = newPublicId();
  await db
    .prepare(
      `INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label)
       SELECT ?1, y.id, l.programme_id, l.id, ''
         FROM academic_years y, levels l WHERE y.public_id = ?2 AND l.public_id = ?3`,
    )
    .bind(publicId, yearId, levelId)
    .run();
  return publicId;
}

/** A raw teacher: a user, an active 'teacher' role assignment, and (optionally) a home section. */
async function newTeacher(sectionKey: string | null = null): Promise<string> {
  const publicId = newPublicId();
  await db
    .prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, 'hash', 'Teacher')")
    .bind(publicId, `${publicId}@school.example`)
    .run();
  const userId = (await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(publicId).first<{ id: number }>())!.id;
  await db.prepare("INSERT INTO role_assignments (user_id, role, scope_type, section_id) VALUES (?1, 'teacher', 'assigned', NULL)").bind(userId).run();
  await db
    .prepare("INSERT INTO staff_profiles (user_id, home_section_id) SELECT ?1, id FROM sections WHERE key = ?2")
    .bind(userId, sectionKey)
    .run();
  return publicId;
}

/** A programme with one level in the given section, made by the institution-wide Co-ordinator. */
async function newLevel(sectionKey: "plus2" | "bachelors" = "plus2") {
  const label = () => `L ${Math.random().toString(36).slice(2, 8)}`;
  const p = await createProgramme(db, auditKey, coordinator.publicId, { name: label(), sectionKey, affiliation: "Board" });
  if (!p.ok) throw new Error(`programme setup failed: ${JSON.stringify(p)}`);
  const l = await addLevel(db, auditKey, coordinator.publicId, p.publicId, { name: label() });
  if (!l.ok) throw new Error(`level setup failed: ${JSON.stringify(l)}`);
  return l.publicId;
}

async function newOffering(levelId: string): Promise<string> {
  const subject = await createSubject(db, auditKey, coordinator.publicId, { name: `Subject ${Math.random().toString(36).slice(2, 8)}` });
  if (!subject.ok) throw new Error(`subject setup failed: ${JSON.stringify(subject)}`);
  const offering = await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: subject.publicId });
  if (!offering.ok) throw new Error(`offering setup failed: ${JSON.stringify(offering)}`);
  return offering.publicId;
}

const activeAssignments = (classId: string) => count("SELECT COUNT(*) AS n FROM teacher_assignments WHERE class_id = (SELECT id FROM classes WHERE public_id = ?1) AND is_active = 1", classId);
const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");

// ---------------------------------------------------------------------------------------------
describe("setAssignment", () => {
  it("assigns a teacher, records who did it, and replacing it keeps history", async () => {
    const levelId = await newLevel("plus2");
    const offeringId = await newOffering(levelId);
    const classId = await newClass(await newYear(), levelId);
    const teacherA = await newTeacher("plus2");
    const teacherB = await newTeacher("plus2");

    expect(await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId, teacherId: teacherA })).toEqual({ ok: true });
    expect(await activeAssignments(classId)).toBe(1);

    expect(await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId, teacherId: teacherB })).toEqual({ ok: true });
    expect(await activeAssignments(classId)).toBe(1);
    const rows = await db
      .prepare(
        `SELECT ta.is_active FROM teacher_assignments ta
           JOIN classes c ON c.id = ta.class_id JOIN subject_offerings o ON o.id = ta.offering_id
          WHERE c.public_id = ?1 AND o.public_id = ?2 ORDER BY ta.id`,
      )
      .bind(classId, offeringId)
      .all();
    expect(rows.results.map((r) => r.is_active)).toEqual([0, 1]);
  });

  it("teacherId null removes the current assignment; removing when there is none is not_found", async () => {
    const levelId = await newLevel("plus2");
    const offeringId = await newOffering(levelId);
    const classId = await newClass(await newYear(), levelId);
    const teacher = await newTeacher("plus2");

    await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId, teacherId: teacher });
    expect(await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId, teacherId: null })).toEqual({ ok: true });
    expect(await activeAssignments(classId)).toBe(0);
    expect(await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId, teacherId: null })).toEqual({ ok: false, reason: "not_found" });
  });

  it("a section-scoped Co-ordinator may assign only their own section's classes and teachers", async () => {
    const levelId = await newLevel("plus2");
    const offeringId = await newOffering(levelId);
    const classId = await newClass(await newYear(), levelId);
    const plus2Teacher = await newTeacher("plus2");
    const bachelorsTeacher = await newTeacher("bachelors");

    expect(await setAssignment(db, auditKey, plus2Coordinator.publicId, { classId, offeringId, teacherId: plus2Teacher })).toEqual({ ok: true });
    expect(await setAssignment(db, auditKey, plus2Coordinator.publicId, { classId, offeringId, teacherId: bachelorsTeacher })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await setAssignment(db, auditKey, bachelorsCoordinator.publicId, { classId, offeringId, teacherId: plus2Teacher })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("an Accountant, Student and a switched-off Co-ordinator may not assign", async () => {
    const levelId = await newLevel("plus2");
    const offeringId = await newOffering(levelId);
    const classId = await newClass(await newYear(), levelId);
    const teacher = await newTeacher("plus2");

    for (const who of [accountant, student]) {
      expect(await setAssignment(db, auditKey, who.publicId, { classId, offeringId, teacherId: teacher })).toEqual({ ok: false, reason: "not_allowed" });
    }
    const stale = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(stale.publicId).run();
    expect(await setAssignment(db, auditKey, stale.publicId, { classId, offeringId, teacherId: teacher })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("an offering not of the class's level is invalid", async () => {
    const levelA = await newLevel("plus2");
    const levelB = await newLevel("plus2");
    const offeringOfB = await newOffering(levelB);
    const classOfA = await newClass(await newYear(), levelA);
    const teacher = await newTeacher("plus2");
    expect(await setAssignment(db, auditKey, coordinator.publicId, { classId: classOfA, offeringId: offeringOfB, teacherId: teacher })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("a closed year refuses the write", async () => {
    const levelId = await newLevel("plus2");
    const offeringId = await newOffering(levelId);
    const yearId = await newYear();
    const classId = await newClass(yearId, levelId);
    await closeYear(yearId);
    const teacher = await newTeacher("plus2");
    expect(await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId, teacherId: teacher })).toEqual({ ok: false, reason: "year_closed" });
  });

  it("records exactly one audit entry per successful call, and the chain verifies", async () => {
    const levelId = await newLevel("plus2");
    const offeringId = await newOffering(levelId);
    const classId = await newClass(await newYear(), levelId);
    const teacher = await newTeacher("plus2");
    const before = await audits();
    expect(await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId, teacherId: teacher })).toEqual({ ok: true });
    expect(await audits()).toBe(before + 1);
    expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
describe("setClassTeacher", () => {
  it("sets, clears, and re-sets the Class Teacher", async () => {
    const levelId = await newLevel("plus2");
    const classId = await newClass(await newYear(), levelId);
    const teacher = await newTeacher("plus2");

    expect(await setClassTeacher(db, auditKey, coordinator.publicId, classId, teacher)).toEqual({ ok: true });
    expect((await db.prepare("SELECT class_teacher_user_id FROM classes WHERE public_id = ?1").bind(classId).first<{ class_teacher_user_id: number }>())!.class_teacher_user_id).not.toBeNull();

    expect(await setClassTeacher(db, auditKey, coordinator.publicId, classId, null)).toEqual({ ok: true });
    expect((await db.prepare("SELECT class_teacher_user_id FROM classes WHERE public_id = ?1").bind(classId).first<{ class_teacher_user_id: number | null }>())!.class_teacher_user_id).toBeNull();

    expect(await setClassTeacher(db, auditKey, superAdmin.publicId, classId, teacher)).toEqual({ ok: true });
  });

  it("the same teacher as Class Teacher of a second class the same year is a conflict", async () => {
    const levelA = await newLevel("plus2");
    const levelB = await newLevel("plus2");
    const yearId = await newYear();
    const classA = await newClass(yearId, levelA);
    const classB = await newClass(yearId, levelB);
    const teacher = await newTeacher("plus2");

    expect(await setClassTeacher(db, auditKey, coordinator.publicId, classA, teacher)).toEqual({ ok: true });
    expect(await setClassTeacher(db, auditKey, coordinator.publicId, classB, teacher)).toEqual({ ok: false, reason: "conflict" });
  });

  it("a section-scoped Co-ordinator may only set their own section's class and teacher", async () => {
    const levelId = await newLevel("plus2");
    const classId = await newClass(await newYear(), levelId);
    const plus2Teacher = await newTeacher("plus2");
    const bachelorsTeacher = await newTeacher("bachelors");

    expect(await setClassTeacher(db, auditKey, bachelorsCoordinator.publicId, classId, plus2Teacher)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await setClassTeacher(db, auditKey, plus2Coordinator.publicId, classId, bachelorsTeacher)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await setClassTeacher(db, auditKey, plus2Coordinator.publicId, classId, plus2Teacher)).toEqual({ ok: true });
  });

  it("a closed year refuses the write", async () => {
    const levelId = await newLevel("plus2");
    const yearId = await newYear();
    const classId = await newClass(yearId, levelId);
    await closeYear(yearId);
    const teacher = await newTeacher("plus2");
    expect(await setClassTeacher(db, auditKey, coordinator.publicId, classId, teacher)).toEqual({ ok: false, reason: "year_closed" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("getTeaching", () => {
  it("shows each offering's current teacher (or none), the Class Teacher, and the pickable teachers", async () => {
    const levelId = await newLevel("plus2");
    const offeringA = await newOffering(levelId);
    const offeringB = await newOffering(levelId);
    const classId = await newClass(await newYear(), levelId);
    const teacher = await newTeacher("plus2");
    await setAssignment(db, auditKey, coordinator.publicId, { classId, offeringId: offeringA, teacherId: teacher });
    await setClassTeacher(db, auditKey, coordinator.publicId, classId, teacher);

    const teaching = await getTeaching(db, "all", classId);
    expect(teaching?.classTeacher?.id).toBe(teacher);
    const rowA = teaching!.assignments.find((a) => a.offeringId === offeringA);
    const rowB = teaching!.assignments.find((a) => a.offeringId === offeringB);
    expect(rowA?.teacher?.id).toBe(teacher);
    expect(rowB?.teacher).toBeNull();
  });

  it("a class outside the viewer's sections is null, the same as a missing one", async () => {
    const levelId = await newLevel("bachelors");
    const classId = await newClass(await newYear(), levelId);
    expect(await getTeaching(db, ["plus2"], classId)).toBeNull();
    expect(await getTeaching(db, "all", newPublicId())).toBeNull();
  });

  it("the teacher list is every teacher for an institution-wide viewer, and only the class's own section for a scoped one", async () => {
    const levelId = await newLevel("plus2");
    const classId = await newClass(await newYear(), levelId);
    const plus2Teacher = await newTeacher("plus2");
    const bachelorsTeacher = await newTeacher("bachelors");

    const wide = await getTeaching(db, "all", classId);
    expect(wide!.teachers.map((t) => t.id)).toEqual(expect.arrayContaining([plus2Teacher, bachelorsTeacher]));

    const scoped = await getTeaching(db, ["plus2"], classId);
    const scopedIds = scoped!.teachers.map((t) => t.id);
    expect(scopedIds).toContain(plus2Teacher);
    expect(scopedIds).not.toContain(bachelorsTeacher);
  });
});
