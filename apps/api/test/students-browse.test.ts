import { beforeAll, describe, expect, it } from "vitest";

import { newPublicId } from "../src/core/ids";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { activeYear, classWith, enrol, type ClassFixture } from "./schoolday-helpers";

/**
 * The Students page (PM's bug report, 2026-10-06): every student is listed straight away, narrowed by wing, course,
 * level and class, where each list offers only what has students; a search box, a status and a term on top; paged.
 * Written from the PM's rules, not from the query: open terms and active students by default; a class, level, course or
 * wing with no students is not offered; a student with no class yet is listed but in no class; a wing's Co-ordinator
 * sees only their wing; a teacher or a student is refused.
 */
interface Browse {
  students: { id: string; sid: string; lastName: string; status: string; guardianPhone: string; class: { id: string; label: string; levelName: string; courseName: string; wingName: string } | null; term: { id: string; label: string } | null }[];
  total: number;
  page: number;
  pageSize: number;
  counts: { active: number; leftOrGraduated: number };
  wings: { key: string; name: string; count: number; courses: { id: string; name: string; count: number; levels: { id: string; name: string; count: number; classes: { id: string; label: string; count: number }[] }[] }[] }[];
  terms: { id: string; label: string; open: boolean }[];
}

let plus2: ClassFixture, plus2b: ClassFixture, bachelors: ClassFixture, empty: ClassFixture, old: ClassFixture;
let principal: Person, coordinator: Person, plus2Coordinator: Person, accountant: Person, student: Person;
let leftId: string, unplacedId: string, unplacedSid: string, closedTermId: string, openTermId: string;

const programmeOf = async (levelId: string) =>
  (await db.prepare("SELECT p.public_id AS id FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE l.public_id = ?1").bind(levelId).first<{ id: string }>())!.id;

beforeAll(async () => {
  await seedSections();
  openTermId = await activeYear();
  plus2 = await classWith("plus2", 3);
  plus2b = await classWith("plus2", 1);
  bachelors = await classWith("bachelors", 2);
  empty = await classWith("bachelors", 0); // a course whose only class has nobody in it

  // A student who left (from the +2 class), and one registered but not yet placed in any class.
  const leaver = await enrol(plus2.classId, "Leaver");
  leftId = leaver.studentId;
  await db.prepare("UPDATE students SET status = 'left' WHERE public_id = ?1").bind(leftId).run();
  unplacedId = newPublicId();
  unplacedSid = `2083-9${Math.random().toString().slice(2, 6)}`;
  await db
    .prepare(
      `INSERT INTO students (public_id, sid, first_name, last_name, dob_ad, guardian_name, guardian_phone, admission_bs_year, created_at)
       VALUES (?1, ?2, 'Gita', 'Unplaced', '2008-01-01', 'Guardian', '9811111111', 2083, '2026-09-22T00:00:00.000Z')`,
    )
    .bind(unplacedId, unplacedSid)
    .run();

  // A second term, closed, with one class of one student (made while the term was open, then closed).
  closedTermId = newPublicId();
  await db
    .prepare(`INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at) VALUES (?1, 2082, 'T2082', 'Term 2082', '2025-04-14', '2026-04-13', 'active', '2025-04-14T00:00:00.000Z')`)
    .bind(closedTermId)
    .run();
  old = await classWith("plus2", 1, { yearId: closedTermId });
  await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-04-13T00:00:00.000Z' WHERE public_id = ?1").bind(closedTermId).run();

  principal = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  accountant = await person("accountant", "institution");
  student = plus2.pupils[0]!.person;
});

const browse = async (who: Person, query: Record<string, string | number> = {}) => {
  const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const response = await call(`/api/students/browse${params.size ? `?${params}` : ""}`, { cookie: who.cookie });
  expect(response.status).toBe(200);
  return (await response.json()) as Browse;
};
const ids = (b: Browse) => b.students.map((s) => s.id);
const pupilIds = (...fixtures: ClassFixture[]) => fixtures.flatMap((f) => f.pupils.map((p) => p.studentId));

describe("the default list: active students of the open terms", () => {
  it("lists every active student in an open term, and a student with no class yet, without typing anything", async () => {
    const all = await browse(principal, { pageSize: 50 });
    expect(new Set(ids(all))).toEqual(new Set([...pupilIds(plus2, plus2b, bachelors), unplacedId]));
    expect(all.total).toBe(7);
    const unplaced = all.students.find((s) => s.id === unplacedId)!;
    expect(unplaced.class).toBeNull();
    expect(unplaced.term).toBeNull();
    const placed = all.students.find((s) => s.id === bachelors.pupils[0]!.studentId)!;
    expect(placed.class).toMatchObject({ id: bachelors.classId, levelName: expect.stringMatching(/^Level /), courseName: expect.stringMatching(/^Programme /), wingName: expect.any(String) });
    expect(placed.term?.id).toBe(openTermId);
    expect(placed.guardianPhone).toBe("9800000001");
  });

  it("puts the students in a class first and the ones with no class last", async () => {
    const all = await browse(principal, { pageSize: 50 });
    expect(all.students.at(-1)!.id).toBe(unplacedId);
  });

  it("pages ten at a time by default, and a page past the end is empty with the same total", async () => {
    const first = await browse(principal, { pageSize: 3 });
    expect(first).toMatchObject({ total: 7, page: 1, pageSize: 3 });
    expect(first.students).toHaveLength(3);
    const third = await browse(principal, { pageSize: 3, page: 3 });
    expect(third.students).toHaveLength(1);
    const seen = new Set([...ids(first), ...ids(await browse(principal, { pageSize: 3, page: 2 })), ...ids(third)]);
    expect(seen.size).toBe(7);
    expect((await browse(principal)).pageSize).toBe(10);
  });

  it("counts active students and those who left or graduated (the PM: no separate open-term count)", async () => {
    const { counts } = await browse(principal);
    // Active: the six in open-term classes, the unplaced one and the one in the closed term.
    expect(counts).toEqual({ active: 8, leftOrGraduated: 1 });
  });
});

describe("the wing, course, level and class lists offer only what has students", () => {
  it("leaves out a course whose classes are empty, and the student with no class", async () => {
    const { wings } = await browse(principal);
    const courseIds = wings.flatMap((w) => w.courses.map((c) => c.id));
    expect(courseIds).not.toContain(await programmeOf(empty.levelId));
    expect(courseIds).toContain(await programmeOf(bachelors.levelId));
    const classIds = wings.flatMap((w) => w.courses.flatMap((c) => c.levels.flatMap((l) => l.classes.map((k) => k.id))));
    expect(new Set(classIds)).toEqual(new Set([plus2.classId, plus2b.classId, bachelors.classId]));
  });

  it("counts each wing, course, level and class", async () => {
    const { wings } = await browse(principal);
    const plus2Wing = wings.find((w) => w.key === "plus2")!;
    expect(plus2Wing.count).toBe(4);
    expect(wings.find((w) => w.key === "bachelors")!.count).toBe(2);
    const course = plus2Wing.courses.find((c) => c.levels.some((l) => l.id === plus2.levelId))!;
    expect(course.count).toBe(3);
    expect(course.levels[0]!.classes[0]).toMatchObject({ id: plus2.classId, count: 3 });
  });

  it("leaves out a wing with no students at all", async () => {
    const { wings } = await browse(principal, { status: "left" });
    expect(wings.map((w) => w.key)).toEqual(["plus2"]);
  });
});

describe("filters", () => {
  it("narrows to a wing, a course, a level and a class", async () => {
    expect(new Set(ids(await browse(principal, { wing: "bachelors" })))).toEqual(new Set(pupilIds(bachelors)));
    expect(new Set(ids(await browse(principal, { course: await programmeOf(plus2.levelId) })))).toEqual(new Set(pupilIds(plus2)));
    expect(new Set(ids(await browse(principal, { level: plus2b.levelId })))).toEqual(new Set(pupilIds(plus2b)));
    expect(new Set(ids(await browse(principal, { class: plus2.classId })))).toEqual(new Set(pupilIds(plus2)));
  });

  it("searches by name, SID or phone, with the other filters still applied", async () => {
    expect(ids(await browse(principal, { q: "Unplaced" }))).toEqual([unplacedId]);
    expect(ids(await browse(principal, { q: unplacedSid }))).toEqual([unplacedId]);
    expect(ids(await browse(principal, { q: "9811111111" }))).toEqual([unplacedId]);
    expect(ids(await browse(principal, { q: "Unplaced", wing: "plus2" }))).toEqual([]);
    expect(ids(await browse(principal, { q: "%" }))).toEqual([]); // a wildcard typed is a plain character
  });

  it("shows students who left when asked, and everyone with All", async () => {
    expect(ids(await browse(principal, { status: "left" }))).toEqual([leftId]);
    expect((await browse(principal, { status: "graduated" })).total).toBe(0);
    expect((await browse(principal, { status: "all", pageSize: 50 })).total).toBe(8);
  });

  it("shows a closed term's students for that term, and lists the terms that have students", async () => {
    const closed = await browse(principal, { term: closedTermId });
    expect(ids(closed)).toEqual(pupilIds(old));
    expect(closed.students[0]!.term).toEqual({ id: closedTermId, label: "Term 2082" });
    expect(closed.terms).toEqual(
      expect.arrayContaining([
        { id: openTermId, label: "2083", open: true },
        { id: closedTermId, label: "Term 2082", open: false },
      ]),
    );
  });

  it("refuses a malformed filter", async () => {
    for (const bad of ["status=gone", "class=nope", "term=x", "wing=No%20Such", "page=0", "pageSize=500"]) {
      expect((await call(`/api/students/browse?${bad}`, { cookie: principal.cookie })).status).toBe(400);
    }
  });
});

describe("who sees what", () => {
  it("a whole-school Co-ordinator and the Accountant see the whole school, as the Principal does", async () => {
    for (const who of [coordinator, accountant]) expect((await browse(who, { pageSize: 50 })).total).toBe(7);
  });

  it("a +2 Co-ordinator gets nothing from Bachelor's: not its students, its wing or its counts", async () => {
    const mine = await browse(plus2Coordinator, { pageSize: 50 });
    expect(ids(mine)).not.toEqual(expect.arrayContaining(pupilIds(bachelors)));
    expect(new Set(ids(mine))).toEqual(new Set([...pupilIds(plus2, plus2b), unplacedId]));
    expect(mine.wings.map((w) => w.key)).toEqual(["plus2"]);
    expect(ids(await browse(plus2Coordinator, { wing: "bachelors" }))).toEqual([]);
    expect(ids(await browse(plus2Coordinator, { class: bachelors.classId }))).toEqual([]);
    expect(mine.counts.active).toBe(6); // its four, the unplaced one, and the closed term's +2 student
  });

  it("a teacher and a student are refused, and nobody signed out gets in", async () => {
    expect((await call("/api/students/browse", { cookie: plus2.classTeacher.cookie })).status).toBe(403);
    expect((await call("/api/students/browse", { cookie: student.cookie })).status).toBe(403);
    expect((await call("/api/students/browse")).status).toBe(401);
  });
});

describe("a draft term", () => {
  it("counts as open, as on the class page: its students are listed by default", async () => {
    const draftId = newPublicId();
    await db
      .prepare(`INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at) VALUES (?1, 2084, 'D2084', 'Term 2084', '2027-04-14', '2028-04-13', 'draft', '2026-10-01T00:00:00.000Z')`)
      .bind(draftId)
      .run();
    const draft = await classWith("bachelors", 1, { yearId: draftId });
    const all = await browse(principal, { pageSize: 50 });
    expect(ids(all)).toEqual(expect.arrayContaining(pupilIds(draft)));
    expect(all.terms).toContainEqual({ id: draftId, label: "Term 2084", open: true });
  });
});

describe("a student's record says where they are", () => {
  it("gives the wing, course, level, the class's section and the term apart, not run together", async () => {
    const pupil = plus2.pupils[0]!.studentId;
    await db.prepare("UPDATE classes SET label = 'Evening' WHERE public_id = ?1").bind(plus2.classId).run();
    const record = (await (await call(`/api/students/${pupil}`, { cookie: principal.cookie })).json()) as { place: Record<string, string> | null };
    expect(record.place).toEqual({ wing: "+2", course: expect.stringMatching(/^Programme /), level: expect.stringMatching(/^Level /), section: "Evening", term: "2083" });
  });

  it("has no place for a student in no class", async () => {
    const record = (await (await call(`/api/students/${unplacedId}`, { cookie: principal.cookie })).json()) as { place: unknown };
    expect(record.place).toBeNull();
  });
});
