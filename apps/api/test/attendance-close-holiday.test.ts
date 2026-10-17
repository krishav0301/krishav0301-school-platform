import { beforeAll, describe, expect, it } from "vitest";

import { closeAttendanceDay } from "../src/modules/attendance";
import { count, db, person } from "./academics-helpers";
import { bulkStudents, bulkTeachers, presentToday, teachersPresentToday, today, userId } from "./close-helpers";
import { classWith, setModule, type ClassFixture } from "./schoolday-helpers";

/**
 * The end of the school day (D-176), a holiday for the students and a school day for the teachers. 100 students with two
 * Present: 98% have no mark, exactly on the line, so it is a holiday: nobody is marked Absent and the two who tapped keep
 * their Present. Four teachers, two Present, one on leave and one with no mark: it is a school day, so the one with no mark is
 * marked Absent. Marks already there are left alone: a teacher on leave stays on leave.
 */

const now = new Date();
const weekday = new Date(`${today()}T00:00:00Z`).getUTCDay();
const OPEN = { closesAt: "00:00", weeklyHoliday: (weekday + 1) % 7 };

let fixture: ClassFixture;
let students: number[];
let teachers: number[];
let admin: number;

beforeAll(async () => {
  await setModule("card_attendance", true);
  fixture = await classWith("plus2", 0);
  admin = await userId((await person("admin", "institution")).publicId);
  students = await bulkStudents(fixture.classId, 100);
  const classTeacher = await userId(fixture.classTeacher.publicId);
  teachers = [classTeacher, ...(await bulkTeachers(3))];
  await presentToday(students.slice(0, 2), admin);
  await teachersPresentToday(teachers.slice(0, 2), admin);
  // The fourth teacher is on leave: an existing mark the job must not touch.
  await db.prepare("INSERT INTO teacher_attendance (user_id, on_date, status, reason, marked_by_user_id, marked_at, updated_at) VALUES (?1, ?2, 'leave', 'Sick', ?3, ?4, ?4)").bind(teachers[3], today(), admin, now.toISOString()).run();
});

describe("a holiday for the students, a school day for the teachers", () => {
  it("makes it a holiday when 98 of 100 have no mark: nobody Absent, the two who tapped keep Present", async () => {
    const result = await closeAttendanceDay(db, now, OPEN);
    expect(result.students).toEqual({ status: "holiday", expected: 100, present: 2, absentMarked: 0 });
    expect(await count("SELECT COUNT(*) AS n FROM student_attendance WHERE on_date = ?1 AND status = 'absent'", today())).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM student_attendance WHERE on_date = ?1 AND status = 'present'", today())).toBe(2);
  });

  it("marks only the teacher with no mark Absent, and leaves the one on leave on leave", async () => {
    // Two Present, one on leave, one with no mark: of four expected, two have no Present mark, so it is a school day.
    expect(await count("SELECT COUNT(*) AS n FROM attendance_days WHERE subject = 'teachers' AND status = 'school_day' AND expected = 4 AND present = 2")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM teacher_attendance WHERE on_date = ?1 AND status = 'absent'", today())).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM teacher_attendance WHERE on_date = ?1 AND status = 'leave' AND reason = 'Sick'", today())).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM teacher_attendance WHERE on_date = ?1 AND status = 'present'", today())).toBe(2);
  });
});
