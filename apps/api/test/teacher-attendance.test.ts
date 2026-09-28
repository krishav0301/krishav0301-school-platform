import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { adToBs, bsToAd, bsToText, nepalDate } from "../src/core/dates";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { activeYear, setModule, teacherIn } from "./schoolday-helpers";

/**
 * Teacher attendance (Phase 5, slice 2, D-070). CLAUDE.md section 6: marked by the Co-ordinator in a daily list
 * pre-filled Present; exceptions are Absent or On leave; past days are editable with a reason recorded. Source 6.2:
 * the teacher sees their own attendance as a read-only monthly view.
 */

interface Day {
  date: string;
  dateBs: string;
  isToday: boolean;
  marked: boolean;
  teachers: { id: string; name: string; status: "present" | "absent" | "leave" | null; reason: string | null }[];
}

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, superAdmin: Person, student: Person;
let plus2A: Person, plus2B: Person, bachelorsA: Person;
const today = () => nepalDate(new Date());
const daysAgo = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await activeYear();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  superAdmin = await person("super_admin", "institution");
  student = await person("student", "own");
  plus2A = await teacherIn("plus2");
  plus2B = await teacherIn("plus2");
  bachelorsA = await teacherIn("bachelors");
});

const save = (body: unknown, who: Person = coordinator) => call("/api/attendance/teachers/day", { method: "PUT", cookie: who.cookie, body });
const dayOf = async (who: Person, date?: string) => call(`/api/attendance/teachers/day${date ? `?date=${date}` : ""}`, { cookie: who.cookie });
const statusOf = (day: Day, teacher: Person) => day.teachers.find((t) => t.id === teacher.publicId)?.status;

describe("the Co-ordinator's daily list", () => {
  it("lists every active teacher in reach, not marked yet (the screen shows them as Present)", async () => {
    const response = await dayOf(coordinator);
    expect(response.status).toBe(200);
    const day = (await response.json()) as Day;
    expect(day.date).toBe(today());
    expect(day.isToday).toBe(true);
    const ids = day.teachers.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([plus2A.publicId, plus2B.publicId, bachelorsA.publicId]));
    expect(day.teachers.every((t) => t.status === null)).toBe(true);
  });

  it("saving today marks everyone Present except the exceptions, with one audit entry", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'attendance.teacher.marked'");
    const response = await save({ date: today(), exceptions: [{ teacherId: plus2B.publicId, status: "leave" }] });
    expect(response.status).toBe(200);
    const day = (await (await dayOf(coordinator)).json()) as Day;
    expect(day.marked).toBe(true);
    expect(statusOf(day, plus2A)).toBe("present");
    expect(statusOf(day, plus2B)).toBe("leave");
    expect(statusOf(day, bachelorsA)).toBe("present");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'attendance.teacher.marked'")).toBe(before + 1);
  });

  it("saving today again replaces the day; no reason is needed for today", async () => {
    expect((await save({ date: today(), exceptions: [{ teacherId: plus2A.publicId, status: "absent" }] })).status).toBe(200);
    const day = (await (await dayOf(coordinator)).json()) as Day;
    expect(statusOf(day, plus2A)).toBe("absent");
    expect(statusOf(day, plus2B)).toBe("present");
  });

  it("a past day needs a reason; with one it is saved, the reason is kept, and the audit entry has the before and after", async () => {
    const past = daysAgo(3);
    expect((await save({ date: past, exceptions: [] })).status).toBe(422);
    expect((await save({ date: past, exceptions: [], reason: "  " })).status).toBe(422);

    expect((await save({ date: past, exceptions: [{ teacherId: bachelorsA.publicId, status: "absent" }], reason: "Register left at home" })).status).toBe(200);
    expect((await save({ date: past, exceptions: [], reason: "Absence was a mistake" })).status).toBe(200);
    const day = (await (await dayOf(coordinator, past)).json()) as Day;
    expect(day.isToday).toBe(false);
    expect(statusOf(day, bachelorsA)).toBe("present");
    expect(day.teachers.find((t) => t.id === bachelorsA.publicId)!.reason).toBe("Absence was a mistake");

    const entry = await db
      .prepare("SELECT before_json, after_json, reason FROM audit_events WHERE action = 'attendance.teacher.marked' ORDER BY id DESC LIMIT 1")
      .first<{ before_json: string; after_json: string; reason: string }>();
    expect(entry!.reason).toBe("Absence was a mistake");
    expect(JSON.parse(entry!.before_json)).toMatchObject({ date: past, absent: [bachelorsA.publicId] });
    expect(JSON.parse(entry!.after_json)).toMatchObject({ date: past, absent: [], leave: [] });
  });

  it("refuses a future day, a day outside the verified calendar, and a teacher out of reach", async () => {
    expect((await save({ date: daysAgo(-1), exceptions: [] })).status).toBe(422);
    expect((await save({ date: "2099-01-01", exceptions: [], reason: "x reason" })).status).toBe(422);
    const stranger = await person("student", "own");
    expect((await save({ date: today(), exceptions: [{ teacherId: stranger.publicId, status: "absent" }] })).status).toBe(422);
    expect((await save({ date: today(), exceptions: [{ teacherId: bachelorsA.publicId, status: "absent" }] }, plus2Coordinator)).status).toBe(422);
  });
});

describe("scope", () => {
  it("a section-scoped Co-ordinator sees and saves only their own section's teachers", async () => {
    const day = (await (await dayOf(plus2Coordinator)).json()) as Day;
    const ids = day.teachers.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([plus2A.publicId, plus2B.publicId]));
    expect(ids).not.toContain(bachelorsA.publicId);

    // The bachelors teacher's mark is untouched by a plus2 Co-ordinator's save.
    await save({ date: today(), exceptions: [{ teacherId: bachelorsA.publicId, status: "leave" }] }, bachelorsCoordinator);
    expect((await save({ date: today(), exceptions: [] }, plus2Coordinator)).status).toBe(200);
    const after = (await (await dayOf(coordinator)).json()) as Day;
    expect(statusOf(after, bachelorsA)).toBe("leave");
    expect(statusOf(after, plus2A)).toBe("present");
  });

  it("only the Co-ordinator and the Super Admin mark; the Admin may look but not save", async () => {
    expect((await dayOf(admin)).status).toBe(200);
    for (const who of [admin, accountant, student, plus2A]) expect((await save({ date: today(), exceptions: [] }, who)).status).toBe(403);
    expect((await save({ date: today(), exceptions: [] }, superAdmin)).status).toBe(200);
  });

  it("a teacher cannot see the daily list, only their own month", async () => {
    expect((await dayOf(plus2A)).status).toBe(403);
    expect((await dayOf(accountant)).status).toBe(403);
  });

  it("a Co-ordinator deactivated since signing in cannot save", async () => {
    const gone = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(gone.publicId).run();
    expect((await save({ date: today(), exceptions: [] }, gone)).status).toBe(404);
  });
});

describe("the teacher's own month", () => {
  it("shows each day of the BS month with its mark, read-only, and counts", async () => {
    const bs = adToBs(today());
    const month = `${bs.year}-${String(bs.month).padStart(2, "0")}`;
    const response = await call(`/api/attendance/teachers/me?month=${month}`, { cookie: plus2A.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { month: string; days: { date: string; dateBs: string; status: string | null }[]; present: number; absent: number; leave: number };
    expect(body.month).toBe(month);
    expect(body.days[0]!.dateBs).toBe(bsToText({ year: bs.year, month: bs.month, day: 1 }));
    expect(body.days[0]!.date).toBe(bsToAd({ year: bs.year, month: bs.month, day: 1 }));
    const todayRow = body.days.find((d) => d.date === today())!;
    expect(todayRow.status).toBe("present");
    expect(body.present).toBeGreaterThanOrEqual(1);
  });

  it("defaults to this month, refuses an unverified year, and has no write", async () => {
    expect((await call("/api/attendance/teachers/me", { cookie: plus2A.cookie })).status).toBe(200);
    expect((await call("/api/attendance/teachers/me?month=2099-01", { cookie: plus2A.cookie })).status).toBe(422);
    expect((await call("/api/attendance/teachers/me?month=2083-13", { cookie: plus2A.cookie })).status).toBe(400);
  });

  it("a student gets nothing from it", async () => {
    expect((await call("/api/attendance/teachers/me", { cookie: student.cookie })).status).toBe(403);
  });
});

describe("the database holds the rules even without the code", () => {
  it("a past day cannot be written without a reason, a future day not at all, and nothing is deleted", async () => {
    const userId = (await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(plus2A.publicId).first<{ id: number }>())!.id;
    const insert = (date: string, reason: string | null) =>
      db
        .prepare("INSERT INTO teacher_attendance (user_id, on_date, status, reason, marked_by_user_id, marked_at, updated_at) VALUES (?1, ?2, 'present', ?3, ?1, 'x', 'x')")
        .bind(userId, date, reason)
        .run();
    await expect(insert(daysAgo(10), null)).rejects.toThrow(/reason/);
    await expect(insert(daysAgo(-2), "a reason")).rejects.toThrow(/future/);
    await expect(db.prepare("DELETE FROM teacher_attendance WHERE user_id = ?1").bind(userId).run()).rejects.toThrow(/never deleted/);
  });
});

describe("switches and closed years", () => {
  it("a school that switched teacher attendance off gets 404", async () => {
    await setModule("teacher_attendance", false);
    try {
      expect((await dayOf(coordinator)).status).toBe(404);
      expect((await save({ date: today(), exceptions: [] })).status).toBe(404);
      expect((await call("/api/attendance/teachers/me", { cookie: plus2A.cookie })).status).toBe(404);
    } finally {
      await setModule("teacher_attendance", true);
    }
  });

  it("a day inside a closed year cannot be changed", async () => {
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2027-04-13T00:00:00.000Z' WHERE status = 'active'").run();
    expect((await save({ date: daysAgo(3), exceptions: [], reason: "Late correction" })).status).toBe(409);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
