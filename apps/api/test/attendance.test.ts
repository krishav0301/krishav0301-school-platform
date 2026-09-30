import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { nepalDate } from "../src/core/dates";
import { attendancePercent, belowThreshold } from "../src/modules/attendance/policy";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { classWith, setModule, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * Student attendance (Phase 5, slice 1, D-069). CLAUDE.md section 6: once a day, by the class's Class Teacher,
 * Present or Absent only, same-day edits only. A student sees only their own; a section-scoped person gets nothing
 * from the other section.
 */

interface Roster {
  date: string;
  dateBs: string;
  marked: boolean;
  students: { enrollmentId: string; sid: string; name: string; status: "present" | "absent" | null }[];
}

let plus2: ClassFixture, bachelors: ClassFixture;
let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, superAdmin: Person, otherTeacher: Person;
const today = () => nepalDate(new Date());

beforeAll(async () => {
  plus2 = await classWith("plus2", 3);
  bachelors = await classWith("bachelors", 2);
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  superAdmin = await person("super_admin", "institution");
  otherTeacher = await teacherIn("plus2");
});

const mark = (fixture: ClassFixture, absent: string[], cookie = fixture.classTeacher.cookie) =>
  call(`/api/attendance/classes/${fixture.classId}/today`, { method: "PUT", cookie, body: { absent } });
const roster = async (fixture: ClassFixture, cookie: string, date?: string) =>
  call(`/api/attendance/classes/${fixture.classId}/day${date ? `?date=${date}` : ""}`, { cookie });

describe("the policy", () => {
  it("is present days over marked days, rounded down to a whole percent; no marked days is no percentage", () => {
    expect(attendancePercent(3, 4)).toBe(75);
    expect(attendancePercent(2, 3)).toBe(66);
    expect(attendancePercent(0, 0)).toBeNull();
  });

  it("flags below the 75% placeholder, never exactly at it, and never with nothing marked", () => {
    expect(belowThreshold(74)).toBe(true);
    expect(belowThreshold(75)).toBe(false);
    expect(belowThreshold(null)).toBe(false);
  });
});

describe("the Class Teacher marks today", () => {
  it("before marking, the roster lists every student, not marked, in the class's order", async () => {
    const response = await roster(plus2, plus2.classTeacher.cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Roster;
    expect(body.date).toBe(today());
    expect(body.marked).toBe(false);
    expect(body.students.map((s) => s.enrollmentId).sort()).toEqual(plus2.pupils.map((p) => p.enrollmentId).sort());
    expect(body.students.every((s) => s.status === null)).toBe(true);
  });

  it("everyone not named absent is Present, and the day is recorded with one audit entry", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'attendance.student.marked'");
    const absent = plus2.pupils[0]!.enrollmentId;
    const response = await mark(plus2, [absent]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, present: 2, absent: 1 });

    const body = (await (await roster(plus2, plus2.classTeacher.cookie)).json()) as Roster;
    expect(body.marked).toBe(true);
    const byId = Object.fromEntries(body.students.map((s) => [s.enrollmentId, s.status]));
    expect(byId[absent]).toBe("absent");
    expect(byId[plus2.pupils[1]!.enrollmentId]).toBe("present");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'attendance.student.marked'")).toBe(before + 1);
  });

  it("marking again the same day replaces the day: no second row per student, the latest answer wins", async () => {
    const second = plus2.pupils[1]!.enrollmentId;
    expect((await mark(plus2, [second])).status).toBe(200);
    expect((await mark(plus2, [second])).status).toBe(200); // a retry after a lost answer changes nothing new
    const rows = await count(
      "SELECT COUNT(*) AS n FROM student_attendance sa JOIN enrollments en ON en.id = sa.enrollment_id JOIN classes c ON c.id = en.class_id WHERE c.public_id = ?1",
      plus2.classId,
    );
    expect(rows).toBe(3);
    const body = (await (await roster(plus2, plus2.classTeacher.cookie)).json()) as Roster;
    expect(body.students.filter((s) => s.status === "absent").map((s) => s.enrollmentId)).toEqual([second]);
  });

  it("refuses a student who is not in this class, and changes nothing", async () => {
    const response = await mark(plus2, [bachelors.pupils[0]!.enrollmentId]);
    expect(response.status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM student_attendance sa JOIN enrollments en ON en.id = sa.enrollment_id WHERE en.public_id = ?1", bachelors.pupils[0]!.enrollmentId)).toBe(0);
  });
});

describe("who may mark", () => {
  it("only this class's Class Teacher: another teacher, even another class's Class Teacher, gets 404 and nothing is written", async () => {
    expect((await mark(bachelors, [], otherTeacher.cookie)).status).toBe(404);
    expect((await mark(bachelors, [], plus2.classTeacher.cookie)).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM student_attendance sa JOIN enrollments en ON en.id = sa.enrollment_id JOIN classes c ON c.id = en.class_id WHERE c.public_id = ?1", bachelors.classId)).toBe(0);
  });

  it("no other role marks student attendance, not even the Co-ordinator or the Admin", async () => {
    for (const who of [coordinator, admin, accountant, superAdmin, plus2.pupils[0]!.person]) {
      expect((await mark(plus2, [], who.cookie)).status).toBe(403);
    }
  });

  it("a Class Teacher who has been deactivated cannot mark, even with a sign-in that has not expired", async () => {
    const fixture = await classWith("plus2", 1);
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(fixture.classTeacher.publicId).run();
    expect((await mark(fixture, [])).status).toBe(404);
  });

  it("a Class Teacher replaced by another loses the class at once", async () => {
    const fixture = await classWith("plus2", 1);
    const replacement = await teacherIn("plus2");
    await db.prepare("UPDATE classes SET class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?1) WHERE public_id = ?2").bind(replacement.publicId, fixture.classId).run();
    expect((await mark(fixture, [])).status).toBe(404);
    expect((await mark(fixture, [], replacement.cookie)).status).toBe(200);
  });
});

describe("who may look", () => {
  it("the Co-ordinator and the Admin see any class; a section-scoped Co-ordinator only their own section's", async () => {
    for (const who of [coordinator, admin, superAdmin, plus2Coordinator]) expect((await roster(plus2, who.cookie)).status).toBe(200);
    expect((await roster(plus2, bachelorsCoordinator.cookie)).status).toBe(404);
    expect((await roster(bachelors, plus2Coordinator.cookie)).status).toBe(404);
  });

  it("a teacher sees only the class they are Class Teacher of; a student and the Accountant see no class", async () => {
    expect((await roster(bachelors, plus2.classTeacher.cookie)).status).toBe(404);
    expect((await roster(plus2, otherTeacher.cookie)).status).toBe(404);
    expect((await roster(plus2, plus2.pupils[0]!.person.cookie)).status).toBe(404);
    expect((await roster(plus2, accountant.cookie)).status).toBe(403);
  });

  it("the class list holds only the classes a person may see, each with whether today is marked", async () => {
    const list = async (who: Person) =>
      ((await (await call("/api/attendance/classes", { cookie: who.cookie })).json()) as { classes: { id: string; markedToday: boolean; mine: boolean }[] }).classes;
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

    const teachers = await list(plus2.classTeacher);
    expect(ids(teachers)).toEqual([plus2.classId]);
    expect(teachers[0]!.mine).toBe(true);
    expect(teachers[0]!.markedToday).toBe(true);

    expect(ids(await list(plus2Coordinator))).toContain(plus2.classId);
    expect(ids(await list(plus2Coordinator))).not.toContain(bachelors.classId);
    expect(ids(await list(coordinator))).toEqual(expect.arrayContaining([plus2.classId, bachelors.classId]));
    expect(await list(otherTeacher)).toEqual([]);
  });

  it("a date outside the verified calendar, or not a date, is refused rather than guessed", async () => {
    expect((await roster(plus2, coordinator.cookie, "2099-01-01")).status).toBe(422);
    expect((await roster(plus2, coordinator.cookie, "yesterday")).status).toBe(400);
  });
});

describe("percentages", () => {
  it("the class summary gives each student's days, percentage and flag", async () => {
    const response = await call(`/api/attendance/classes/${plus2.classId}/summary`, { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { threshold: number; students: { enrollmentId: string; present: number; absent: number; percent: number | null; below: boolean }[] };
    expect(body.threshold).toBe(75);
    const second = body.students.find((s) => s.enrollmentId === plus2.pupils[1]!.enrollmentId)!;
    expect(second).toMatchObject({ present: 0, absent: 1, percent: 0, below: true });
    const third = body.students.find((s) => s.enrollmentId === plus2.pupils[2]!.enrollmentId)!;
    expect(third).toMatchObject({ present: 1, absent: 0, percent: 100, below: false });
  });

  it("a student sees their own year only, through /me", async () => {
    const absentee = plus2.pupils[1]!;
    const response = await call("/api/attendance/me", { cookie: absentee.person.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { present: number; absent: number; percent: number | null; below: boolean; absentDays: { date: string }[] };
    expect(body).toMatchObject({ present: 0, absent: 1, percent: 0, below: true });
    expect(body.absentDays.map((d) => d.date)).toEqual([today()]);

    const other = (await (await call("/api/attendance/me", { cookie: plus2.pupils[2]!.person.cookie })).json()) as { absent: number; percent: number };
    expect(other).toMatchObject({ absent: 0, percent: 100 });
  });

  it("Student A cannot reach Student B's attendance by any class or summary address", async () => {
    const a = plus2.pupils[0]!.person;
    expect((await call(`/api/attendance/classes/${plus2.classId}/summary`, { cookie: a.cookie })).status).toBe(404);
    expect((await call(`/api/attendance/classes/${bachelors.classId}/summary`, { cookie: a.cookie })).status).toBe(404);
  });

  it("a signed-in person with no enrollment this year gets 404 from /me, not someone else's record", async () => {
    const stranger = await person("student", "own");
    expect((await call("/api/attendance/me", { cookie: stranger.cookie })).status).toBe(404);
  });
});

describe("the database holds the rules even without the code", () => {
  it("a row for another day cannot be written, and a row is never deleted", async () => {
    const enrollment = (await db.prepare("SELECT id FROM enrollments WHERE public_id = ?1").bind(plus2.pupils[0]!.enrollmentId).first<{ id: number }>())!.id;
    await expect(
      db.prepare("INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at) VALUES (?1, '2026-01-01', 'present', 1, 'x', 'x')").bind(enrollment).run(),
    ).rejects.toThrow(/only be marked for today/);
    await expect(db.prepare("DELETE FROM student_attendance WHERE enrollment_id = ?1").bind(enrollment).run()).rejects.toThrow(/never deleted/);
  });
});

describe("switches and closed years", () => {
  it("a school that switched attendance off gets 404 from every attendance address", async () => {
    await setModule("attendance", false);
    try {
      expect((await mark(plus2, [])).status).toBe(404);
      expect((await roster(plus2, coordinator.cookie)).status).toBe(404);
      expect((await call("/api/attendance/classes", { cookie: coordinator.cookie })).status).toBe(404);
      expect((await call("/api/attendance/me", { cookie: plus2.pupils[0]!.person.cookie })).status).toBe(404);
    } finally {
      await setModule("attendance", true);
    }
  });

  it("a closed year rejects marking; nothing is written", async () => {
    // Last: this closes the one active year every fixture in this file uses.
    const before = await count("SELECT COUNT(*) AS n FROM audit_events");
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2027-04-13T00:00:00.000Z' WHERE status = 'active'").run();
    const response = await mark(plus2, []);
    expect(response.status).toBe(409);
    // And the database refuses it without the code's check: a direct write for today into the closed year.
    const enrollment = (await db.prepare("SELECT id FROM enrollments WHERE public_id = ?1").bind(plus2.pupils[0]!.enrollmentId).first<{ id: number }>())!.id;
    await expect(
      db
        .prepare("INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at) VALUES (?1, date('now', '+345 minutes', '+0 days'), 'present', 1, 'x', 'x') ON CONFLICT DO NOTHING")
        .bind(enrollment)
        .run(),
    ).rejects.toThrow(/academic year is closed/);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(before);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
