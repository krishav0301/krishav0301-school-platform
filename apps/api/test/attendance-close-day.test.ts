import { beforeAll, describe, expect, it } from "vitest";

import { nepalDate } from "../src/core/dates";
import { closeAttendanceDay } from "../src/modules/attendance";
import { DAY_CLOSES_AT, HOLIDAY_ABSENT_PERCENT, isHolidayFor } from "../src/modules/attendance/policy";
import { count, db, person } from "./academics-helpers";
import { bulkStudents, bulkTeachers, presentToday, teachersPresentToday, today, userId } from "./close-helpers";
import { classWith, setModule, type ClassFixture } from "./schoolday-helpers";

/**
 * The end of the school day (D-176), a school day for the students and a holiday for the teachers. 100 students with
 * three Present: 97% have no mark, one short of the line, so the other 97 are marked Absent. 50 teachers with one Present:
 * 49 of 50 is exactly 98%, so it is a holiday for the teachers, nobody is marked Absent and the one who tapped keeps
 * their Present. (The opposite pair is in `attendance-close-holiday.test.ts`; one day is decided once, so each file has its own.)
 */

const now = new Date();
const weekday = new Date(`${today()}T00:00:00Z`).getUTCDay();
/** A school day (the weekly holiday is not today) that has already closed (the closing time was midnight). */
const OPEN: { closesAt: string; weeklyHoliday: number } = { closesAt: "00:00", weeklyHoliday: (weekday + 1) % 7 };

let fixture: ClassFixture;
let students: number[];
let classTeacher: number;
let admin: number;

const marks = (table: "student_attendance" | "teacher_attendance", status: string) =>
  count(`SELECT COUNT(*) AS n FROM ${table} WHERE on_date = ?1 AND status = ?2`, today(), status);

beforeAll(async () => {
  await setModule("card_attendance", true);
  fixture = await classWith("plus2", 0);
  admin = await userId((await person("admin", "institution")).publicId);
  classTeacher = await userId(fixture.classTeacher.publicId);
  students = await bulkStudents(fixture.classId, 100);
  await bulkTeachers(49);
  await presentToday(students.slice(0, 3), admin);
  await teachersPresentToday([classTeacher], admin);
});

describe("the rule", () => {
  it("is 98%: 98 of 100 with no mark is a holiday, 97 is not, and nobody expected is never one", () => {
    expect(HOLIDAY_ABSENT_PERCENT).toBe(98);
    expect(isHolidayFor(100, 2)).toBe(true);
    expect(isHolidayFor(100, 3)).toBe(false);
    expect(isHolidayFor(50, 1)).toBe(true);
    expect(isHolidayFor(50, 2)).toBe(false);
    expect(isHolidayFor(4, 0)).toBe(true);
    expect(isHolidayFor(0, 0)).toBe(false);
  });

  it("closes the day at 18:00 Nepal time until the school gives its hours", () => {
    expect(DAY_CLOSES_AT).toBe("18:00");
  });
});

describe("before the day is decided", () => {
  it("does nothing before closing time, on the weekly holiday, or where the school does not use cards", async () => {
    expect(await closeAttendanceDay(db, now, { ...OPEN, closesAt: "99:99" })).toEqual({ date: today(), skipped: "not_yet" });
    expect(await closeAttendanceDay(db, now, { ...OPEN, weeklyHoliday: weekday })).toEqual({ date: today(), skipped: "weekly_holiday" });
    await setModule("card_attendance", false);
    expect(await closeAttendanceDay(db, now, OPEN)).toEqual({ date: today(), skipped: "off" });
    await db.prepare("DELETE FROM module_switches WHERE key = 'card_attendance'").run();
    expect(await closeAttendanceDay(db, now, OPEN)).toEqual({ date: today(), skipped: "off" });
    await setModule("card_attendance", true);
    expect(await count("SELECT COUNT(*) AS n FROM attendance_days")).toBe(0);
    expect(await marks("student_attendance", "absent")).toBe(0);
  });
});

describe("closing the day", () => {
  let result: Awaited<ReturnType<typeof closeAttendanceDay>>;
  beforeAll(async () => {
    result = await closeAttendanceDay(db, now, OPEN);
  });

  it("marks the students with no mark Absent when 97 of 100 have none, and leaves the three Present", () => {
    expect(result.students).toEqual({ status: "school_day", expected: 100, present: 3, absentMarked: 97 });
  });

  it("makes it a holiday for the teachers when 49 of 50 have none: nobody Absent, and the one who tapped keeps Present", async () => {
    expect(result.teachers).toEqual({ status: "holiday", expected: 50, present: 1, absentMarked: 0 });
    expect(await marks("teacher_attendance", "absent")).toBe(0);
    expect(await marks("teacher_attendance", "present")).toBe(1);
  });

  it("writes the students' marks as the automatic attendance user, and keeps the three Present marks as they were", async () => {
    expect(await marks("student_attendance", "absent")).toBe(97);
    expect(await marks("student_attendance", "present")).toBe(3);
    const markers = await db.prepare("SELECT DISTINCT u.full_name FROM student_attendance a JOIN users u ON u.id = a.marked_by_user_id WHERE a.on_date = ?1 AND a.status = 'absent'").bind(today()).all<{ full_name: string }>();
    expect(markers.results).toEqual([{ full_name: "Automatic attendance" }]);
    expect(await count("SELECT COUNT(*) AS n FROM student_attendance WHERE on_date = ?1 AND status = 'present' AND marked_by_user_id = ?2", today(), admin)).toBe(3);
  });

  it("records each decision once, with how many were expected and how many were Present", async () => {
    const days = await db.prepare("SELECT on_date, subject, status, expected, present FROM attendance_days ORDER BY subject").all();
    expect(days.results).toEqual([
      { on_date: today(), subject: "students", status: "school_day", expected: 100, present: 3 },
      { on_date: today(), subject: "teachers", status: "holiday", expected: 50, present: 1 },
    ]);
  });

  it("is safe to run again: the day is decided once and nothing more is written", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM student_attendance");
    const again = await closeAttendanceDay(db, now, OPEN);
    expect(again.students?.status).toBe("already_decided");
    expect(again.teachers?.status).toBe("already_decided");
    expect(await count("SELECT COUNT(*) AS n FROM student_attendance")).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM attendance_days")).toBe(2);
  });

  it("two runs at once decide the day once", async () => {
    const other = new Date(now.getTime() + 1000);
    const [a, b] = await Promise.all([closeAttendanceDay(db, other, OPEN), closeAttendanceDay(db, now, OPEN)]);
    expect([a.students?.status, b.students?.status]).toEqual(["already_decided", "already_decided"]);
    expect(await count("SELECT COUNT(*) AS n FROM attendance_days")).toBe(2);
  });
});

describe("what the database holds", () => {
  it("never changes or deletes a decided day", async () => {
    await expect(db.prepare("UPDATE attendance_days SET status = 'holiday'").run()).rejects.toThrow(/never changed/);
    await expect(db.prepare("DELETE FROM attendance_days").run()).rejects.toThrow(/never deleted/);
  });

  it("the automatic attendance user exists, switched off, with no role", async () => {
    const row = await db.prepare("SELECT is_active, (SELECT COUNT(*) FROM role_assignments WHERE user_id = users.id) AS roles FROM users WHERE email = 'automatic-attendance@system.invalid'").first<{ is_active: number; roles: number }>();
    expect(row).toEqual({ is_active: 0, roles: 0 });
  });

  it("the Nepal date in the decision is today's", async () => {
    expect((await db.prepare("SELECT on_date FROM attendance_days LIMIT 1").first<{ on_date: string }>())!.on_date).toBe(nepalDate(now));
  });
});
