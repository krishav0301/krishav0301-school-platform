import { nepalDate } from "../src/core/dates";
import { newPublicId } from "../src/core/ids";
import { db } from "./academics-helpers";

/**
 * Plain SQL fixtures for the end-of-day job: it counts every student and teacher in the school, so a test needs a known
 * number of them (and a hundred sign-ins would be slow). Students here have no login; teachers have a user and a role.
 */

const at = "2026-09-22T00:00:00.000Z";
export const today = (): string => nepalDate(new Date());

let sid = 0;
const chunks = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/** `count` students with no login, enrolled in the class for its term. Returns their enrollment ids (the internal ones). */
export async function bulkStudents(classPublicId: string, count: number): Promise<number[]> {
  const publicIds = Array.from({ length: count }, () => newPublicId());
  for (const group of chunks(publicIds, 40)) {
    await db.batch(
      group.flatMap((publicId) => [
        db
          .prepare(
            `INSERT INTO students (public_id, sid, first_name, last_name, dob_ad, guardian_name, guardian_phone, admission_bs_year, created_at)
             VALUES (?1, ?2, 'Bulk', 'Student', '2008-05-14', 'Guardian', '9800000003', 2083, ?3)`,
          )
          .bind(publicId, `2083-B${++sid}-${publicId.slice(0, 4)}`, at),
        db
          .prepare(
            `INSERT INTO enrollments (public_id, student_id, academic_year_id, class_id, created_at)
             SELECT ?1, st.id, c.academic_year_id, c.id, ?2 FROM students st, classes c WHERE st.public_id = ?3 AND c.public_id = ?4`,
          )
          .bind(newPublicId(), at, publicId, classPublicId),
      ]),
    );
  }
  const rows = await db
    .prepare("SELECT e.id FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.last_name = 'Student' AND s.first_name = 'Bulk' ORDER BY e.id DESC LIMIT ?1")
    .bind(count)
    .all<{ id: number }>();
  return rows.results.map((r) => r.id).reverse();
}

/** `count` active teachers (a user and a teacher role); returns their user ids. */
export async function bulkTeachers(count: number): Promise<number[]> {
  const ids = Array.from({ length: count }, () => newPublicId());
  for (const group of chunks(ids, 40)) {
    await db.batch(
      group.flatMap((publicId) => [
        db.prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, '!', 'Bulk teacher')").bind(publicId, `bulk-${publicId}@school.example`),
        db.prepare("INSERT INTO role_assignments (user_id, role, scope_type) SELECT id, 'teacher', 'assigned' FROM users WHERE public_id = ?1").bind(publicId),
      ]),
    );
  }
  const rows = await db.prepare("SELECT id FROM users WHERE full_name = 'Bulk teacher' ORDER BY id DESC LIMIT ?1").bind(count).all<{ id: number }>();
  return rows.results.map((r) => r.id).reverse();
}

/** Marks these enrollments Present today, as someone. */
export async function presentToday(enrollmentIds: number[], markerUserId: number): Promise<void> {
  for (const group of chunks(enrollmentIds, 40)) {
    await db.batch(group.map((id) => db.prepare("INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at) VALUES (?1, ?2, 'present', ?3, ?4, ?4)").bind(id, today(), markerUserId, at)));
  }
}

/** Marks these teachers Present today. */
export async function teachersPresentToday(userIds: number[], markerUserId: number): Promise<void> {
  for (const group of chunks(userIds, 40)) {
    await db.batch(group.map((id) => db.prepare("INSERT INTO teacher_attendance (user_id, on_date, status, marked_by_user_id, marked_at, updated_at) VALUES (?1, ?2, 'present', ?3, ?4, ?4)").bind(id, today(), markerUserId, at)));
  }
}

export const userId = async (publicId: string): Promise<number> => (await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(publicId).first<{ id: number }>())!.id;
