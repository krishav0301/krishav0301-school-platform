import { nepalDate, nepalTime } from "../../core/dates";
import { DAY_CLOSES_AT, isHolidayFor } from "./policy";

export interface CloseOptions {
  /** When the day closes, Nepal time "HH:MM". */
  closesAt?: string;
  /** The weekly holiday as a weekday, 0 = Sunday to 6 = Saturday; `null` for none. Saturday unless told otherwise (CLAUDE.md section 6). */
  weeklyHoliday?: number | null;
}

export interface SubjectClose {
  /** school_day: those with no Present mark were marked Absent. holiday: 98% or more had none, so nobody was. already_decided: an earlier run did it. off: this module is switched off. */
  status: "school_day" | "holiday" | "already_decided" | "nobody" | "off";
  expected: number;
  present: number;
  absentMarked: number;
}

export interface CloseResult {
  date: string;
  skipped?: "off" | "not_yet" | "weekly_holiday";
  students?: SubjectClose;
  teachers?: SubjectClose;
}

const SYSTEM_USER = "(SELECT id FROM users WHERE email = 'automatic-attendance@system.invalid')";
const switchedOn = (key: string) => `COALESCE((SELECT enabled FROM module_switches WHERE key = '${key}'), 1) = 1`;

/** A student expected today: an active enrollment in an active term. */
const STUDENT_EXPECTED = `FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id WHERE en.status = 'active' AND ay.status = 'active'`;
/** A teacher expected today: an active user who still holds an active teacher role. */
const TEACHER_EXPECTED = `FROM users u WHERE u.is_active = 1 AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = u.id AND ra.is_active = 1 AND ra.role = 'teacher')`;

/**
 * The end of a school day (D-176): once the day has closed, everyone with no Present mark is marked Absent, unless nearly
 * everyone in their group (98% of the students, or of the teachers) has none, which makes the day a holiday for that
 * group. Then nobody is marked Absent, and the few who did tap keep their Present. Students and teachers are decided
 * apart: a day can be a school day for the students and a holiday for the teachers.
 *
 * Whatever is already marked is left alone: a Class Teacher's or the Co-ordinator's own mark, a card tap, a teacher's
 * leave. The decision is one insert-only row per group and day (`attendance_days`), and it is written in the same batch
 * as the Absent marks, so a run that repeats, or two that overlap, decide the day once. Marks are written as the system
 * user, "Automatic attendance". It runs every few minutes from the Worker's schedule, so a missed run is made up
 * later the same day; student and teacher attendance accept only today, so a day that is missed entirely stays unmarked.
 *
 * Only for a school that uses cards: without them people are still marked by hand, as before.
 */
export async function closeAttendanceDay(db: D1Database, now = new Date(), options: CloseOptions = {}): Promise<CloseResult> {
  const date = nepalDate(now);
  const weeklyHoliday = options.weeklyHoliday === undefined ? 6 : options.weeklyHoliday;

  const modules = await db
    .prepare(
      `SELECT ${switchedOn("attendance")} AS students_on, ${switchedOn("teacher_attendance")} AS teachers_on,
              COALESCE((SELECT enabled FROM module_switches WHERE key = 'card_attendance'), 0) AS cards_on`,
    )
    .first<{ students_on: number; teachers_on: number; cards_on: number }>();
  if (!modules || modules.cards_on !== 1) return { date, skipped: "off" };
  if (nepalTime(now) < (options.closesAt ?? DAY_CLOSES_AT)) return { date, skipped: "not_yet" };
  if (weeklyHoliday !== null && new Date(`${date}T00:00:00Z`).getUTCDay() === weeklyHoliday) return { date, skipped: "weekly_holiday" };

  const at = now.toISOString();
  const off: SubjectClose = { status: "off", expected: 0, present: 0, absentMarked: 0 };
  return {
    date,
    students: modules.students_on === 1 ? await closeGroup(db, date, at, "students") : off,
    teachers: modules.teachers_on === 1 ? await closeGroup(db, date, at, "teachers") : off,
  };
}

async function closeGroup(db: D1Database, date: string, at: string, subject: "students" | "teachers"): Promise<SubjectClose> {
  const students = subject === "students";
  const counts = await db
    .prepare(
      students
        ? `SELECT (SELECT COUNT(*) ${STUDENT_EXPECTED}) AS expected,
                  (SELECT COUNT(*) FROM student_attendance sa JOIN enrollments en ON en.id = sa.enrollment_id JOIN academic_years ay ON ay.id = en.academic_year_id
                    WHERE sa.on_date = ?1 AND sa.status = 'present' AND en.status = 'active' AND ay.status = 'active') AS present,
                  (SELECT COUNT(*) FROM attendance_days WHERE on_date = ?1 AND subject = 'students') AS decided`
        : `SELECT (SELECT COUNT(*) ${TEACHER_EXPECTED}) AS expected,
                  (SELECT COUNT(*) FROM teacher_attendance ta JOIN users u ON u.id = ta.user_id
                    WHERE ta.on_date = ?1 AND ta.status = 'present' AND u.is_active = 1
                      AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = u.id AND ra.is_active = 1 AND ra.role = 'teacher')) AS present,
                  (SELECT COUNT(*) FROM attendance_days WHERE on_date = ?1 AND subject = 'teachers') AS decided`,
    )
    .bind(date)
    .first<{ expected: number; present: number; decided: number }>();
  const { expected, present, decided } = counts!;
  if (decided > 0) return { status: "already_decided", expected, present, absentMarked: 0 };
  if (expected === 0) return { status: "nobody", expected, present, absentMarked: 0 };

  const holiday = isHolidayFor(expected, present);
  const decide = db
    .prepare("INSERT INTO attendance_days (on_date, subject, status, expected, present, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(date, subject, holiday ? "holiday" : "school_day", expected, present, at);
  // Only on a school day, and only if the decision above is this run's own: a run that lost the race wrote nothing at all.
  const markAbsent = db
    .prepare(
      students
        ? `INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at)
           SELECT en.id, ?1, 'absent', ${SYSTEM_USER}, ?2, ?2 ${STUDENT_EXPECTED}
              AND EXISTS (SELECT 1 FROM attendance_days d WHERE d.on_date = ?1 AND d.subject = 'students' AND d.status = 'school_day' AND d.decided_at = ?2)
              AND NOT EXISTS (SELECT 1 FROM student_attendance x WHERE x.enrollment_id = en.id AND x.on_date = ?1)`
        : `INSERT INTO teacher_attendance (user_id, on_date, status, reason, marked_by_user_id, marked_at, updated_at)
           SELECT u.id, ?1, 'absent', NULL, ${SYSTEM_USER}, ?2, ?2 ${TEACHER_EXPECTED}
              AND EXISTS (SELECT 1 FROM attendance_days d WHERE d.on_date = ?1 AND d.subject = 'teachers' AND d.status = 'school_day' AND d.decided_at = ?2)
              AND NOT EXISTS (SELECT 1 FROM teacher_attendance x WHERE x.user_id = u.id AND x.on_date = ?1)`,
    )
    .bind(date, at);

  try {
    const [, marked] = await db.batch([decide, markAbsent]);
    return { status: holiday ? "holiday" : "school_day", expected, present, absentMarked: marked!.meta.changes ?? 0 };
  } catch (error) {
    // Another run decided this group first: its decision stands and this one wrote nothing.
    if (/UNIQUE constraint failed: attendance_days/i.test(error instanceof Error ? error.message : String(error))) return { status: "already_decided", expected, present, absentMarked: 0 };
    throw error;
  }
}
