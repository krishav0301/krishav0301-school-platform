/**
 * The Phase 3 exit check (docs/build-plan.md): academic setup, people and approvals working together,
 * for BOTH schools, through the real HTTP API, starting from each school's own pack.
 *
 *  - a school starting from its pack already has structure (programmes and levels); a year, a class
 *    and a terminal are added, subjects are catalogued and offered, a teacher is hired through the
 *    real staff-and-first-password flow and put to work, until every item of the setup checklist
 *    (D-062) is done
 *  - a Co-ordinator drafts a notice, sends it for approval, and the Admin's approval makes it public
 *  - a Student and a Teacher are refused at one representative write in each area
 *  - the audit log is one unbroken chain after all of it
 *
 * This is the last slice of Phase 3 (D-062); its own exit criterion is this test passing for both
 * schools, plus the checks in docs/build-plan.md (staging, page weight) that this file does not cover.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, type Pack } from "../src/core/config";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { seedProgrammes, testPack } from "./programme-fixtures";

const app = createApp();

interface Checklist {
  year: boolean;
  structure: boolean;
  classes: boolean;
  terminals: boolean;
  subjects: boolean;
  teachers: boolean;
  classTeachers: boolean;
}

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("Phase 3 exit check: $label", ({ json, database }) => {
  const pack: Pack = testPack(json);
  const db = () => database();

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
  const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"]) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-p3exit-${crypto.randomUUID().slice(0, 6)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `${role} person`,
      roles: [{ role: role as never, scope: scope as never }],
    });
    const now = Math.floor(Date.now() / 1000);
    return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [{ role, scope } as RoleClaim], iat: now, exp: now + 600 })}`;
  }

  const cookies: Record<string, string> = {};
  const state: { yearId?: string; levelId?: string; classId?: string; offeringId?: string; teacherId?: string; contentId?: string; approvalId?: string } = {};
  let bsYear = 2050;

  it("the school starts from its pack: structure is already there from the working programmes and levels", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack); // a school starts with no programmes: the Admin makes them (D-087)
    cookies.admin = await signedIn("admin", "institution");
    cookies.coordinator = await signedIn("coordinator", "institution");
    cookies.student = await signedIn("student", "own");
    // Not `cookies.teacher` yet: signing one in here would give a real, active teacher assignment,
    // making the checklist's `teachers` item true before the "teaching" step means to. It is made
    // just before the permissions check, which is the only place this suite needs an unprivileged teacher.

    const checklist = (await (await call("/api/academics/checklist", { cookie: cookies.coordinator })).json()) as Checklist;
    expect(checklist).toMatchObject({ year: false, structure: true, classes: false, terminals: false, subjects: false, teachers: false, classTeachers: false });

    const programmes = (await (await call("/api/academics/programmes", { cookie: cookies.coordinator })).json()) as { programmes: { id: string; levels: { id: string }[] }[] };
    state.levelId = programmes.programmes[0]!.levels[0]!.id;
  });

  it("structure: a year, a class and a terminal make those three items true", async () => {
    const b = ++bsYear;
    const yearResponse = await post("/api/academics/years", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }), levelIds: [state.levelId!] }, cookies.admin);
    expect(yearResponse.status).toBe(201);
    state.yearId = await idOf(yearResponse);
    expect((await post(`/api/academics/years/${state.yearId}/activate`, undefined, cookies.admin)).status).toBe(200);

    const classResponse = await post("/api/academics/classes", { yearId: state.yearId, levelId: state.levelId, label: "Morning" }, cookies.coordinator);
    expect(classResponse.status).toBe(201);
    state.classId = await idOf(classResponse);
    expect((await post("/api/academics/terminals", { yearId: state.yearId, name: "First terminal" }, cookies.coordinator)).status).toBe(201);

    const checklist = (await (await call("/api/academics/checklist", { cookie: cookies.coordinator })).json()) as Checklist;
    expect(checklist).toMatchObject({ year: true, structure: true, classes: true, terminals: true, subjects: false, teachers: false, classTeachers: false });
  });

  it("subjects: a subject catalogued and offered on the class's level makes that item true", async () => {
    const subjectResponse = await post("/api/academics/subjects", { name: `Physics ${crypto.randomUUID().slice(0, 6)}` }, cookies.coordinator);
    expect(subjectResponse.status).toBe(201);
    const subjectId = await idOf(subjectResponse);

    const offeringResponse = await post("/api/academics/offerings", { levelId: state.levelId, subjectId }, cookies.coordinator);
    expect(offeringResponse.status).toBe(201);
    state.offeringId = await idOf(offeringResponse);

    const checklist = (await (await call("/api/academics/checklist", { cookie: cookies.coordinator })).json()) as Checklist;
    expect(checklist.subjects).toBe(true);
  });

  it("teaching: a teacher hired through the real staff-and-first-password flow, assigned and made Class Teacher, makes every item true", async () => {
    // The real flow: the Co-ordinator hires, the temporary password gives only a step, choosing a password gives the session.
    const email = `teacher-p3exit-${crypto.randomUUID().slice(0, 6)}@school.example`;
    const hired = await post("/api/teachers", { fullName: "Ram Karki", email, homeSectionKey: pack.sections[0]!.key }, cookies.coordinator);
    expect(hired.status).toBe(201);
    const { id: teacherId, temporaryPassword } = (await hired.json()) as { id: string; temporaryPassword: string };
    state.teacherId = teacherId;

    const first = await call("/api/auth/sign-in", { method: "POST", body: { email, password: temporaryPassword } });
    expect(first.status).toBe(200);
    const step = (await first.json()) as { passwordChange?: string; challenge?: string };
    expect(step.passwordChange).toBe("required");

    const changed = await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password: "Mango-Sunrise-Harbour-4471" } });
    expect(changed.status).toBe(200);
    cookies.realTeacher = cookiesOf(changed);

    expect((await post("/api/academics/assignments", { classId: state.classId, offeringId: state.offeringId, teacherId: state.teacherId }, cookies.coordinator)).status).toBe(200);
    expect((await post(`/api/academics/classes/${state.classId}/class-teacher`, { teacherId: state.teacherId }, cookies.coordinator)).status).toBe(200);

    const checklist = (await (await call("/api/academics/checklist", { cookie: cookies.coordinator })).json()) as Checklist;
    expect(checklist).toEqual({ year: true, structure: true, classes: true, terminals: true, subjects: true, teachers: true, classTeachers: true });

    // The teacher's own session, from the real flow, actually works: it is a real, active sign-in.
    expect((await call("/api/academics/checklist", { cookie: cookies.realTeacher })).status).toBe(403); // a Teacher has no setup.structure.view; a real session still enforces the matrix
  });

  it("approvals: the Co-ordinator drafts a notice, sends it for approval, and the Admin's approval makes it public", async () => {
    const title = `Exit notice ${crypto.randomUUID().slice(0, 6)}`;
    const drafted = await post("/api/content", { kind: "notice", title, body: "Classes resume Monday.", publishOn: "2020-01-01" }, cookies.coordinator);
    expect(drafted.status).toBe(201);
    state.contentId = await idOf(drafted);

    // Not the Co-ordinator's to publish directly.
    expect((await post(`/api/content/${state.contentId}/publish`, undefined, cookies.coordinator)).status).toBe(403);

    const requested = await post("/api/approvals", { kind: "website_content", subjectId: state.contentId }, cookies.coordinator);
    expect(requested.status).toBe(201);
    state.approvalId = await idOf(requested);

    // The Co-ordinator requests but never decides: `approvals.decide` is Admin and Super Admin only.
    expect((await post(`/api/approvals/${state.approvalId}/approve`, undefined, cookies.coordinator)).status).toBe(403);

    expect((await post(`/api/approvals/${state.approvalId}/approve`, undefined, cookies.admin)).status).toBe(200);
    const publicItems = (await (await call("/api/site/content")).json()) as { items: { title: string }[] };
    expect(publicItems.items.map((i) => i.title)).toContain(title);
  });

  it("permissions: a Student and a Teacher are refused at one representative write in each area", async () => {
    cookies.teacher = await signedIn("teacher", "assigned");
    for (const who of [cookies.student, cookies.teacher]) {
      expect((await post("/api/academics/classes", { yearId: state.yearId, levelId: state.levelId, label: "Evening" }, who)).status).toBe(403);
      expect((await post("/api/academics/offerings", { levelId: state.levelId, subjectId: state.offeringId! }, who)).status).toBe(403);
      expect((await post("/api/academics/assignments", { classId: state.classId, offeringId: state.offeringId, teacherId: null }, who)).status).toBe(403);
      expect((await post("/api/content", { kind: "notice", title: "Not allowed", body: "x", publishOn: "2020-01-01" }, who)).status).toBe(403);
      expect((await post(`/api/approvals/${state.approvalId}/approve`, undefined, who)).status).toBe(403);
    }
  });

  it("after all of that, the audit log is one unbroken chain", async () => {
    expect(await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });
});
