import { newPublicId } from "../src/core/ids";
import { db, person, seedSections, type Person } from "./academics-helpers";

/**
 * Phase 5 fixtures: an active year, classes with a Class Teacher, and enrolled students with their own
 * sign-ins. Built with plain SQL (the flows that make these are Phase 3 and 4's, already tested there), so a
 * test file reads as the Phase 5 rule it checks.
 */

const at = "2026-09-22T00:00:00.000Z";

async function idOf(table: string, publicId: string): Promise<number> {
  return (await db.prepare(`SELECT id FROM ${table} WHERE public_id = ?1`).bind(publicId).first<{ id: number }>())!.id;
}

let yearPublicId: string | null = null;
/** The one active year these tests use (made on first call). */
export async function activeYear(): Promise<string> {
  if (yearPublicId) return yearPublicId;
  await seedSections();
  yearPublicId = newPublicId();
  await db
    .prepare(`INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at) VALUES (?1, 2083, '2083', '2083', '2026-04-14', '2027-04-13', 'active', ?2)`)
    .bind(yearPublicId, at)
    .run();
  return yearPublicId;
}

let n = 0;
const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`;

/** A teacher (a real sign-in) with a home section. */
export async function teacherIn(sectionKey: "plus2" | "bachelors"): Promise<Person> {
  const teacher = await person("teacher", "assigned");
  await db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) SELECT u.id, s.id FROM users u, sections s WHERE u.public_id = ?1 AND s.key = ?2").bind(teacher.publicId, sectionKey).run();
  return teacher;
}

export interface Pupil {
  person: Person;
  studentId: string;
  enrollmentId: string;
}

export interface ClassFixture {
  classId: string;
  levelId: string;
  offeringId: string;
  classTeacher: Person;
  pupils: Pupil[];
}

/** A programme and level in the section, a class of the active year with a Class Teacher, one subject offering, and `size` enrolled students. */
export async function classWith(sectionKey: "plus2" | "bachelors", size = 3, options: { classTeacher?: Person } = {}): Promise<ClassFixture> {
  const yearId = await activeYear();
  const t = tag();
  const programmeId = newPublicId();
  await db
    .prepare(`INSERT INTO programmes (public_id, key, name, section_id, affiliation, ordering) SELECT ?1, ?2, ?3, id, 'Board', 0 FROM sections WHERE key = ?4`)
    .bind(programmeId, `p${t}`, `Programme ${t}`, sectionKey)
    .run();
  const levelId = newPublicId();
  await db.prepare(`INSERT INTO levels (public_id, programme_id, ordinal, name) SELECT ?1, id, 1, ?2 FROM programmes WHERE public_id = ?3`).bind(levelId, `Level ${t}`, programmeId).run();

  const classTeacher = options.classTeacher ?? (await teacherIn(sectionKey));
  // A class is only for a level its term runs (D-110).
  await db.prepare("INSERT OR IGNORE INTO term_levels (academic_year_id, level_id) SELECT y.id, l.id FROM academic_years y, levels l WHERE y.public_id = ?1 AND l.public_id = ?2").bind(yearId, levelId).run();
  const classId = newPublicId();
  await db
    .prepare(
      `INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label, class_teacher_user_id)
       SELECT ?1, y.id, l.programme_id, l.id, '', u.id FROM academic_years y, levels l, users u WHERE y.public_id = ?2 AND l.public_id = ?3 AND u.public_id = ?4`,
    )
    .bind(classId, yearId, levelId, classTeacher.publicId)
    .run();

  const subjectId = newPublicId();
  await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(subjectId, `Subject ${t}`).run();
  const offeringId = newPublicId();
  await db
    .prepare(`INSERT INTO subject_offerings (public_id, level_id, subject_id) SELECT ?1, l.id, s.id FROM levels l, subjects s WHERE l.public_id = ?2 AND s.public_id = ?3`)
    .bind(offeringId, levelId, subjectId)
    .run();

  const pupils: Pupil[] = [];
  for (let i = 0; i < size; i++) pupils.push(await enrol(classId, `Pupil${t}x${i}`));
  return { classId, levelId, offeringId, classTeacher, pupils };
}

let sid = 0;
/** A student with a real sign-in, enrolled in the class for the active year. */
export async function enrol(classId: string, lastName: string): Promise<Pupil> {
  const student = await person("student", "own");
  const studentId = newPublicId();
  await db
    .prepare(
      `INSERT INTO students (public_id, sid, user_id, first_name, last_name, dob_ad, guardian_name, guardian_phone, admission_bs_year, created_at)
       SELECT ?1, ?2, id, 'Sita', ?3, '2008-05-14', 'Guardian', '9800000001', 2083, ?4 FROM users WHERE public_id = ?5`,
    )
    .bind(studentId, `2083-${String(++sid).padStart(5, "0")}${tag()}`, lastName, at, student.publicId)
    .run();
  const enrollmentId = newPublicId();
  await db
    .prepare(
      `INSERT INTO enrollments (public_id, student_id, academic_year_id, class_id, created_at)
       SELECT ?1, st.id, c.academic_year_id, c.id, ?2 FROM students st, classes c WHERE st.public_id = ?3 AND c.public_id = ?4`,
    )
    .bind(enrollmentId, at, studentId, classId)
    .run();
  return { person: student, studentId, enrollmentId };
}

/** Gives a teacher an active assignment to teach the offering in the class. */
export async function assign(teacher: Person, classId: string, offeringId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO teacher_assignments (public_id, class_id, offering_id, teacher_user_id, created_at)
       SELECT ?1, c.id, o.id, u.id, ?2 FROM classes c, subject_offerings o, users u WHERE c.public_id = ?3 AND o.public_id = ?4 AND u.public_id = ?5`,
    )
    .bind(newPublicId(), at, classId, offeringId, teacher.publicId)
    .run();
}

export async function setModule(key: string, enabled: boolean): Promise<void> {
  await db.prepare("INSERT INTO module_switches (key, enabled) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled").bind(key, enabled ? 1 : 0).run();
}

export { idOf };
