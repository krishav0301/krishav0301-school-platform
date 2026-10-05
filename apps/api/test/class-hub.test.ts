import { beforeAll, describe, expect, it } from "vitest";

import { newPublicId } from "../src/core/ids";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { assign, classWith, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * A class as one page (FUT point 19), written from the PM's rules: the Principal and the Co-ordinator open every class
 * (a wing's Co-ordinator only their wing's); a teacher opens every class they teach a subject in, and their own class as
 * its Class Teacher. A subject teacher sees the students by name, only their own subjects, and no attendance; the Class
 * Teacher, the Co-ordinator and the Principal see everything of the class.
 */
interface Hub {
  class: { id: string; wing: string; section: string; classTeacher: string | null; students: number };
  viewer: { seesAll: boolean; attendance: boolean; staff: boolean };
  subjects: { offeringId: string; name: string }[];
  mySubjects: { offeringId: string; name: string }[];
  taughtSubjects: { offeringId: string; name: string }[];
  terminals: { id: string; name: string; published: boolean }[];
  students: { enrollmentId: string; rollNo: number | null; name: string; sid: string | null; studentId: string | null }[];
}

let plus2: ClassFixture, bachelors: ClassFixture;
let subjectTeacher: Person, stranger: Person, coordinator: Person, plus2Coordinator: Person, principal: Person, student: Person;
let secondOffering: string;

beforeAll(async () => {
  await seedSections();
  plus2 = await classWith("plus2", 2);
  bachelors = await classWith("bachelors", 1);
  // A second subject in the +2 class, taught by someone who is not its Class Teacher.
  const subject = newPublicId();
  await db.prepare("INSERT INTO subjects (public_id, section_id, name) SELECT ?1, id, ?2 FROM sections WHERE key = 'plus2'").bind(subject, `Chemistry ${subject.slice(0, 6)}`).run();
  secondOffering = newPublicId();
  await db.prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id) SELECT ?1, l.id, s.id FROM levels l, subjects s WHERE l.public_id = ?2 AND s.public_id = ?3").bind(secondOffering, plus2.levelId, subject).run();
  subjectTeacher = await teacherIn("plus2");
  await assign(subjectTeacher, plus2.classId, secondOffering);
  stranger = await teacherIn("plus2");
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  principal = await person("admin", "institution");
  student = plus2.pupils[0]!.person;
});

const list = async (who: Person) => ((await (await call("/api/classes", { cookie: who.cookie })).json()) as { classes: { id: string }[] }).classes.map((c) => c.id);
const open = (who: Person, id: string) => call(`/api/classes/${id}`, { cookie: who.cookie });

describe("which classes a person opens (FUT point 19)", () => {
  it("the Principal and a whole-school Co-ordinator list every class; a wing's Co-ordinator only their wing's", async () => {
    for (const who of [principal, coordinator]) expect(await list(who)).toEqual(expect.arrayContaining([plus2.classId, bachelors.classId]));
    const mine = await list(plus2Coordinator);
    expect(mine).toContain(plus2.classId);
    expect(mine).not.toContain(bachelors.classId);
  });

  it("a teacher lists the classes they teach and the class they lead, and nothing else", async () => {
    expect(await list(subjectTeacher)).toEqual([plus2.classId]);
    expect(await list(plus2.classTeacher)).toEqual([plus2.classId]);
    expect(await list(stranger)).toEqual([]);
  });

  it("a class outside a person's reach is 404, the same as a missing one; a student is refused", async () => {
    expect((await open(stranger, plus2.classId)).status).toBe(404);
    expect((await open(plus2Coordinator, bachelors.classId)).status).toBe(404);
    expect((await open(coordinator, "0".repeat(32))).status).toBe(404);
    expect((await open(student, plus2.classId)).status).toBe(403);
    expect((await call("/api/classes", { cookie: student.cookie })).status).toBe(403);
  });
});

describe("what each person sees inside a class", () => {
  it("the Class Teacher sees every subject, the attendance, and each student's SID", async () => {
    const hub = (await (await open(plus2.classTeacher, plus2.classId)).json()) as Hub;
    expect(hub.viewer).toMatchObject({ seesAll: true, attendance: true });
    expect(hub.subjects).toHaveLength(2);
    expect(hub.mySubjects).toHaveLength(2);
    // Classwork stays a teacher's own subjects (the PM): this Class Teacher teaches none here.
    expect(hub.taughtSubjects).toEqual([]);
    expect(hub.viewer.staff).toBe(false);
    expect(hub.class.students).toBe(2);
    expect(hub.students.every((s) => s.sid !== null && s.studentId !== null)).toBe(true);
  });

  it("a subject teacher sees the students by name only, their own subject only, and no attendance", async () => {
    const hub = (await (await open(subjectTeacher, plus2.classId)).json()) as Hub;
    expect(hub.viewer).toMatchObject({ seesAll: false, attendance: false });
    expect(hub.mySubjects.map((s) => s.offeringId)).toEqual([secondOffering]);
    expect(hub.taughtSubjects.map((s) => s.offeringId)).toEqual([secondOffering]);
    expect(hub.students).toHaveLength(2);
    expect(hub.students.every((s) => s.sid === null && s.studentId === null && s.name.length > 0)).toBe(true);
  });

  it("the Principal and the Co-ordinator see everything of the class", async () => {
    for (const who of [principal, coordinator]) {
      const hub = (await (await open(who, plus2.classId)).json()) as Hub;
      expect(hub.viewer).toMatchObject({ seesAll: true, attendance: true });
      expect(hub.mySubjects).toHaveLength(2);
      expect(hub.viewer.staff).toBe(true);
    }
  });
});

describe("the whole-class result sheet (FUT point 19: published only)", () => {
  it("a Class Teacher reads their own class's published sheet; not another class's, and a subject teacher not at all", async () => {
    // One published terminal for each class (a sheet with no cards yet still answers).
    const terminal = newPublicId();
    await db
      .prepare(
        `INSERT INTO terminals (public_id, academic_year_id, name, ordinal)
         SELECT ?1, c.academic_year_id, 'Final', COALESCE((SELECT MAX(ordinal) FROM terminals t WHERE t.academic_year_id = c.academic_year_id), 0) + 1
           FROM classes c WHERE c.public_id = ?2`,
      )
      .bind(terminal, plus2.classId)
      .run();
    for (const cls of [plus2.classId, bachelors.classId]) {
      await db
        .prepare(
          `INSERT INTO result_publications (public_id, class_id, terminal_id, grading_policy, published_by_user_id, published_at)
           SELECT ?1, c.id, t.id, 'percentage_division', u.id, '2026-10-05T00:00:00Z' FROM classes c, terminals t, users u
            WHERE c.public_id = ?2 AND t.public_id = ?3 AND u.public_id = ?4`,
        )
        .bind(newPublicId(), cls, terminal, coordinator.publicId)
        .run();
    }
    const sheet = (who: Person, classId: string) => call(`/api/results/classes/${classId}/terminals/${terminal}/sheet`, { cookie: who.cookie });
    expect((await sheet(plus2.classTeacher, plus2.classId)).status).toBe(200);
    expect((await sheet(plus2.classTeacher, bachelors.classId)).status).toBe(404);
    expect((await sheet(subjectTeacher, plus2.classId)).status).toBe(404);
    expect((await sheet(coordinator, bachelors.classId)).status).toBe(200);
    expect((await sheet(student, plus2.classId)).status).toBe(403);
  });
});

