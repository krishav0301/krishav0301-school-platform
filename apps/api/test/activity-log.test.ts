import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { nepalDate } from "../src/core/dates";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { assign, classWith, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * The daily activity log (Phase 5, slice 3, D-071). Source 6.2: mandatory per class per day, visible to students and
 * parents, with a reminder if skipped. Written per subject by the subject's teacher (data model: ActivityLog on the
 * subject offering), editable the same day only.
 */

interface MyToday {
  date: string;
  subjects: { classId: string; offeringId: string; subjectName: string; className: string; body: string | null }[];
}
interface ClassDay {
  date: string;
  entries: { offeringId: string; subjectName: string; teacherName: string | null; body: string | null }[];
}

let plus2: ClassFixture, bachelors: ClassFixture;
let teacher: Person, otherTeacher: Person, coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person;
const today = () => nepalDate(new Date());

beforeAll(async () => {
  plus2 = await classWith("plus2", 2);
  bachelors = await classWith("bachelors", 1);
  teacher = await teacherIn("plus2");
  otherTeacher = await teacherIn("plus2");
  await assign(teacher, plus2.classId, plus2.offeringId);
  await assign(otherTeacher, bachelors.classId, bachelors.offeringId);
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
});

const write = (fixture: ClassFixture, body: string, who: Person = teacher) =>
  call(`/api/activity/classes/${fixture.classId}/subjects/${fixture.offeringId}/today`, { method: "PUT", cookie: who.cookie, body: { body } });
const classDay = (fixture: ClassFixture, who: Person) => call(`/api/activity/classes/${fixture.classId}`, { cookie: who.cookie });

describe("the teacher's day", () => {
  it("lists today's subjects the teacher teaches, each with no entry yet", async () => {
    const response = await call("/api/activity/mine", { cookie: teacher.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as MyToday;
    expect(body.date).toBe(today());
    expect(body.subjects.map((s) => s.offeringId)).toEqual([plus2.offeringId]);
    expect(body.subjects[0]!.body).toBeNull();
  });

  it("writes today's entry, with one audit entry, and may change it the same day", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'activity.written'");
    expect((await write(plus2, "Covered chapter 3: motion in one dimension.")).status).toBe(200);
    expect((await write(plus2, "Covered chapter 3 and set exercise 3.1.")).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM activity_log")).toBe(1);
    const body = (await (await call("/api/activity/mine", { cookie: teacher.cookie })).json()) as MyToday;
    expect(body.subjects[0]!.body).toBe("Covered chapter 3 and set exercise 3.1.");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'activity.written'")).toBe(before + 2);
  });

  it("refuses an empty or overlong entry", async () => {
    expect((await write(plus2, "   ")).status).toBe(400);
    expect((await write(plus2, "x".repeat(2001))).status).toBe(400);
  });

  it("only the subject's own teacher writes it: another teacher gets 404, other roles 403", async () => {
    expect((await write(plus2, "Not mine", otherTeacher)).status).toBe(404);
    expect((await write(bachelors, "Not mine either")).status).toBe(404);
    for (const who of [coordinator, admin, accountant, plus2.pupils[0]!.person]) expect((await write(plus2, "x", who)).status).toBe(403);
  });

  it("a teacher whose assignment has ended cannot write it any more", async () => {
    const fixture = await classWith("plus2", 1);
    const leaver = await teacherIn("plus2");
    await assign(leaver, fixture.classId, fixture.offeringId);
    await db.prepare("UPDATE teacher_assignments SET is_active = 0 WHERE teacher_user_id = (SELECT id FROM users WHERE public_id = ?1)").bind(leaver.publicId).run();
    expect((await write(fixture, "Too late", leaver)).status).toBe(404);
  });
});

describe("reading a class's day", () => {
  it("the Co-ordinator sees every subject of the class, written or missing, with its teacher", async () => {
    const response = await classDay(plus2, coordinator);
    expect(response.status).toBe(200);
    const day = (await response.json()) as ClassDay;
    const entry = day.entries.find((e) => e.offeringId === plus2.offeringId)!;
    expect(entry.body).toBe("Covered chapter 3 and set exercise 3.1.");
    expect(entry.teacherName).toBe("teacher person");
  });

  it("a section-scoped Co-ordinator reads only their section; the Admin reads; the Accountant cannot", async () => {
    expect((await classDay(plus2, plus2Coordinator)).status).toBe(200);
    expect((await classDay(plus2, bachelorsCoordinator)).status).toBe(404);
    expect((await classDay(plus2, admin)).status).toBe(200);
    expect((await classDay(plus2, accountant)).status).toBe(403);
  });

  it("a teacher reads a class they teach, not another", async () => {
    expect((await classDay(plus2, teacher)).status).toBe(200);
    expect((await classDay(bachelors, teacher)).status).toBe(404);
  });

  it("a student reads their own class's entries through /me, and no class by address", async () => {
    const pupil = plus2.pupils[0]!.person;
    const response = await call("/api/activity/me", { cookie: pupil.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { days: { date: string; entries: { subjectName: string; body: string }[] }[] };
    expect(body.days[0]!.date).toBe(today());
    expect(body.days[0]!.entries[0]!.body).toBe("Covered chapter 3 and set exercise 3.1.");
    expect((await classDay(plus2, pupil)).status).toBe(404);

    const outsider = bachelors.pupils[0]!.person;
    const theirs = (await (await call("/api/activity/me", { cookie: outsider.cookie })).json()) as { days: unknown[] };
    expect(theirs.days).toEqual([]);
  });
});

describe("a teacher's reach inside a class", () => {
  it("sees only their own subjects' entries in a class where others teach too", async () => {
    const fixture = await classWith("plus2", 1);
    const [a, b] = [await teacherIn("plus2"), await teacherIn("plus2")];
    await assign(a, fixture.classId, fixture.offeringId);
    const second = crypto.randomUUID().replace(/-/g, "");
    const subject = crypto.randomUUID().replace(/-/g, "");
    await db.prepare("INSERT INTO subjects (public_id, name) VALUES (?1, ?2)").bind(subject, `Second ${subject.slice(0, 6)}`).run();
    await db
      .prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id) SELECT ?1, l.id, s.id FROM levels l, subjects s WHERE l.public_id = ?2 AND s.public_id = ?3")
      .bind(second, fixture.levelId, subject)
      .run();
    await assign(b, fixture.classId, second);
    expect((await write(fixture, "A's entry", a)).status).toBe(200);

    const seenByB = (await (await classDay(fixture, b)).json()) as ClassDay;
    expect(seenByB.entries.map((e) => e.offeringId)).toEqual([second]);
    const seenByCoordinator = (await (await classDay(fixture, coordinator)).json()) as ClassDay;
    expect(seenByCoordinator.entries.map((e) => e.offeringId).sort()).toEqual([fixture.offeringId, second].sort());
  });
});

describe("the reminder: today's missing entries", () => {
  it("lists each class in reach with the subjects that have a teacher but no entry today", async () => {
    const response = await call("/api/activity/missing", { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { classes: { classId: string; missing: { subjectName: string; teacherName: string }[] }[] };
    expect(body.classes.map((c) => c.classId)).toContain(bachelors.classId);
    expect(body.classes.map((c) => c.classId)).not.toContain(plus2.classId); // written today

    const plus2Only = (await (await call("/api/activity/missing", { cookie: plus2Coordinator.cookie })).json()) as { classes: { classId: string }[] };
    expect(plus2Only.classes.map((c) => c.classId)).not.toContain(bachelors.classId);
  });

  it("the class list counts each class's written and expected subjects for today", async () => {
    const response = await call("/api/activity/classes", { cookie: coordinator.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { classes: { classId: string; expected: number; written: number }[] };
    expect(body.classes.find((c) => c.classId === plus2.classId)).toMatchObject({ expected: 1, written: 1 });
    expect(body.classes.find((c) => c.classId === bachelors.classId)).toMatchObject({ expected: 1, written: 0 });
    expect((await call("/api/activity/classes", { cookie: teacher.cookie })).status).toBe(403);
    expect((await call("/api/activity/classes", { cookie: plus2.pupils[0]!.person.cookie })).status).toBe(403);
  });

  it("a teacher sees their own unwritten subjects in /mine (body null), which is the reminder on their dashboard", async () => {
    const body = (await (await call("/api/activity/mine", { cookie: otherTeacher.cookie })).json()) as MyToday;
    expect(body.subjects.map((s) => s.body)).toEqual([null]);
  });
});

describe("the database holds the rules even without the code", () => {
  it("an entry for another day cannot be written, and nothing is deleted", async () => {
    const ids = await db
      .prepare("SELECT c.id AS class_id, o.id AS offering_id FROM classes c, subject_offerings o WHERE c.public_id = ?1 AND o.public_id = ?2")
      .bind(plus2.classId, plus2.offeringId)
      .first<{ class_id: number; offering_id: number }>();
    await expect(
      db
        .prepare("INSERT INTO activity_log (public_id, class_id, offering_id, on_date, teacher_user_id, body, created_at, updated_at) VALUES ('x', ?1, ?2, '2026-01-01', 1, 'b', 'x', 'x')")
        .bind(ids!.class_id, ids!.offering_id)
        .run(),
    ).rejects.toThrow(/only be written for today/);
    await expect(db.prepare("DELETE FROM activity_log").run()).rejects.toThrow(/never deleted/);
  });

  it("a closed year rejects writing", async () => {
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2027-04-13T00:00:00.000Z' WHERE status = 'active'").run();
    expect((await write(plus2, "After the year closed")).status).toBe(409);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
