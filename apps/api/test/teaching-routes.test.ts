import { beforeAll, describe, expect, it } from "vitest";

import { addLevel, createOffering, createProgramme, createSubject } from "../src/modules/academics/service";
import { newPublicId } from "../src/core/ids";
import { auditKey, call, count, db, person, seedSections, type Person, programmesAdmin } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

const noId = "0".repeat(32);
let yc = 2070;
const at = "2026-09-22T00:00:00.000Z";

async function newYear(): Promise<string> {
  const publicId = newPublicId();
  await db
    .prepare(`INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at) VALUES (?1, ?2, 'T' || CAST(?2 AS INTEGER), ?3, '2026-04-14', '2027-04-13', 'draft', ?4)`)
    .bind(publicId, ++yc, `Year ${yc}`, at)
    .run();
  return publicId;
}

async function newClass(yearId: string, levelId: string): Promise<string> {
  const publicId = newPublicId();
  await db.prepare("INSERT OR IGNORE INTO term_levels (academic_year_id, level_id) SELECT y.id, l.id FROM academic_years y, levels l WHERE y.public_id = ?1 AND l.public_id = ?2").bind(yearId, levelId).run();
  await db
    .prepare(`INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label) SELECT ?1, y.id, l.programme_id, l.id, '' FROM academic_years y, levels l WHERE y.public_id = ?2 AND l.public_id = ?3`)
    .bind(publicId, yearId, levelId)
    .run();
  return publicId;
}

async function newTeacher(sectionKey: string | null = null): Promise<string> {
  const publicId = newPublicId();
  await db.prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, 'hash', 'Teacher')").bind(publicId, `${publicId}@school.example`).run();
  const userId = (await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(publicId).first<{ id: number }>())!.id;
  await db.prepare("INSERT INTO role_assignments (user_id, role, scope_type, section_id) VALUES (?1, 'teacher', 'assigned', NULL)").bind(userId).run();
  await db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) SELECT ?1, id FROM sections WHERE key = ?2").bind(userId, sectionKey).run();
  return publicId;
}

async function newLevel(sectionKey: "plus2" | "bachelors" = "plus2") {
  const label = () => `L ${Math.random().toString(36).slice(2, 8)}`;
  const p = await createProgramme(db, auditKey, (await programmesAdmin()).publicId, { name: label(), sectionKey, affiliation: "Board" });
  if (!p.ok) throw new Error("programme setup failed");
  const l = await addLevel(db, auditKey, (await programmesAdmin()).publicId, p.publicId, { name: label(), usualMonths: 12 });
  if (!l.ok) throw new Error("level setup failed");
  return l.publicId;
}

async function newOffering(levelId: string): Promise<string> {
  const subject = await createSubject(db, auditKey, coordinator.publicId, { name: `Subject ${Math.random().toString(36).slice(2, 8)}` });
  if (!subject.ok) throw new Error("subject setup failed");
  const offering = await createOffering(db, auditKey, coordinator.publicId, { levelId, subjectId: subject.publicId });
  if (!offering.ok) throw new Error("offering setup failed");
  return offering.publicId;
}

const get = (path: string, who?: Person) => call(`/api/academics${path}`, who ? { cookie: who.cookie } : {});
const post = (path: string, body: unknown, who?: Person) => call(`/api/academics${path}`, { method: "POST", body, cookie: who?.cookie });

// ---------------------------------------------------------------------------------------------
describe("who may use the teaching routes", () => {
  it("nobody who is signed out: 401", async () => {
    expect((await get(`/classes/${noId}/teaching`)).status).toBe(401);
    expect((await post("/assignments", { classId: noId, offeringId: noId, teacherId: null })).status).toBe(401);
    expect((await post(`/classes/${noId}/class-teacher`, { teacherId: null })).status).toBe(401);
  });

  it("a Student, Teacher and Accountant: 403 everywhere, and nothing is written", async () => {
    const levelId = await newLevel("plus2");
    const offeringId = await newOffering(levelId);
    const classId = await newClass(await newYear(), levelId);
    const before = await count("SELECT COUNT(*) AS n FROM teacher_assignments");
    for (const who of [student, teacher, accountant]) {
      expect((await get(`/classes/${classId}/teaching`, who)).status, who.publicId).toBe(403);
      expect((await post("/assignments", { classId, offeringId, teacherId: null }, who)).status).toBe(403);
      expect((await post(`/classes/${classId}/class-teacher`, { teacherId: null }, who)).status).toBe(403);
    }
    expect(await count("SELECT COUNT(*) AS n FROM teacher_assignments")).toBe(before);
  });

  it("the Admin may read but not write", async () => {
    const levelId = await newLevel("plus2");
    const classId = await newClass(await newYear(), levelId);
    expect((await get(`/classes/${classId}/teaching`, admin)).status).toBe(200);
    expect((await post(`/classes/${classId}/class-teacher`, { teacherId: null }, admin)).status).toBe(403);
  });

  it("the Co-ordinator and the Super Admin may read and assign", async () => {
    for (const who of [coordinator, superAdmin]) {
      const levelId = await newLevel("plus2");
      const offeringId = await newOffering(levelId);
      const classId = await newClass(await newYear(), levelId);
      const teacher2 = await newTeacher("plus2");

      const read = await get(`/classes/${classId}/teaching`, who);
      expect(read.status).toBe(200);
      expect(read.headers.get("Cache-Control")).toBe("no-store");

      expect((await post("/assignments", { classId, offeringId, teacherId: teacher2 }, who)).status).toBe(200);
      expect((await post(`/classes/${classId}/class-teacher`, { teacherId: teacher2 }, who)).status).toBe(200);
    }
  });

  it("a section-scoped Co-ordinator: another section's class is 404 to read, 403 to write, even with a guessed id", async () => {
    const bachelorsLevel = await newLevel("bachelors");
    const bachelorsOffering = await newOffering(bachelorsLevel);
    const bachelorsClass = await newClass(await newYear(), bachelorsLevel);

    expect((await get(`/classes/${bachelorsClass}/teaching`, plus2Coordinator)).status).toBe(404);
    expect((await post("/assignments", { classId: bachelorsClass, offeringId: bachelorsOffering, teacherId: null }, plus2Coordinator)).status).toBe(403);
    expect((await post(`/classes/${bachelorsClass}/class-teacher`, { teacherId: null }, plus2Coordinator)).status).toBe(403);
    // a class that does not exist at all reads exactly the same
    expect((await get(`/classes/${noId}/teaching`, plus2Coordinator)).status).toBe(404);
  });

  it("a section-scoped Co-ordinator naming another section's teacher is refused, even for their own class", async () => {
    const plus2Level = await newLevel("plus2");
    const offeringId = await newOffering(plus2Level);
    const classId = await newClass(await newYear(), plus2Level);
    const bachelorsTeacher = await newTeacher("bachelors");

    expect((await post("/assignments", { classId, offeringId, teacherId: bachelorsTeacher }, plus2Coordinator)).status).toBe(403);
    expect((await post(`/classes/${classId}/class-teacher`, { teacherId: bachelorsTeacher }, plus2Coordinator)).status).toBe(403);
  });

  it("an offering of the wrong level is 422; a repeat Class Teacher this year is 409", async () => {
    const levelA = await newLevel("plus2");
    const levelB = await newLevel("plus2");
    const levelC = await newLevel("plus2");
    const offeringOfB = await newOffering(levelB);
    const yearId = await newYear();
    const classOfA = await newClass(yearId, levelA);
    const classOfC = await newClass(yearId, levelC);
    const teacher2 = await newTeacher("plus2");

    expect((await post("/assignments", { classId: classOfA, offeringId: offeringOfB, teacherId: teacher2 }, coordinator)).status).toBe(422);

    expect((await post(`/classes/${classOfA}/class-teacher`, { teacherId: teacher2 }, coordinator)).status).toBe(200);
    expect((await post(`/classes/${classOfC}/class-teacher`, { teacherId: teacher2 }, coordinator)).status).toBe(409);
  });
});
