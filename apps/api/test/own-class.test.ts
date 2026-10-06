import { beforeAll, describe, expect, it } from "vitest";

import { newPublicId } from "../src/core/ids";
import { call, db, person, seedSections } from "./academics-helpers";
import { assign, classWith, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * A student sees their own class (FUT point 18): its wing, course, level and section, the term, the Class Teacher, and
 * every subject with who teaches it; an elective only if they take it, and a group they have not chosen from yet. Written
 * from the PM's request; only the student's own class, never another's.
 */
interface OwnClass {
  termLabel: string;
  wing: string;
  course: string;
  level: string;
  section: string;
  classTeacher: string | null;
  subjects: { name: string; teacher: string | null; elective: string | null }[];
  electivesToChoose: { group: string; options: string[] }[];
}

let fixture: ClassFixture;
const names: Record<string, string> = {};
const nameOf = async (publicId: string) => (await db.prepare("SELECT full_name FROM users WHERE public_id = ?1").bind(publicId).first<{ full_name: string }>())!.full_name;

beforeAll(async () => {
  await seedSections();
  fixture = await classWith("plus2", 2);
  await db.prepare("UPDATE classes SET label = 'A' WHERE public_id = ?1").bind(fixture.classId).run();
  // The compulsory subject has a teacher.
  const teacher = await teacherIn("plus2");
  await assign(teacher, fixture.classId, fixture.offeringId);
  names.teacher = await nameOf(teacher.publicId);
  names.classTeacher = await nameOf(fixture.classTeacher.publicId);
  // An elective group of two; the first pupil takes Biology.
  const group = newPublicId();
  await db.prepare("INSERT INTO elective_groups (public_id, level_id, name) SELECT ?1, id, 'Science option' FROM levels WHERE public_id = ?2").bind(group, fixture.levelId).run();
  for (const name of ["Biology", "Computer"]) {
    const subject = newPublicId();
    await db.prepare("INSERT INTO subjects (public_id, section_id, name) SELECT ?1, id, ?2 FROM sections WHERE key = 'plus2'").bind(subject, `${name} ${subject.slice(0, 6)}`).run();
    await db
      .prepare(
        `INSERT INTO subject_offerings (public_id, level_id, subject_id, elective_group_id)
         SELECT ?1, l.id, s.id, g.id FROM levels l, subjects s, elective_groups g WHERE l.public_id = ?2 AND s.public_id = ?3 AND g.public_id = ?4`,
      )
      .bind(newPublicId(), fixture.levelId, subject, group)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO elective_picks (enrollment_id, offering_id, updated_at)
       SELECT e.id, o.id, '2026-10-05T00:00:00Z' FROM enrollments e, subject_offerings o JOIN subjects s ON s.id = o.subject_id
        WHERE e.public_id = ?1 AND s.name LIKE 'Biology %' AND o.level_id = (SELECT id FROM levels WHERE public_id = ?2)`,
    )
    .bind(fixture.pupils[0]!.enrollmentId, fixture.levelId)
    .run();
});

const mine = async (cookie: string) => call("/api/students/me/class", { cookie });

describe("a student's own class (FUT point 18)", () => {
  it("names the class, its term and its Class Teacher, and every subject with who teaches it", async () => {
    const r = await mine(fixture.pupils[0]!.person.cookie);
    expect(r.status).toBe(200);
    const c = (await r.json()) as OwnClass;
    expect(c).toMatchObject({ wing: "+2", level: expect.stringMatching(/^Level /), section: "A", classTeacher: names.classTeacher });
    expect(c.termLabel.length).toBeGreaterThan(0);
    const compulsory = c.subjects.find((s) => s.elective === null)!;
    expect(compulsory.teacher).toBe(names.teacher);
    // The elective they take, with its group; not the one they did not choose.
    expect(c.subjects.filter((s) => s.elective !== null).map((s) => [s.name.split(" ")[0], s.elective])).toEqual([["Biology", "Science option"]]);
    expect(c.electivesToChoose).toEqual([]);
  });

  it("a group the student has not chosen from yet is listed with its choices, not as a subject", async () => {
    const c = (await (await mine(fixture.pupils[1]!.person.cookie)).json()) as OwnClass;
    expect(c.subjects.filter((s) => s.elective !== null)).toEqual([]);
    expect(c.electivesToChoose).toHaveLength(1);
    expect(c.electivesToChoose[0]!.group).toBe("Science option");
    expect(c.electivesToChoose[0]!.options.map((o) => o.split(" ")[0]).sort()).toEqual(["Biology", "Computer"]);
  });

  it("is only ever the student's own: a student with no class gets 404, staff have no class of their own, a teacher is refused", async () => {
    const loner = await person("student", "own");
    expect((await mine(loner.cookie)).status).toBe(404);
    expect((await mine((await person("coordinator", "institution")).cookie)).status).toBe(404);
    expect((await mine((await person("teacher", "assigned")).cookie)).status).toBe(403);
    expect((await call("/api/students/me/class")).status).toBe(401);
  });
});
