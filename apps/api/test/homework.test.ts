import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { assign, classWith, setModule, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * Homework and assignments (Phase 5, slice 4, D-072). Source 6.2: deadline, instructions, optional attached file
 * (a link while R2 is off); late is flagged automatically; the teacher reviews, gives marks and feedback;
 * resubmission is request-then-approve. The Student submits their own (matrix: `assignments.submit`, own).
 */

interface StudentList {
  assignments: {
    id: string;
    title: string;
    dueAt: string;
    maxMarks: number | null;
    submission: { status: string; isLate: boolean; marks: number | null; feedback: string | null; body: string } | null;
  }[];
}
interface Detail {
  id: string;
  students: { enrollmentId: string; name: string; submission: { id: string; status: string; isLate: boolean; body: string; marks: number | null; resubmitReason: string | null } | null }[];
}

let plus2: ClassFixture, bachelors: ClassFixture;
let teacher: Person, stranger: Person, coordinator: Person;
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

beforeAll(async () => {
  plus2 = await classWith("plus2", 3);
  bachelors = await classWith("bachelors", 1);
  teacher = await teacherIn("plus2");
  stranger = await teacherIn("plus2");
  await assign(teacher, plus2.classId, plus2.offeringId);
  coordinator = await person("coordinator", "institution");
});

const setWork = (body: Record<string, unknown> = {}, who: Person = teacher) =>
  call("/api/assignments", {
    method: "POST",
    cookie: who.cookie,
    body: { classId: plus2.classId, offeringId: plus2.offeringId, title: "Exercise 3.1", instructions: "Solve questions 1 to 10.", dueAt: hoursFromNow(48), maxMarks: 10, ...body },
  });
const submit = (id: string, pupil: Person, body = "My answers: 1) 4 m/s ...") => call(`/api/assignments/${id}/submission`, { method: "PUT", cookie: pupil.cookie, body: { body } });
const detail = async (id: string, who: Person = teacher) => call(`/api/assignments/${id}`, { cookie: who.cookie });
const mineAsStudent = async (pupil: Person) => ((await (await call("/api/assignments/me", { cookie: pupil.cookie })).json()) as StudentList).assignments;

describe("setting work", () => {
  it("the subject's teacher sets an assignment with a deadline, with an audit entry", async () => {
    const response = await setWork();
    expect(response.status).toBe(201);
    const list = (await (await call("/api/assignments/mine", { cookie: teacher.cookie })).json()) as { assignments: { id: string; submitted: number; students: number }[] };
    const id = ((await response.json()) as { id: string }).id;
    expect(list.assignments.find((a) => a.id === id)).toMatchObject({ submitted: 0, students: 3 });
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'assignments.set' AND entity_public_id = ?1", id)).toBe(1);
  });

  it("refuses a deadline in the past, a bad link, and a stranger", async () => {
    expect((await setWork({ dueAt: hoursFromNow(-1) })).status).toBe(422);
    expect((await setWork({ link: "ftp://x" })).status).toBe(400);
    expect((await setWork({}, stranger)).status).toBe(404);
    for (const who of [coordinator, plus2.pupils[0]!.person]) expect((await setWork({}, who)).status).toBe(403);
  });
});

describe("submitting and reviewing", () => {
  let id: string;
  beforeAll(async () => {
    id = ((await (await setWork({ title: "Lab report" })).json()) as { id: string }).id;
  });

  it("a student of the class sees it and submits once, on time", async () => {
    const pupil = plus2.pupils[0]!.person;
    expect((await mineAsStudent(pupil)).find((a) => a.id === id)!.submission).toBeNull();
    expect((await submit(id, pupil)).status).toBe(200);
    const mine = (await mineAsStudent(pupil)).find((a) => a.id === id)!;
    expect(mine.submission).toMatchObject({ status: "submitted", isLate: false });
    expect((await submit(id, pupil, "Second try")).status).toBe(409);
  });

  it("the teacher sees every student, submitted or not, and reviews with marks and feedback", async () => {
    const body = (await (await detail(id)).json()) as Detail;
    expect(body.students).toHaveLength(3);
    const done = body.students.find((s) => s.submission !== null)!;
    const review = await call(`/api/assignments/${id}/submissions/${done.submission!.id}/review`, { method: "POST", cookie: teacher.cookie, body: { marks: 8, feedback: "Good work; check question 7." } });
    expect(review.status).toBe(200);
    const seen = (await mineAsStudent(plus2.pupils[0]!.person)).find((a) => a.id === id)!;
    expect(seen.submission).toMatchObject({ status: "reviewed", marks: 8, feedback: "Good work; check question 7." });
  });

  it("a teacher who does not teach the subject cannot review, decide or withdraw it", async () => {
    const body = (await (await detail(id)).json()) as Detail;
    const done = body.students.find((s) => s.submission !== null)!;
    expect((await call(`/api/assignments/${id}/submissions/${done.submission!.id}/review`, { method: "POST", cookie: stranger.cookie, body: { marks: 1 } })).status).toBe(404);
    expect((await call(`/api/assignments/${id}/submissions/${done.submission!.id}/resubmission`, { method: "POST", cookie: stranger.cookie, body: { allow: true } })).status).toBe(404);
    expect((await call(`/api/assignments/${id}/withdraw`, { method: "POST", cookie: stranger.cookie })).status).toBe(404);
  });

  it("marks cannot exceed the maximum", async () => {
    const body = (await (await detail(id)).json()) as Detail;
    const done = body.students.find((s) => s.submission !== null)!;
    expect((await call(`/api/assignments/${id}/submissions/${done.submission!.id}/review`, { method: "POST", cookie: teacher.cookie, body: { marks: 11 } })).status).toBe(422);
  });

  it("resubmission is request, then approve, then a new submission replaces the text and clears the marks", async () => {
    const pupil = plus2.pupils[0]!.person;
    expect((await call(`/api/assignments/${id}/submission/resubmit-request`, { method: "POST", cookie: pupil.cookie, body: { reason: "I attached the wrong answers." } })).status).toBe(200);
    expect((await submit(id, pupil, "Too early")).status).toBe(409);

    const body = (await (await detail(id)).json()) as Detail;
    const row = body.students.find((s) => s.submission !== null)!;
    expect(row.submission).toMatchObject({ status: "resubmit_requested", resubmitReason: "I attached the wrong answers." });
    expect((await call(`/api/assignments/${id}/submissions/${row.submission!.id}/resubmission`, { method: "POST", cookie: teacher.cookie, body: { allow: true } })).status).toBe(200);

    expect((await submit(id, pupil, "Corrected answers")).status).toBe(200);
    const seen = (await mineAsStudent(pupil)).find((a) => a.id === id)!;
    expect(seen.submission).toMatchObject({ status: "submitted", body: "Corrected answers", marks: null, feedback: null });

    // The earlier text is kept in the audit trail, not lost.
    const entry = await db.prepare("SELECT before_json FROM audit_events WHERE action = 'assignments.resubmitted' ORDER BY id DESC LIMIT 1").first<{ before_json: string }>();
    expect(JSON.parse(entry!.before_json)).toMatchObject({ body: "My answers: 1) 4 m/s ..." });
  });

  it("a declined request goes back to how it was", async () => {
    const pupil = plus2.pupils[1]!.person;
    expect((await submit(id, pupil)).status).toBe(200);
    expect((await call(`/api/assignments/${id}/submission/resubmit-request`, { method: "POST", cookie: pupil.cookie, body: { reason: "Typo" } })).status).toBe(200);
    const row = ((await (await detail(id)).json()) as Detail).students.find((s) => s.submission?.status === "resubmit_requested")!;
    expect((await call(`/api/assignments/${id}/submissions/${row.submission!.id}/resubmission`, { method: "POST", cookie: teacher.cookie, body: { allow: false } })).status).toBe(200);
    expect((await mineAsStudent(pupil)).find((a) => a.id === id)!.submission!.status).toBe("submitted");
  });

  it("a submission after the deadline is flagged late automatically", async () => {
    const late = crypto.randomUUID().replace(/-/g, "");
    await db
      .prepare(
        `INSERT INTO assignments (public_id, class_id, offering_id, title, instructions, due_at, teacher_user_id, created_at)
         SELECT ?1, c.id, o.id, 'Overdue', 'Was due yesterday', ?2, u.id, ?3 FROM classes c, subject_offerings o, users u WHERE c.public_id = ?4 AND o.public_id = ?5 AND u.public_id = ?6`,
      )
      .bind(late, hoursFromNow(-24), hoursFromNow(-48), plus2.classId, plus2.offeringId, teacher.publicId)
      .run();
    expect((await submit(late, plus2.pupils[2]!.person)).status).toBe(200);
    expect((await mineAsStudent(plus2.pupils[2]!.person)).find((a) => a.id === late)!.submission!.isLate).toBe(true);
  });
});

describe("reach", () => {
  it("Student A cannot submit to, or see, another class's work; the teacher of another class cannot open it", async () => {
    const id = ((await (await setWork({ title: "Private to plus2" })).json()) as { id: string }).id;
    const outsider = bachelors.pupils[0]!.person;
    expect((await submit(id, outsider)).status).toBe(404);
    expect((await mineAsStudent(outsider)).map((a) => a.id)).not.toContain(id);
    expect((await detail(id, stranger)).status).toBe(404);
    expect((await detail(id, plus2.pupils[0]!.person)).status).toBe(403);
  });

  it("a withdrawn assignment disappears for students and takes no submissions", async () => {
    const id = ((await (await setWork({ title: "Withdrawn" })).json()) as { id: string }).id;
    expect((await call(`/api/assignments/${id}/withdraw`, { method: "POST", cookie: teacher.cookie })).status).toBe(200);
    expect((await mineAsStudent(plus2.pupils[0]!.person)).map((a) => a.id)).not.toContain(id);
    expect((await submit(id, plus2.pupils[0]!.person)).status).toBe(404);
  });
});

describe("the database holds the rules even without the code", () => {
  it("a submission's text changes only after a resubmission is allowed, and nothing is deleted", async () => {
    const row = await db.prepare("SELECT public_id FROM submissions WHERE status = 'submitted' LIMIT 1").first<{ public_id: string }>();
    await expect(db.prepare("UPDATE submissions SET body = 'Edited' WHERE public_id = ?1").bind(row!.public_id).run()).rejects.toThrow(/only after a resubmission/);
    await expect(db.prepare("DELETE FROM submissions").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("DELETE FROM assignments").run()).rejects.toThrow(/never deleted/);
  });
});

describe("switches and closed years", () => {
  it("a school that switched homework off gets 404", async () => {
    await setModule("homework", false);
    try {
      expect((await setWork()).status).toBe(404);
      expect((await call("/api/assignments/me", { cookie: plus2.pupils[0]!.person.cookie })).status).toBe(404);
    } finally {
      await setModule("homework", true);
    }
  });

  it("a closed year rejects setting and submitting", async () => {
    const id = ((await (await setWork({ title: "Before close" })).json()) as { id: string }).id;
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2027-04-13T00:00:00.000Z' WHERE status = 'active'").run();
    expect((await setWork()).status).toBe(409);
    expect((await submit(id, plus2.pupils[0]!.person)).status).toBe(409);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
