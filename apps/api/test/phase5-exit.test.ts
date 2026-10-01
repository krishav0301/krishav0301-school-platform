/**
 * The Phase 5 exit check (docs/build-plan.md): a school day, end to end, for BOTH schools, through the real HTTP API,
 * starting from each school's own pack, with real sign-ins from the real first-password flows.
 *
 *  - the Co-ordinator sets up this year: a class, a subject, a teacher hired through the staff flow, assigned and made
 *    Class Teacher; two students admitted as walk-ins, each signed in through their own first-password flow
 *  - the Class Teacher marks today's register; the Co-ordinator saves the teachers' day; the teacher writes the
 *    day's activity log; shares a note (only where the school uses notes); sets homework
 *  - a student sees their attendance with its percentage, the activity log, the notes (watermarked with their SID),
 *    and the homework, submits it; the teacher reviews it; the student sees the marks
 *  - the other student sees only their own record; a Student and a Teacher are refused at representative writes
 *  - the audit log is one unbroken chain after all of it
 *
 * The second-school test (CLAUDE.md rule 5): the sample school switched notes off in its pack, so its notes answer
 * 404 while everything else works the same.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, parsePack, resolveModules, type Pack } from "../src/core/config";
import { bsToAd, daysInMonth, nepalDate, todayBs } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { seedProgrammes } from "./programme-fixtures";

const app = createApp();

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("Phase 5 exit check: $label", ({ json, database }) => {
  const pack: Pack = parsePack(json);
  const db = () => database();
  const notesOn = resolveModules(pack.modules ?? {}).notes === true;

  const call = (path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: options.method ?? "GET",
        headers: { "Sec-Fetch-Site": "same-origin", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { ...env, DB: db() },
    );
  const post = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "POST", body, cookie });
  const put = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "PUT", body, cookie });
  const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"]) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-p5exit-${crypto.randomUUID().slice(0, 6)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `${role} person`,
      roles: [{ role: role as never, scope: scope as never }],
    });
    const now = Math.floor(Date.now() / 1000);
    return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [{ role, scope } as RoleClaim], iat: now, exp: now + 600 })}`;
  }

  /** The real first-password flow: the temporary password gives a step, choosing a password gives the session. */
  async function firstSignIn(email: string, temporaryPassword: string, password: string): Promise<string> {
    const first = await call("/api/auth/sign-in", { method: "POST", body: { email, password: temporaryPassword } });
    expect(first.status).toBe(200);
    const step = (await first.json()) as { challenge?: string };
    const changed = await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password } });
    expect(changed.status).toBe(200);
    return cookiesOf(changed);
  }

  const cookies: Record<string, string> = {};
  const state: { classId?: string; levelId?: string; offeringId?: string; teacherId?: string; homeworkId?: string; sids: string[] } = { sids: [] };

  it("setup: this year, a class, a subject, a hired teacher as subject teacher and Class Teacher, two admitted students", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack); // a school starts with no programmes: the Admin makes them (D-087)
    cookies.coordinator = await signedIn("coordinator", "institution");
    cookies.admin = await signedIn("admin", "institution");

    const programmes = (await (await call("/api/academics/programmes", { cookie: cookies.coordinator })).json()) as { programmes: { levels: { id: string }[] }[] };
    state.levelId = programmes.programmes[0]!.levels[0]!.id;

    // This BS year, so today's date belongs to it.
    const b = todayBs().year;
    const year = await post("/api/academics/years", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }) }, cookies.coordinator);
    expect(year.status).toBe(201);
    const yearId = await idOf(year);
    expect((await post(`/api/academics/years/${yearId}/activate`, undefined, cookies.coordinator)).status).toBe(200);
    const cls = await post("/api/academics/classes", { yearId, levelId: state.levelId, label: "" }, cookies.coordinator);
    expect(cls.status).toBe(201);
    state.classId = await idOf(cls);

    const subject = await post("/api/academics/subjects", { name: `Science ${crypto.randomUUID().slice(0, 6)}` }, cookies.coordinator);
    const offering = await post("/api/academics/offerings", { levelId: state.levelId, subjectId: await idOf(subject) }, cookies.coordinator);
    expect(offering.status).toBe(201);
    state.offeringId = await idOf(offering);

    const email = `teacher-p5exit-${crypto.randomUUID().slice(0, 6)}@school.example`;
    const hired = await post("/api/teachers", { fullName: "Ram Karki", email, homeSectionKey: pack.sections[0]!.key }, cookies.coordinator);
    expect(hired.status).toBe(201);
    const { id: teacherId, temporaryPassword } = (await hired.json()) as { id: string; temporaryPassword: string };
    state.teacherId = teacherId;
    cookies.teacher = await firstSignIn(email, temporaryPassword, "Mango-Sunrise-Harbour-4471");
    expect((await post("/api/academics/assignments", { classId: state.classId, offeringId: state.offeringId, teacherId }, cookies.coordinator)).status).toBe(200);
    expect((await post(`/api/academics/classes/${state.classId}/class-teacher`, { teacherId }, cookies.coordinator)).status).toBe(200);

    for (const [first, last] of [["Sita", "Sharma"], ["Hari", "Thapa"]] as const) {
      const studentEmail = `${first.toLowerCase()}-p5exit-${crypto.randomUUID().slice(0, 6)}@example.com`;
      const admitted = await post(
        "/api/admissions/walk-ins",
        { firstName: first, lastName: last, dob: "2009-11-02", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email: studentEmail, guardianName: "Guardian", guardianPhone: "9800000021", levelId: state.levelId, classId: state.classId },
        cookies.coordinator,
      );
      expect(admitted.status).toBe(201);
      const { sid, temporaryPassword: studentPassword } = (await admitted.json()) as { sid: string; temporaryPassword: string };
      state.sids.push(sid);
      cookies[first] = await firstSignIn(studentEmail, studentPassword, "Papaya-Compass-Ledger-8823");
    }
  });

  it("attendance: the Class Teacher marks today's register (Hari absent); the Co-ordinator saves the teachers' day", async () => {
    const day = (await (await call(`/api/attendance/classes/${state.classId}/day`, { cookie: cookies.teacher })).json()) as { canMark: boolean; students: { enrollmentId: string; sid: string }[] };
    expect(day.canMark).toBe(true);
    const hari = day.students.find((s) => s.sid === state.sids[1])!;
    expect((await put(`/api/attendance/classes/${state.classId}/today`, { absent: [hari.enrollmentId] }, cookies.teacher)).status).toBe(200);

    expect((await put("/api/attendance/teachers/day", { date: nepalDate(new Date()), exceptions: [] }, cookies.coordinator)).status).toBe(200);
    const mine = (await (await call("/api/attendance/teachers/me", { cookie: cookies.teacher })).json()) as { present: number };
    expect(mine.present).toBe(1);
  });

  it("classwork: the teacher writes today's activity, shares a note where the school uses notes, and sets homework", async () => {
    expect((await put(`/api/activity/classes/${state.classId}/subjects/${state.offeringId}/today`, { body: "Started the chapter on light." }, cookies.teacher)).status).toBe(200);

    const note = await post("/api/notes", { classId: state.classId, offeringId: state.offeringId, kind: "note", title: "Light: summary", body: "Reflection and refraction." }, cookies.teacher);
    expect(note.status).toBe(notesOn ? 201 : 404);

    const homework = await post(
      "/api/assignments",
      { classId: state.classId, offeringId: state.offeringId, title: "Draw a ray diagram", instructions: "Plane mirror, 30 degrees.", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), maxMarks: 5 },
      cookies.teacher,
    );
    expect(homework.status).toBe(201);
    state.homeworkId = await idOf(homework);
  });

  it("the student's day: attendance with its percentage, the activity log, the notes with their own SID, the homework submitted and reviewed", async () => {
    const attendance = (await (await call("/api/attendance/me", { cookie: cookies.Sita })).json()) as { percent: number; below: boolean };
    expect(attendance).toMatchObject({ percent: 100, below: false });
    const hari = (await (await call("/api/attendance/me", { cookie: cookies.Hari })).json()) as { percent: number; below: boolean };
    expect(hari).toMatchObject({ percent: 0, below: true });

    const activity = (await (await call("/api/activity/me", { cookie: cookies.Sita })).json()) as { days: { entries: { body: string }[] }[] };
    expect(activity.days[0]!.entries[0]!.body).toBe("Started the chapter on light.");

    const notes = await call("/api/notes/me", { cookie: cookies.Sita });
    expect(notes.status).toBe(notesOn ? 200 : 404);
    if (notesOn) expect(((await notes.json()) as { watermark: string }).watermark).toContain(state.sids[0]);

    expect((await put(`/api/assignments/${state.homeworkId}/submission`, { body: "Diagram attached as described." }, cookies.Sita)).status).toBe(200);
    const detail = (await (await call(`/api/assignments/${state.homeworkId}`, { cookie: cookies.teacher })).json()) as { students: { sid: string; submission: { id: string } | null }[] };
    const sita = detail.students.find((s) => s.sid === state.sids[0])!;
    expect((await post(`/api/assignments/${state.homeworkId}/submissions/${sita.submission!.id}/review`, { marks: 4, feedback: "Label the normal." }, cookies.teacher)).status).toBe(200);
    const work = (await (await call("/api/assignments/me", { cookie: cookies.Sita })).json()) as { assignments: { id: string; submission: { marks: number; status: string } | null }[] };
    expect(work.assignments.find((a) => a.id === state.homeworkId)!.submission).toMatchObject({ status: "reviewed", marks: 4 });
  });

  it("reach: each student sees only their own; a Student and a Teacher are refused at representative writes", async () => {
    const hariWork = (await (await call("/api/assignments/me", { cookie: cookies.Hari })).json()) as { assignments: { submission: unknown }[] };
    expect(hariWork.assignments[0]!.submission).toBeNull();
    expect((await call(`/api/attendance/classes/${state.classId}/summary`, { cookie: cookies.Sita })).status).toBe(404);
    expect((await put(`/api/attendance/classes/${state.classId}/today`, { absent: [] }, cookies.Sita)).status).toBe(403);
    expect((await put("/api/attendance/teachers/day", { date: nepalDate(new Date()), exceptions: [] }, cookies.teacher)).status).toBe(403);
    expect((await post("/api/assignments", { classId: state.classId, offeringId: state.offeringId, title: "x", instructions: "y", dueAt: new Date(Date.now() + 86_400_000).toISOString() }, cookies.Sita)).status).toBe(403);
    expect((await call("/api/activity/missing", { cookie: cookies.teacher })).status).toBe(403);
  });

  it("the Co-ordinator's school-day views show it all: the register marked, nothing missing in the activity log", async () => {
    const classes = (await (await call("/api/attendance/classes", { cookie: cookies.coordinator })).json()) as { classes: { id: string; markedToday: boolean; absentToday: number }[] };
    expect(classes.classes.find((c) => c.id === state.classId)).toMatchObject({ markedToday: true, absentToday: 1 });
    const missing = (await (await call("/api/activity/missing", { cookie: cookies.coordinator })).json()) as { classes: { classId: string }[] };
    expect(missing.classes.map((c) => c.classId)).not.toContain(state.classId);
  });

  it("after all of that, the audit log is one unbroken chain", async () => {
    expect(await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });
});
