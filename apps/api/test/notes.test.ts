import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { assign, classWith, setModule, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * Notes and question papers (Phase 5, slice 4, D-072). Source 6.2: shared by year, class and subject, live at once,
 * replaced by withdrawing and sharing again (no versioning). R2 is off (D-020), so a note is text and an optional
 * link, not a file. Source 6.1: students cannot download them; protection is soft (a watermark with the student's
 * name and ID), a deterrent, not a guarantee.
 */

interface StudentNotes {
  watermark: string;
  notes: { id: string; kind: "note" | "question_paper"; title: string; body: string | null; link: string | null; subjectName: string; teacherName: string }[];
}

let plus2: ClassFixture, bachelors: ClassFixture;
let teacher: Person, stranger: Person, coordinator: Person, admin: Person;

beforeAll(async () => {
  plus2 = await classWith("plus2", 2);
  bachelors = await classWith("bachelors", 1);
  teacher = await teacherIn("plus2");
  stranger = await teacherIn("plus2");
  await assign(teacher, plus2.classId, plus2.offeringId);
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
});

const share = (body: Record<string, unknown>, who: Person = teacher) =>
  call("/api/notes", { method: "POST", cookie: who.cookie, body: { classId: plus2.classId, offeringId: plus2.offeringId, kind: "note", title: "Kinematics summary", ...body } });

describe("sharing", () => {
  let first: string;

  it("the subject's teacher shares a note, live at once, with one audit entry", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'notes.shared'");
    const response = await share({ body: "Equations of motion, with worked examples.", link: "https://example.org/kinematics.pdf" });
    expect(response.status).toBe(201);
    first = ((await response.json()) as { id: string }).id;
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'notes.shared'")).toBe(before + 1);

    const mine = (await (await call("/api/notes/mine", { cookie: teacher.cookie })).json()) as { notes: { id: string; withdrawn: boolean }[] };
    expect(mine.notes.map((n) => n.id)).toContain(first);
  });

  it("a question paper is the same, with its own kind", async () => {
    expect((await share({ kind: "question_paper", title: "First terminal 2082", body: "Q1. ..." })).status).toBe(201);
  });

  it("needs a body or a link, only an https link, and a title", async () => {
    expect((await share({})).status).toBe(422);
    expect((await share({ link: "http://example.org/x.pdf" })).status).toBe(400);
    expect((await share({ link: "javascript:alert(1)" })).status).toBe(400);
    expect((await share({ title: "", body: "x" })).status).toBe(400);
  });

  it("only a teacher of that subject in that class shares: another teacher 404, other roles 403", async () => {
    expect((await share({ body: "x" }, stranger)).status).toBe(404);
    expect(
      (await call("/api/notes", { method: "POST", cookie: teacher.cookie, body: { classId: bachelors.classId, offeringId: bachelors.offeringId, kind: "note", title: "x", body: "x" } })).status,
    ).toBe(404);
    for (const who of [coordinator, admin, plus2.pupils[0]!.person]) expect((await share({ body: "x" }, who)).status).toBe(403);
  });

  it("withdrawing hides it from students; it is never deleted, cannot be withdrawn twice, and only its teacher's class may withdraw", async () => {
    const response = await share({ title: "To withdraw", body: "Wrong file" });
    const id = ((await response.json()) as { id: string }).id;
    expect((await call(`/api/notes/${id}/withdraw`, { method: "POST", cookie: stranger.cookie })).status).toBe(404);
    expect((await call(`/api/notes/${id}/withdraw`, { method: "POST", cookie: teacher.cookie })).status).toBe(200);
    expect((await call(`/api/notes/${id}/withdraw`, { method: "POST", cookie: teacher.cookie })).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM class_notes WHERE public_id = ?1", id)).toBe(1);

    const seen = (await (await call("/api/notes/me", { cookie: plus2.pupils[0]!.person.cookie })).json()) as StudentNotes;
    expect(seen.notes.map((n) => n.id)).not.toContain(id);
    expect(seen.notes.map((n) => n.id)).toContain(first);
  });
});

describe("reading", () => {
  it("a student sees their own class's live notes with a watermark of their own name and SID", async () => {
    const pupil = plus2.pupils[0]!;
    const response = await call("/api/notes/me", { cookie: pupil.person.cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as StudentNotes;
    const sid = (await db.prepare("SELECT sid FROM students WHERE public_id = ?1").bind(pupil.studentId).first<{ sid: string }>())!.sid;
    expect(body.watermark).toContain(sid);
    expect(body.notes.some((n) => n.kind === "question_paper")).toBe(true);
    expect(body.notes[0]!.subjectName).toBeTruthy();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("Student A never sees another class's notes", async () => {
    const outsider = (await (await call("/api/notes/me", { cookie: bachelors.pupils[0]!.person.cookie })).json()) as StudentNotes;
    expect(outsider.notes).toEqual([]);
  });

  it("the Co-ordinator and the Admin have no notes view (the matrix gives it to students and teachers only)", async () => {
    expect((await call("/api/notes/me", { cookie: coordinator.cookie })).status).toBe(403);
    expect((await call("/api/notes/mine", { cookie: admin.cookie })).status).toBe(403);
  });
});

describe("the database holds the rules even without the code", () => {
  it("a note's words never change after sharing, a withdrawal is final, and nothing is deleted", async () => {
    const id = ((await (await share({ title: "Fixed", body: "Original" })).json()) as { id: string }).id;
    await expect(db.prepare("UPDATE class_notes SET body = 'Changed' WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/cannot change/);
    await db.prepare("UPDATE class_notes SET withdrawn_at = 'x', withdrawn_by_user_id = teacher_user_id WHERE public_id = ?1").bind(id).run();
    await expect(db.prepare("UPDATE class_notes SET withdrawn_at = NULL WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/cannot change/);
    await expect(db.prepare("DELETE FROM class_notes WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/never deleted/);
  });
});

describe("switches and closed years", () => {
  it("a school that switched notes off gets 404 from every notes address", async () => {
    await setModule("notes", false);
    try {
      expect((await share({ body: "x" })).status).toBe(404);
      expect((await call("/api/notes/me", { cookie: plus2.pupils[0]!.person.cookie })).status).toBe(404);
      expect((await call("/api/notes/mine", { cookie: teacher.cookie })).status).toBe(404);
    } finally {
      await setModule("notes", true);
    }
  });

  it("a closed year rejects sharing", async () => {
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2027-04-13T00:00:00.000Z' WHERE status = 'active'").run();
    expect((await share({ body: "After close" })).status).toBe(409);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
