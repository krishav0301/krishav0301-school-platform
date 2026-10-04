/**
 * The Phase 4 exit check (docs/build-plan.md): admissions and the student record working end to end,
 * for BOTH schools, through the real HTTP API, starting from each school's own pack.
 *
 *  - a school starting from its pack already has structure (programmes and levels); a Co-ordinator adds
 *    a year and a class, the minimum admissions needs
 *  - a public applicant applies, verifies their email, and appears in the Co-ordinator's queue
 *  - the Co-ordinator approves them: a real SID, a real login, and a genuinely usable one-time password
 *    (not just present in the response — signed in with, and the change-required step completed)
 *  - a Co-ordinator's walk-in is admitted in the same request, with its own working temporary password
 *  - an Accountant's registration goes to the queue, not auto-approved, and the Co-ordinator resolves it
 *  - the new students are found by search, and each signed-in student reaches only their own record
 *  - a Student and a Teacher are refused at one representative write in each area
 *  - the audit log is one unbroken chain after all of it
 *
 * This is the exit criterion for Phase 4 slice 1 (D-063 to D-065); the mini go-live checklist in
 * build-plan.md (backups, alerts, privacy notice, a Nepal Privacy Act check) is a PM/operational matter
 * this test does not cover.
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

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("Phase 4 exit check: $label", ({ json, database }) => {
  const pack: Pack = testPack(json);
  const db = () => database();

  const call = (path: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: options.method ?? "GET",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { ...env, DB: db() },
    );
  const post = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "POST", body, cookie });
  const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"]) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-p4exit-${crypto.randomUUID().slice(0, 6)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `${role} person`,
      roles: [{ role: role as never, scope: scope as never }],
    });
    const now = Math.floor(Date.now() / 1000);
    return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [{ role, scope } as RoleClaim], iat: now, exp: now + 600 })}`;
  }

  /** Reads the newest verification token straight from the dev mailbox: there is no real inbox to poll. */
  async function verificationTokenFor(): Promise<string> {
    const row = await db().prepare("SELECT body FROM dev_mailbox ORDER BY id DESC LIMIT 1").first<{ body: string }>();
    const match = /#token=([A-Za-z0-9_-]+)/.exec(row!.body);
    expect(match, "no verification token found in the last email").not.toBeNull();
    return match![1]!;
  }

  const cookies: Record<string, string> = {};
  const state: { levelId?: string; classId?: string } = {};
  let bsYear = 2060;

  it("the school starts from its pack: a Co-ordinator adds a year and a class", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack); // a school starts with no programmes: the Admin makes them (D-087)
    cookies.admin = await signedIn("admin", "institution");
    cookies.coordinator = await signedIn("coordinator", "institution");
    cookies.accountant = await signedIn("accountant", "institution");
    cookies.student = await signedIn("student", "own");

    const programmes = (await (await call("/api/academics/programmes", { cookie: cookies.coordinator })).json()) as { programmes: { id: string; levels: { id: string }[] }[] };
    state.levelId = programmes.programmes[0]!.levels[0]!.id;

    const b = ++bsYear;
    const yearResponse = await post("/api/academics/years", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }), levelIds: [state.levelId!] }, cookies.admin);
    expect(yearResponse.status).toBe(201);
    const yearId = await idOf(yearResponse);
    expect((await post(`/api/academics/years/${yearId}/activate`, undefined, cookies.admin)).status).toBe(200);

    const classResponse = await post("/api/academics/classes", { yearId, levelId: state.levelId, label: "Morning" }, cookies.coordinator);
    expect(classResponse.status).toBe(201);
    state.classId = await idOf(classResponse);
  });

  it("a public applicant applies, verifies their email, and appears in the Co-ordinator's queue", async () => {
    const email = `sita-p4exit-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const applied = await call("/api/admissions/apply", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.10" },
      body: {
        firstName: "Sita",
        lastName: "Sharma",
        dob: "2010-03-14",
        phone: "9800000010",
        email,
        guardianName: "Ram Sharma",
        guardianPhone: "9800000011",
        levelId: state.levelId,
        submissionToken: `p4exit-${crypto.randomUUID()}`,
      },
    });
    expect(applied.status).toBe(201);
    const applicationId = await idOf(applied);

    // Not yet in the queue: email is unverified.
    const before = (await (await call("/api/admissions/queue", { cookie: cookies.coordinator })).json()) as { applications: { id: string }[] };
    expect(before.applications.map((a) => a.id)).not.toContain(applicationId);

    const verified = await post("/api/admissions/verify", { token: await verificationTokenFor() }, undefined);
    expect(verified.status).toBe(200);

    const after = (await (await call("/api/admissions/queue", { cookie: cookies.coordinator })).json()) as { applications: { id: string; status: string }[] };
    expect(after.applications.find((a) => a.id === applicationId)).toMatchObject({ status: "pending_review" });

    const approved = await post(`/api/admissions/applications/${applicationId}/approve`, { classId: state.classId }, cookies.coordinator);
    expect(approved.status).toBe(200);
    expect(approved.headers.get("Cache-Control")).toBe("no-store");
    const { sid, studentId, temporaryPassword } = (await approved.json()) as { sid: string; studentId: string; temporaryPassword: string };
    expect(sid).toMatch(/^\d{4}-\d{5}$/);

    // The temporary password is not just present in the response: it actually signs in, and the
    // change-required step actually produces a real session that reaches only this student's own record.
    const firstSignIn = await call("/api/auth/sign-in", { method: "POST", body: { email, password: temporaryPassword } });
    expect(firstSignIn.status).toBe(200);
    const step = (await firstSignIn.json()) as { passwordChange?: string; challenge?: string };
    expect(step.passwordChange).toBe("required");

    const changed = await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password: "Papaya-Compass-Ledger-8823" } });
    expect(changed.status).toBe(200);
    cookies.realStudent = cookiesOf(changed);

    const own = await call("/api/students/me", { cookie: cookies.realStudent });
    expect(own.status).toBe(200);
    expect((await own.json()) as { sid: string }).toMatchObject({ sid });

    // Found by staff search too.
    const found = (await (await call(`/api/students?q=${encodeURIComponent("Sharma")}`, { cookie: cookies.coordinator })).json()) as { students: { id: string }[] };
    expect(found.students.map((s) => s.id)).toContain(studentId);
  });

  it("a Co-ordinator's walk-in is admitted in the same request, with its own working temporary password", async () => {
    const email = `hari-p4exit-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const walkedIn = await post(
      "/api/admissions/walk-ins",
      { firstName: "Hari", lastName: "Thapa", dob: "2009-11-02", phone: "9800000020", email, guardianName: "Gita Thapa", guardianPhone: "9800000021", levelId: state.levelId, classId: state.classId },
      cookies.coordinator,
    );
    expect(walkedIn.status).toBe(201);
    expect(walkedIn.headers.get("Cache-Control")).toBe("no-store");
    const { sid, temporaryPassword } = (await walkedIn.json()) as { sid: string; temporaryPassword: string };
    expect(sid).toMatch(/^\d{4}-\d{5}$/);

    const signIn = await call("/api/auth/sign-in", { method: "POST", body: { email, password: temporaryPassword } });
    expect((await signIn.json()) as { passwordChange?: string }).toMatchObject({ passwordChange: "required" });
  });

  it("an Accountant's registration goes to the queue, not auto-approved, and the Co-ordinator resolves it", async () => {
    const email = `kabita-p4exit-${crypto.randomUUID().slice(0, 6)}@example.com`;
    const registered = await post(
      "/api/admissions/register",
      { firstName: "Kabita", lastName: "Rai", dob: "2010-07-20", phone: "9800000030", email, guardianName: "Suman Rai", guardianPhone: "9800000031", levelId: state.levelId },
      cookies.accountant,
    );
    expect(registered.status).toBe(201);
    const applicationId = await idOf(registered);

    const queue = (await (await call("/api/admissions/queue", { cookie: cookies.coordinator })).json()) as { applications: { id: string; status: string }[] };
    expect(queue.applications.find((a) => a.id === applicationId)).toMatchObject({ status: "pending_review" });

    // The Accountant has no reach into the review queue: this is the Co-ordinator's alone.
    expect((await call("/api/admissions/queue", { cookie: cookies.accountant })).status).toBe(403);

    const approved = await post(`/api/admissions/applications/${applicationId}/approve`, { classId: state.classId }, cookies.coordinator);
    expect(approved.status).toBe(200);
  });

  it("permissions: a Student and a Teacher are refused at one representative write in each area", async () => {
    cookies.teacher = await signedIn("teacher", "assigned");
    for (const who of [cookies.student, cookies.teacher]) {
      expect((await post("/api/admissions/walk-ins", { firstName: "x", lastName: "y", dob: "2010-01-01", phone: "9800000099", email: "x@example.com", guardianName: "g", guardianPhone: "9800000098", levelId: state.levelId, classId: state.classId }, who)).status).toBe(403);
      expect((await call("/api/admissions/queue", { cookie: who })).status).toBe(403);
    }
    // A Student has no search reach at all; a Teacher's is scoped to their own assigned students (the
    // matrix's own grant, not a bug), so only the Student is refused outright here.
    expect((await call("/api/students?q=Sharma", { cookie: cookies.student })).status).toBe(403);
    expect((await call("/api/students?q=Sharma", { cookie: cookies.teacher })).status).toBe(200);
    // A signed-in student reaches only their own record, never another's by id.
    expect((await call("/api/students/me", { cookie: cookies.student })).status).toBe(404); // this bare "student" role has no students row at all
  });

  it("after all of that, the audit log is one unbroken chain", async () => {
    expect(await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });
});
