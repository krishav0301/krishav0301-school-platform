import { recordAudit } from "../../core/audit";
import { CLASS_JOINS, NAMING_COLUMNS } from "./guard";
import { SaveTermAttendanceSchema, type SaveTermAttendance, type TermAttendance } from "./schema";

/**
 * Attendance for a terminal's marks card (the PM, 2026-11-10): the Class Teacher gives the days the class worked for an exam,
 * then each student's days present; the grade-point card prints the percentage. Reads and writes are for the person who leads
 * the class (or Support), re-checked from the database inside the write (D-021). One batch: the students' rows, the working
 * days and the one audit entry, all or nothing; sending it again replaces what was given, so a retry changes nothing new.
 *
 * OPEN: the counts are the teacher's own, not worked out from the daily register (the PM asked for them to be typed).
 */

export type TermAttendanceResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "year_closed" }
  | { ok: false; reason: "invalid"; message: string };

/** The person `?n` leads class `cl` as an active teacher, or is an active Super Admin (Support). */
const mayGive = (n: number): string =>
  `EXISTS (SELECT 1 FROM users u WHERE u.public_id = ?${n} AND u.is_active = 1
     AND ((cl.class_teacher_user_id = u.id AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = u.id AND ra.role = 'teacher' AND ra.is_active = 1))
       OR EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = u.id AND ra.role = 'super_admin' AND ra.is_active = 1)))`;

/**
 * One class and exam's attendance. `me`: the person asking, who must lead the class (or be Support: `support`). Null when not theirs,
 * no such class or exam, or the exam belongs to another year.
 */
export async function termAttendanceFor(db: D1Database, me: string, support: boolean, classId: string, terminalId: string): Promise<TermAttendance | null> {
  const [head, students] = await db.batch([
    db
      .prepare(
        `SELECT cl.public_id AS class_id, ${NAMING_COLUMNS}, ay.label AS year_label, ay.status AS year_status, t.public_id AS terminal_id, t.name AS terminal_name, d.working_days
           FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id
           JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?2
           LEFT JOIN term_attendance_days d ON d.class_id = cl.id AND d.terminal_id = t.id
          WHERE cl.public_id = ?1 AND (?4 = 1 OR cl.class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?3 AND is_active = 1))`,
      )
      .bind(classId, terminalId, me, support ? 1 : 0),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, st.sid, en.roll_no, trim(st.first_name || ' ' || COALESCE(st.middle_name || ' ', '') || st.last_name) AS name, ta.days_present
           FROM classes cl JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' JOIN students st ON st.id = en.student_id
           JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?2
           LEFT JOIN term_attendance ta ON ta.terminal_id = t.id AND ta.enrollment_id = en.id
          WHERE cl.public_id = ?1 ORDER BY en.roll_no IS NULL, en.roll_no, name, en.id`,
      )
      .bind(classId, terminalId),
  ]);
  const h = head!.results[0] as { class_id: string; programme_name: string; level_name: string; label: string; year_label: string; year_status: string; terminal_id: string; terminal_name: string; working_days: number | null } | undefined;
  if (!h) return null;
  return {
    classId: h.class_id,
    programmeName: h.programme_name,
    levelName: h.level_name,
    label: h.label,
    yearLabel: h.year_label,
    terminalId: h.terminal_id,
    terminalName: h.terminal_name,
    workingDays: h.working_days,
    locked: h.year_status === "closed",
    students: (students!.results as unknown as { enrollment_id: string; sid: string; roll_no: number | null; name: string; days_present: number | null }[]).map((r) => ({
      enrollmentId: r.enrollment_id,
      sid: r.sid,
      rollNo: r.roll_no,
      name: r.name,
      daysPresent: r.days_present,
    })),
  };
}

/** Saves one class and exam's attendance. A student sent with null has nothing given; a student not sent is left as they were. */
export async function saveTermAttendance(db: D1Database, auditKey: string, actor: string, support: boolean, classId: string, terminalId: string, input: SaveTermAttendance, now = new Date()): Promise<TermAttendanceResult> {
  const parsed = SaveTermAttendanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const { workingDays, students } = parsed.data;
  const given = JSON.stringify(students.filter((s) => s.daysPresent !== null));
  const cleared = JSON.stringify(students.filter((s) => s.daysPresent === null).map((s) => s.enrollmentId));
  const named = JSON.stringify(students.map((s) => s.enrollmentId));
  const at = now.toISOString();

  // One read: may they, is the year open, and are all the students named in this class.
  const check = await db
    .prepare(
      `SELECT ay.status AS year_status, ${mayGive(3)} AS allowed,
              (SELECT COUNT(*) FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active' AND en.public_id IN (SELECT value FROM json_each(?4))) AS in_class
         FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?2
        WHERE cl.public_id = ?1`,
    )
    .bind(classId, terminalId, actor, named)
    .first<{ year_status: string; allowed: number; in_class: number }>();
  if (!check || check.allowed !== 1) return { ok: false, reason: "not_found" };
  if (check.year_status === "closed") return { ok: false, reason: "year_closed" };
  if (check.in_class !== students.length) return { ok: false, reason: "invalid", message: "A student listed is not in this class" };

  const base = `FROM classes cl JOIN academic_years ay ON ay.id = cl.academic_year_id JOIN terminals t ON t.academic_year_id = cl.academic_year_id AND t.public_id = ?2, users u`;
  const gate = `cl.public_id = ?1 AND u.public_id = ?3 AND ${mayGive(3)} AND ay.status <> 'closed'`;
  const clear = db
    .prepare(`DELETE FROM term_attendance WHERE terminal_id = (SELECT t.id ${base} WHERE ${gate}) AND enrollment_id IN (SELECT en.id FROM enrollments en JOIN classes cl ON cl.id = en.class_id WHERE cl.public_id = ?1 AND en.public_id IN (SELECT value FROM json_each(?4)))`)
    .bind(classId, terminalId, actor, cleared);
  const upsert = db
    .prepare(
      `INSERT INTO term_attendance (terminal_id, enrollment_id, days_present, updated_by_user_id, updated_at)
       SELECT t.id, en.id, j.days, u.id, ?5 ${base} JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active'
         JOIN (SELECT json_extract(value, '$.enrollmentId') AS eid, json_extract(value, '$.daysPresent') AS days FROM json_each(?4)) j ON j.eid = en.public_id
        WHERE ${gate}
       ON CONFLICT (terminal_id, enrollment_id) DO UPDATE SET days_present = excluded.days_present, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
    )
    .bind(classId, terminalId, actor, given, at);
  // The deciding statement is last: nothing is recorded if the re-check failed.
  const days = db
    .prepare(
      `INSERT INTO term_attendance_days (terminal_id, class_id, working_days, updated_by_user_id, updated_at)
       SELECT t.id, cl.id, ?4, u.id, ?5 ${base} WHERE ${gate}
       ON CONFLICT (terminal_id, class_id) DO UPDATE SET working_days = excluded.working_days, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
    )
    .bind(classId, terminalId, actor, workingDays, at);

  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "results.term_attendance.saved",
        entityType: "class",
        entityPublicId: classId,
        actorPublicId: actor,
        summary: `Attendance for the exam saved: ${workingDays} working days, ${students.filter((s) => s.daysPresent !== null).length} students given`,
        after: { terminalId, workingDays, students: students.map((s) => ({ enrollmentId: s.enrollmentId, daysPresent: s.daysPresent })) },
      },
      [clear, upsert, days],
      { onlyIfLastChanged: true },
    );
    if (!applied) return { ok: false, reason: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/academic year is closed/i.test(message)) return { ok: false, reason: "year_closed" };
    throw error;
  }
  return { ok: true };
}
