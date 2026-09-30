import { adToBsText } from "../../core/dates";
import { CLASS_JOINS, bindReach, classInReach, moduleOn, type Reach } from "./guard";
import { ATTENDANCE_ALERT_THRESHOLD, attendancePercent, belowThreshold } from "./policy";
import type { AttendanceClassList, AttendanceDay, AttendanceSummary, OwnAttendance } from "./schema";

/**
 * Every read is one round trip: a `batch()` whose first statement says whether the module is on, so a school
 * that switched attendance off gets "not found", not an empty page.
 */

export type Read<T> = { ok: true; data: T } | { ok: false; reason: "off" | "not_found" };

interface ClassRow {
  public_id: string;
  programme_name: string;
  level_name: string;
  label: string;
  section_key: string;
  class_teacher_user_id: number | null;
  me_id: number | null;
}

const naming = (r: ClassRow) => ({ id: r.public_id, programmeName: r.programme_name, levelName: r.level_name, label: r.label, sectionKey: r.section_key });
const fullName = (first: string, last: string) => `${first} ${last}`;

const CLASS_COLUMNS = `cl.public_id, pv.name AS programme_name, lv.name AS level_name, cl.label, s.key AS section_key, cl.class_teacher_user_id,
                       (SELECT id FROM users WHERE public_id = ?1) AS me_id`;

/** One class, if the person may see it. Parameters: 1 to 4 the reach, 5 the class. */
const classStatement = (db: D1Database, reach: Reach, classId: string) =>
  db
    .prepare(`SELECT ${CLASS_COLUMNS} FROM classes cl ${CLASS_JOINS} WHERE cl.public_id = ?5 AND ${classInReach(1)}`)
    .bind(...bindReach(reach), classId);

const moduleStatement = (db: D1Database) => db.prepare(`SELECT (${moduleOn("attendance")}) AS on_`);
const isOn = (result: D1Result) => (result.results[0] as { on_: number } | undefined)?.on_ === 1;

/** The classes of the active year the person may see, each with today's state. */
export async function listClasses(db: D1Database, reach: Reach, today: string): Promise<Read<AttendanceClassList>> {
  const [on, list] = await db.batch([
    moduleStatement(db),
    db
      .prepare(
        `SELECT ${CLASS_COLUMNS},
                (SELECT COUNT(*) FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active') AS students,
                (SELECT COUNT(*) FROM student_attendance sa JOIN enrollments en ON en.id = sa.enrollment_id WHERE en.class_id = cl.id AND sa.on_date = ?5) AS marked,
                (SELECT COUNT(*) FROM student_attendance sa JOIN enrollments en ON en.id = sa.enrollment_id WHERE en.class_id = cl.id AND sa.on_date = ?5 AND sa.status = 'absent') AS absent
           FROM classes cl ${CLASS_JOINS} JOIN academic_years ay ON ay.id = cl.academic_year_id
          WHERE ay.status = 'active' AND cl.is_active = 1 AND ${classInReach(1)}
          ORDER BY s.ordering, pv.ordering, lv.ordinal, cl.label`,
      )
      .bind(...bindReach(reach), today),
  ]);
  if (!isOn(on!)) return { ok: false, reason: "off" };
  const rows = list!.results as unknown as (ClassRow & { students: number; marked: number; absent: number })[];
  return {
    ok: true,
    data: {
      today,
      todayBs: adToBsText(today),
      classes: rows.map((r) => ({
        ...naming(r),
        students: r.students,
        markedToday: r.marked > 0,
        absentToday: r.absent,
        mine: r.me_id !== null && r.class_teacher_user_id === r.me_id,
      })),
    },
  };
}

interface RosterRow {
  public_id: string;
  sid: string;
  first_name: string;
  last_name: string;
  roll_no: number | null;
  status: "present" | "absent" | null;
}

const ROSTER_ORDER = `ORDER BY en.roll_no IS NULL, en.roll_no, st.first_name, st.last_name`;

/** A class's register for one day. Students who left still show on a day they were marked. */
export async function getDay(db: D1Database, reach: Reach, classId: string, date: string, today: string): Promise<Read<AttendanceDay>> {
  const [on, cls, roster] = await db.batch([
    moduleStatement(db),
    classStatement(db, reach, classId),
    db
      .prepare(
        `SELECT en.public_id, st.sid, st.first_name, st.last_name, en.roll_no, sa.status
           FROM classes cl JOIN enrollments en ON en.class_id = cl.id JOIN students st ON st.id = en.student_id
           LEFT JOIN student_attendance sa ON sa.enrollment_id = en.id AND sa.on_date = ?2
          WHERE cl.public_id = ?1 AND (en.status = 'active' OR sa.status IS NOT NULL)
          ${ROSTER_ORDER}`,
      )
      .bind(classId, date),
  ]);
  if (!isOn(on!)) return { ok: false, reason: "off" };
  const row = cls!.results[0] as ClassRow | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  const students = (roster!.results as unknown as RosterRow[]).map((r) => ({
    enrollmentId: r.public_id,
    sid: r.sid,
    name: fullName(r.first_name, r.last_name),
    rollNo: r.roll_no,
    status: r.status,
  }));
  const isToday = date === today;
  return {
    ok: true,
    data: {
      class: naming(row),
      date,
      dateBs: adToBsText(date),
      isToday,
      marked: students.some((s) => s.status !== null),
      canMark: isToday && row.me_id !== null && row.class_teacher_user_id === row.me_id,
      students,
    },
  };
}

interface TallyRow extends RosterRow {
  present_days: number;
  absent_days: number;
}

const tally = (present: number, absent: number) => {
  const percent = attendancePercent(present, present + absent);
  return { present, absent, percent, below: belowThreshold(percent) };
};

/** Each student's year so far in one class. */
export async function getSummary(db: D1Database, reach: Reach, classId: string): Promise<Read<AttendanceSummary>> {
  const [on, cls, rows] = await db.batch([
    moduleStatement(db),
    classStatement(db, reach, classId),
    db
      .prepare(
        `SELECT en.public_id, st.sid, st.first_name, st.last_name, en.roll_no, NULL AS status,
                COALESCE(SUM(sa.status = 'present'), 0) AS present_days, COALESCE(SUM(sa.status = 'absent'), 0) AS absent_days
           FROM classes cl JOIN enrollments en ON en.class_id = cl.id JOIN students st ON st.id = en.student_id
           LEFT JOIN student_attendance sa ON sa.enrollment_id = en.id
          WHERE cl.public_id = ?1
          GROUP BY en.id
          ${ROSTER_ORDER}`,
      )
      .bind(classId),
  ]);
  if (!isOn(on!)) return { ok: false, reason: "off" };
  const row = cls!.results[0] as ClassRow | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    data: {
      class: naming(row),
      threshold: ATTENDANCE_ALERT_THRESHOLD,
      students: (rows!.results as unknown as TallyRow[]).map((r) => ({
        enrollmentId: r.public_id,
        sid: r.sid,
        name: fullName(r.first_name, r.last_name),
        rollNo: r.roll_no,
        ...tally(r.present_days, r.absent_days),
      })),
    },
  };
}

/** The signed-in student's own year: their enrollment in the active year, found from the sign-in, never from an id. */
export async function getOwn(db: D1Database, userPublicId: string): Promise<Read<OwnAttendance>> {
  const mine = `SELECT en.id FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id
                 WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) AND ay.status = 'active'`;
  const [on, totals, days] = await db.batch([
    moduleStatement(db),
    db
      .prepare(
        `SELECT ay.label AS year_label,
                (SELECT COUNT(*) FROM student_attendance WHERE enrollment_id = en.id AND status = 'present') AS present_days,
                (SELECT COUNT(*) FROM student_attendance WHERE enrollment_id = en.id AND status = 'absent') AS absent_days
           FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id
          WHERE en.id = (${mine})`,
      )
      .bind(userPublicId),
    db.prepare(`SELECT on_date FROM student_attendance WHERE enrollment_id = (${mine}) AND status = 'absent' ORDER BY on_date DESC LIMIT 60`).bind(userPublicId),
  ]);
  if (!isOn(on!)) return { ok: false, reason: "off" };
  const row = totals!.results[0] as { year_label: string; present_days: number; absent_days: number } | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    data: {
      yearLabel: row.year_label,
      threshold: ATTENDANCE_ALERT_THRESHOLD,
      ...tally(row.present_days, row.absent_days),
      absentDays: (days!.results as unknown as { on_date: string }[]).map((d) => ({ date: d.on_date, dateBs: adToBsText(d.on_date) })),
    },
  };
}
