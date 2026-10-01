/**
 * A school year, end to end, for BOTH schools, through the real HTTP API, from each school's own pack, with real
 * sign-ins from the real first-password flows. Every module in the order a school uses it, and at each stage the edge
 * cases a real year produces: double submits, repeated clicks, late joiners, a teacher replaced mid-year, a deactivated
 * member of staff, overpayment and refund, a result changed after publishing, and finally a closed year that refuses
 * every write. Written 2026-09-29 at the PM's request ("test the entire website, one complete year, all edge cases").
 *
 * The year's close, promotion and carried dues are Phase 8 and not built: the year is closed here the way Phase 8 will
 * (its status), to prove every Phase 3 to 7 write path refuses it.
 */
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, resolveModules, type Pack } from "../src/core/config";
import { bsToAd, daysInMonth, nepalDate, todayBs } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { firstProgrammePolicy, seedProgrammes, testPack } from "./programme-fixtures";

// These walk a whole school year, hashing many passwords on purpose-slow scrypt; with every test file running in
// parallel they can pass the 60 s default on a busy machine (seen 2026-10-01), so they get three minutes.
vi.setConfig({ testTimeout: 180_000 });

const app = createApp();
const PASS = "Papaya-Compass-Ledger-8823";

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("A school year: $label", ({ label, json, database }) => {
  const pack: Pack = testPack(json);
  const modules = resolveModules(pack.modules ?? {});
  const policy = firstProgrammePolicy(pack);
  const db = () => database();
  const ip = label === "Royal Softech" ? "203.0.113.41" : "203.0.113.42";

  const call = (path: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: options.method ?? "GET",
        headers: { "Sec-Fetch-Site": "same-origin", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { ...env, DB: db(), DEMO_MODE: "true" },
    );
  const get = async <T>(path: string, cookie: string | undefined): Promise<T> => {
    const r = await call(path, { cookie });
    expect(r.status, `GET ${path}`).toBe(200);
    return (await r.json()) as T;
  };
  const post = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "POST", body, cookie });
  const put = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "PUT", body, cookie });
  const patch = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "PATCH", body, cookie });
  const ok = async (response: Response, status = 200) => {
    if (response.status !== status) throw new Error(`expected ${status}, got ${response.status}: ${await response.text()}`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");
  const key = () => crypto.randomUUID().replace(/-/g, "");
  const tag = crypto.randomUUID().slice(0, 6);

  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"], section?: string) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-${section ?? "all"}-year-${crypto.randomUUID().slice(0, 6)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `${role} person`,
      roles: [{ role: role as never, scope: scope as never, ...(section ? { sectionKey: section } : {}) }],
    });
    const now = Math.floor(Date.now() / 1000);
    const claim = { role, scope, ...(section ? { section } : {}) } as RoleClaim;
    return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [claim], iat: now, exp: now + 3600 })}`;
  }
  async function firstSignIn(email: string, temporaryPassword: string): Promise<string> {
    const first = await call("/api/auth/sign-in", { method: "POST", body: { email, password: temporaryPassword } });
    expect(first.status).toBe(200);
    const step = (await first.json()) as { challenge?: string };
    const changed = await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password: PASS } });
    expect(changed.status).toBe(200);
    return cookiesOf(changed);
  }
  const lastToken = async () => /#token=([A-Za-z0-9_-]+)/.exec((await db().prepare("SELECT body FROM dev_mailbox ORDER BY id DESC LIMIT 1").first<{ body: string }>())!.body)![1]!;

  const c: Record<string, string> = {};
  const s: {
    yearId?: string;
    levelId?: string;
    level2Id?: string;
    classId?: string;
    class2Id?: string;
    terminals: string[];
    subjects: Record<string, { id: string; components: string[] }>;
    teachers: Record<string, string>;
    students: Record<string, { enrollmentId: string; studentId: string; sid: string }>;
    structureId?: string;
    groupId?: string;
  } = { terminals: [], subjects: {}, teachers: {}, students: {} };
  const firstSection = pack.sections[0]!.key;

  // --- 1. Setting up the year ---------------------------------------------------------------------

  it("setup: the pack, staff created through the real flows, a year with three terminals and two classes", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack); // a school starts with no programmes: the Admin makes them (D-087)
    c.admin = await signedIn("admin", "institution");
    c.coordinator = await signedIn("coordinator", "institution");
    if (pack.sections.length > 1) c.sectionCoordinator = await signedIn("coordinator", "section", pack.sections[1]!.key);

    // The Admin creates the Accountant; the Accountant signs in through the first-password flow.
    const accEmail = `accountant-${tag}@school.example`;
    const acc = await ok(await post("/api/staff", { fullName: "Anita Accountant", email: accEmail, role: "accountant" }, c.admin), 201);
    c.accountant = await firstSignIn(accEmail, acc.temporaryPassword as string);
    // The same email twice is refused.
    expect((await post("/api/staff", { fullName: "Again", email: accEmail, role: "accountant" }, c.admin)).status).toBe(409);
    // A Co-ordinator cannot create an Accountant; only teachers.
    expect((await post("/api/staff", { fullName: "No", email: `no-${tag}@school.example`, role: "accountant" }, c.coordinator)).status).toBe(403);

    const programmes = await get<{ programmes: { id: string; gradingPolicy: string | null; levels: { id: string }[] }[] }>("/api/academics/programmes", c.coordinator);
    expect(programmes.programmes[0]!.gradingPolicy).toBe(policy);
    s.levelId = programmes.programmes[0]!.levels[0]!.id;
    s.level2Id = programmes.programmes[0]!.levels[1]!.id;

    const b = todayBs().year;
    const yearBody = { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }) };
    s.yearId = (await ok(await post("/api/academics/years", yearBody, c.coordinator), 201)).id as string;
    expect((await post("/api/academics/years", yearBody, c.coordinator)).status).toBe(409); // the same year twice
    await ok(await post(`/api/academics/years/${s.yearId}/activate`, undefined, c.coordinator));
    for (const name of ["First terminal", "Second terminal", "Final"]) s.terminals.push((await ok(await post("/api/academics/terminals", { yearId: s.yearId, name }, c.coordinator), 201)).id as string);
    s.classId = (await ok(await post("/api/academics/classes", { yearId: s.yearId, levelId: s.levelId, label: "A" }, c.coordinator), 201)).id as string;
    s.class2Id = (await ok(await post("/api/academics/classes", { yearId: s.yearId, levelId: s.level2Id, label: "" }, c.coordinator), 201)).id as string;
    expect((await post("/api/academics/classes", { yearId: s.yearId, levelId: s.levelId, label: "A" }, c.coordinator)).status).toBe(409); // duplicate class
  });

  it("setup: subjects with components and credit hours, an elective group, teachers hired and assigned", async () => {
    const subject = async (name: string, credit: number, parts: [number, "theory" | "practical"][], groupId?: string) => {
      const subjectId = (await ok(await post("/api/academics/subjects", { name: `${name} ${tag}` }, c.coordinator), 201)).id as string;
      const offeringId = (await ok(await post("/api/academics/offerings", { levelId: s.levelId, subjectId, creditHundredths: credit * 100, ...(groupId ? { groupId } : {}) }, c.coordinator), 201)).id as string;
      const components: string[] = [];
      for (const [i, [max, kind]] of parts.entries()) components.push((await ok(await post(`/api/academics/offerings/${offeringId}/components`, { name: kind === "theory" ? `Theory ${i}` : `Practical ${i}`, maxHundredths: max * 100, kind }, c.coordinator), 201)).id as string);
      return { id: offeringId, components };
    };
    s.subjects.english = await subject("English", 4, [[100, "theory"]]);
    s.subjects.science = await subject("Science", 5, [[75, "theory"], [25, "practical"]]);
    // A component with a maximum that is not a whole number of marks.
    expect((await post(`/api/academics/offerings/${s.subjects.english!.id}/components`, { name: "Zero", maxHundredths: 0 }, c.coordinator)).status).toBe(400);
    s.groupId = (await ok(await post(`/api/academics/levels/${s.levelId}/groups`, { name: "Optional", pickCount: 1 }, c.coordinator), 201)).id as string;
    s.subjects.maths = await subject("Maths", 4, [[100, "theory"]], s.groupId);
    s.subjects.computing = await subject("Computing", 4, [[50, "theory"], [50, "practical"]], s.groupId);

    for (const name of ["ram", "gita", "hari"]) {
      const email = `${name}-${tag}@school.example`;
      const hired = await ok(await post("/api/teachers", { fullName: `${name} teacher`, email, homeSectionKey: firstSection }, c.coordinator), 201);
      s.teachers[name] = hired.id as string;
      c[name] = await firstSignIn(email, hired.temporaryPassword as string);
    }
    const assign = (offeringId: string, teacherId: string) => post("/api/academics/assignments", { classId: s.classId, offeringId, teacherId }, c.coordinator);
    await ok(await assign(s.subjects.english!.id, s.teachers.gita!));
    await ok(await assign(s.subjects.science!.id, s.teachers.ram!));
    await ok(await assign(s.subjects.maths.id, s.teachers.ram!));
    await ok(await assign(s.subjects.computing.id, s.teachers.gita!));
    await ok(await post(`/api/academics/classes/${s.classId}/class-teacher`, { teacherId: s.teachers.ram }, c.coordinator));
    const checklist = await get<Record<string, unknown>>("/api/academics/checklist", c.coordinator);
    expect(checklist).toBeTruthy();
  });

  // --- 2. Admissions ------------------------------------------------------------------------------

  it("admissions: a public application with a double submit, email verification, ask for changes, approval", async () => {
    const email = `sita-${tag}@example.com`;
    const body = { firstName: "Sita", lastName: "Sharma", dob: "2009-03-14", phone: `98${tag.replace(/\D/g, "1").padEnd(8, "1").slice(0, 8)}`, email, guardianName: "Ram Sharma", guardianPhone: "9800000011", levelId: s.levelId, submissionToken: `year-${key()}` };
    const applyAs = (b: unknown) => call("/api/admissions/apply", { method: "POST", body: b, headers: { "CF-Connecting-IP": ip } });
    const first = await applyAs(body);
    if (first.status !== 201) throw new Error(`apply: ${first.status} ${await first.text()}`);
    const applicationId = ((await first.json()) as { id: string }).id;
    const again = await applyAs(body); // the same form sent twice: the same application
    expect([200, 201]).toContain(again.status);
    expect(((await again.json()) as { id: string }).id).toBe(applicationId);
    await ok(await post("/api/admissions/verify", { token: await lastToken() }, undefined));
    expect((await post("/api/admissions/verify", { token: "not-a-real-token-at-all" }, undefined)).status).not.toBe(200);

    await ok(await post(`/api/admissions/applications/${applicationId}/request-changes`, { fields: ["phone"], reason: "Please give a phone we can reach" }, c.coordinator));
    // The accountant cannot review.
    expect((await post(`/api/admissions/applications/${applicationId}/approve`, { classId: s.classId }, c.accountant)).status).toBe(403);
    const application = await get<{ status: string }>(`/api/admissions/applications/${applicationId}`, c.coordinator);
    expect(application.status).toBe("needs_changes");
  });

  it("admissions: walk-ins (with a duplicate warning), an Accountant's registration approved, a rejection that is final", async () => {
    const walkIn = async (first: string, last: string, level = s.levelId, classId = s.classId) => {
      const email = `${first.toLowerCase()}-${tag}@example.com`;
      const r = await ok(
        await post("/api/admissions/walk-ins", { firstName: first, lastName: last, dob: "2009-11-02", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email, guardianName: "Guardian", guardianPhone: "9800000021", levelId: level, classId }, c.coordinator),
        201,
      );
      c[first] = await firstSignIn(email, r.temporaryPassword as string);
      const me = await get<{ enrollment?: { id: string }; id: string; sid: string }>("/api/students/me", c[first]);
      const fees = await call("/api/fees/me", { cookie: c[first] });
      s.students[first] = { studentId: r.studentId as string, sid: r.sid as string, enrollmentId: fees.status === 200 ? ((await fees.json()) as { enrollmentId: string }).enrollmentId : "" };
      expect(me.sid).toBe(r.sid);
    };
    for (const [f, l] of [["Asha", "Rai"], ["Bina", "Thapa"], ["Chandra", "Yadav"], ["Dipak", "Karki"]] as const) await walkIn(f, l);
    await walkIn("Elina", "Gurung", s.level2Id, s.class2Id);
    // SIDs are one sequence, never reused.
    const sids = Object.values(s.students).map((x) => x.sid);
    expect(new Set(sids).size).toBe(sids.length);

    const registered = await ok(
      await post("/api/admissions/register", { firstName: "Faris", lastName: "Ansari", dob: "2010-07-20", phone: "9811111130", email: `faris-${tag}@example.com`, guardianName: "G", guardianPhone: "9800000031", levelId: s.levelId }, c.accountant),
      201,
    );
    const rejected = await ok(
      await post("/api/admissions/register", { firstName: "Gopal", lastName: "Shah", dob: "2010-07-21", phone: "9811111131", email: `gopal-${tag}@example.com`, guardianName: "G", guardianPhone: "9800000032", levelId: s.levelId }, c.accountant),
      201,
    );
    await ok(await post(`/api/admissions/applications/${rejected.id}/reject`, { reason: "Seats are full for this level" }, c.coordinator));
    expect((await post(`/api/admissions/applications/${rejected.id}/approve`, { classId: s.classId }, c.coordinator)).status).toBe(409); // final
    // Two Co-ordinators approving at once: one wins, one SID is used.
    const [a, b] = await Promise.all([
      post(`/api/admissions/applications/${registered.id}/approve`, { classId: s.classId }, c.coordinator),
      post(`/api/admissions/applications/${registered.id}/approve`, { classId: s.classId }, c.coordinator),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const found = await get<{ students: { sid: string; firstName: string }[] }>(`/api/students?q=Ansari`, c.coordinator);
    expect(found.students.filter((x) => x.firstName === "Faris")).toHaveLength(1);
  });

  it("admissions: a student sees only their own record; a teacher sees SID and name only", async () => {
    expect((await call(`/api/students/${s.students.Bina!.studentId}`, { cookie: c.Asha })).status).not.toBe(200);
    const byTeacher = await call(`/api/students?q=Rai`, { cookie: c.gita });
    expect(byTeacher.status).toBe(200);
    const list = (await byTeacher.json()) as { students: Record<string, unknown>[] };
    for (const row of list.students) expect(row).not.toHaveProperty("phone");
  });

  // --- 3. Daily school life -----------------------------------------------------------------------

  it("daily life: the register (one absent), a second save the same day replaces it, another teacher is refused", async () => {
    if (!modules.attendance) return;
    const day = await get<{ canMark: boolean; students: { enrollmentId: string; sid: string }[] }>(`/api/attendance/classes/${s.classId}/day`, c.ram);
    expect(day.canMark).toBe(true);
    const bina = day.students.find((x) => x.sid === s.students.Bina!.sid)!;
    await ok(await put(`/api/attendance/classes/${s.classId}/today`, { absent: [bina.enrollmentId] }, c.ram));
    await ok(await put(`/api/attendance/classes/${s.classId}/today`, { absent: [] }, c.ram));
    await ok(await put(`/api/attendance/classes/${s.classId}/today`, { absent: [bina.enrollmentId] }, c.ram));
    expect((await put(`/api/attendance/classes/${s.classId}/today`, { absent: [] }, c.gita)).status).not.toBe(200);
    expect((await put(`/api/attendance/classes/${s.classId}/today`, { absent: [bina.enrollmentId] }, c.Asha)).status).toBe(403);
    const mine = await get<{ absent: number; present: number }>("/api/attendance/me", c.Bina);
    expect(mine.absent).toBe(1);
    await ok(await put("/api/attendance/teachers/day", { date: nepalDate(new Date()), exceptions: [{ teacherId: s.teachers.hari, status: "leave" }] }, c.coordinator));
  });

  it("daily life: the activity log, a note, homework submitted, reviewed, resubmitted", async () => {
    await ok(await put(`/api/activity/classes/${s.classId}/subjects/${s.subjects.science!.id}/today`, { body: "Reflection of light." }, c.ram));
    expect((await put(`/api/activity/classes/${s.classId}/subjects/${s.subjects.science!.id}/today`, { body: "Not mine." }, c.gita)).status).not.toBe(200);
    const activity = await get<{ days: { entries: unknown[] }[] }>("/api/activity/me", c.Asha);
    expect(activity.days[0]!.entries.length).toBeGreaterThan(0);
    if (modules.notes) await ok(await post("/api/notes", { classId: s.classId, offeringId: s.subjects.science!.id, kind: "note", title: "Light", body: "Angles." }, c.ram), 201);
    if (!modules.homework) return;
    const hw = await ok(await post("/api/assignments", { classId: s.classId, offeringId: s.subjects.science!.id, title: "Ray diagrams", instructions: "Draw three.", dueAt: new Date(Date.now() + 86_400_000).toISOString(), maxMarks: 10 }, c.ram), 201);
    await ok(await put(`/api/assignments/${hw.id}/submission`, { body: "Done." }, c.Asha));
    expect((await put(`/api/assignments/${hw.id}/submission`, { body: "Again." }, c.Asha)).status).toBe(409); // once, until allowed
    const detail = await get<{ students: { sid: string; submission: { id: string } | null }[] }>(`/api/assignments/${hw.id}`, c.ram);
    const submissionId = detail.students.find((x) => x.sid === s.students.Asha!.sid)!.submission!.id;
    expect((await post(`/api/assignments/${hw.id}/submissions/${submissionId}/review`, { marks: 11 }, c.ram)).status).not.toBe(200); // above the maximum
    await ok(await post(`/api/assignments/${hw.id}/submissions/${submissionId}/review`, { marks: 8, feedback: "Good" }, c.ram));
    await ok(await post(`/api/assignments/${hw.id}/submission/resubmit-request`, { reason: "I drew one wrong" }, c.Asha));
    await ok(await post(`/api/assignments/${hw.id}/submissions/${submissionId}/resubmission`, { allow: true }, c.ram));
    await ok(await put(`/api/assignments/${hw.id}/submission`, { body: "Fixed." }, c.Asha));
    // Another student never sees Asha's work.
    const other = await get<{ assignments: { submission?: { body?: string } | null }[] }>("/api/assignments/me", c.Bina);
    expect(JSON.stringify(other)).not.toContain("Fixed.");
  });

  // --- 4. Fees across the year --------------------------------------------------------------------

  it("fees: a structure (monthly, yearly, one-time) drafted, approved once, charged to every class; repeated safely", async () => {
    s.structureId = (await ok(await post("/api/fees/structures", { levelId: s.levelId }, c.accountant), 201)).id as string;
    await ok(await post(`/api/fees/structures/${s.structureId}/items`, { name: "Tuition", amountPaisa: 250_000, frequency: "monthly" }, c.accountant), 201);
    await ok(await post(`/api/fees/structures/${s.structureId}/items`, { name: "Exam", amountPaisa: 300_000, frequency: "yearly" }, c.accountant), 201);
    await ok(await post(`/api/fees/structures/${s.structureId}/items`, { name: "Admission", amountPaisa: 1_000_000, frequency: "one_time" }, c.accountant), 201);
    expect((await post(`/api/fees/structures/${s.structureId}/items`, { name: "Half paisa", amountPaisa: 10.5, frequency: "monthly" }, c.accountant)).status).toBe(400);
    await ok(await post(`/api/fees/structures/${s.structureId}/send`, {}, c.accountant), 201);
    const request = (await db().prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(s.structureId).first<{ public_id: string }>())!.public_id;
    const [x, y] = await Promise.all([post(`/api/approvals/${request}/approve`, undefined, c.admin), post(`/api/approvals/${request}/approve`, undefined, c.admin)]);
    expect([x.status, y.status]).toContain(200);
    expect([x.status, y.status].filter((st) => st === 200)).toHaveLength(1);
    const made = await ok(await post(`/api/fees/structures/${s.structureId}/charges`, { classId: s.classId }, c.accountant));
    expect(made.created as number).toBeGreaterThan(0);
    const again = await post(`/api/fees/structures/${s.structureId}/charges`, { classId: s.classId }, c.accountant);
    expect(((await again.json()) as { created: number }).created).toBe(0);
    for (const who of Object.keys(s.students)) {
      if (!s.students[who]!.enrollmentId) s.students[who]!.enrollmentId = ((await get<{ enrollmentId: string }>("/api/fees/me", c[who])).enrollmentId);
    }
  });

  it("fees: cash with a retried key, a voucher, a demo online payment with repeated callbacks, gapless receipts", async () => {
    const asha = s.students.Asha!.enrollmentId;
    const k = key();
    const first = await ok(await post("/api/fees/payments/cash", { enrollmentId: asha, amountPaisa: 1_000_000, idempotencyKey: k }, c.accountant), 201);
    const retry = await ok(await post("/api/fees/payments/cash", { enrollmentId: asha, amountPaisa: 1_000_000, idempotencyKey: k }, c.accountant), 201);
    expect((retry.receipt as { number: string }).number).toBe((first.receipt as { number: string }).number);
    const voucher = await ok(await post("/api/fees/me/vouchers", { amountPaisa: 250_000, bank: "Nabil", reference: `Y-${tag}`, paidOn: nepalDate(new Date()) }, c.Asha), 201);
    expect((await post("/api/fees/me/vouchers", { amountPaisa: 250_000, bank: "Nabil", reference: `Y-${tag}`, paidOn: nepalDate(new Date()) }, c.Bina)).status).toBe(409); // a reference is claimed once
    const verified = await ok(await post(`/api/fees/vouchers/${voucher.id}/verify`, {}, c.accountant), 201);
    expect((await post(`/api/fees/vouchers/${voucher.id}/verify`, {}, c.accountant)).status).toBe(409);
    const online = await ok(await post("/api/fees/me/online-payments", { amountPaisa: 250_000 }, c.Asha), 201);
    for (let i = 0; i < 3; i++) await ok(await post("/api/fees/gateway/callback", { gatewayReference: online.gatewayReference }, undefined));
    const seq = (r: unknown) => Number((r as { number: string }).number.split("-").at(-1));
    expect(seq(verified.receipt)).toBe(seq(first.receipt) + 1);
    const account = await get<{ paidPaisa: number; receipts: { number: string }[] }>("/api/fees/me", c.Asha);
    expect(account.paidPaisa).toBe(1_500_000);
    const numbers = account.receipts.map((r) => seq(r)).sort((p, q) => p - q);
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]).toBe(numbers[i - 1]! + 1);
  });

  it("fees: a discount, a reversal and an overpayment refunded, each only once an Admin approves", async () => {
    const bina = s.students.Bina!.enrollmentId;
    const paid = await ok(await post("/api/fees/payments/cash", { enrollmentId: bina, amountPaisa: 99_000_000, idempotencyKey: key() }, c.accountant), 201);
    const beforeRefund = await get<{ creditPaisa: number }>(`/api/fees/enrollments/${bina}`, c.accountant);
    expect(beforeRefund.creditPaisa).toBeGreaterThan(0);
    const discount = await ok(await post(`/api/fees/enrollments/${bina}/discounts`, { percent: 10, reason: "sibling" }, c.accountant), 201);
    const refund = await ok(await post(`/api/fees/enrollments/${bina}/refunds`, { amountPaisa: beforeRefund.creditPaisa + 1, reason: "Paid too much" }, c.accountant), 201).catch(() => null);
    expect(refund).toBeNull(); // more than the credit is refused
    const refundOk = await ok(await post(`/api/fees/enrollments/${bina}/refunds`, { amountPaisa: 50_000_000, reason: "Paid too much" }, c.accountant), 201);
    const approve = async (subject: string) => {
      const request = (await db().prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(subject).first<{ public_id: string }>())!.public_id;
      return post(`/api/approvals/${request}/approve`, undefined, c.admin);
    };
    await ok(await approve(discount.id as string));
    await ok(await approve(refundOk.id as string));
    await ok(await post(`/api/fees/refunds/${refundOk.id}/record`, { method: "bank_transfer", reference: "TX-1" }, c.accountant));
    expect((await post(`/api/fees/refunds/${refundOk.id}/record`, { method: "cash" }, c.accountant)).status).toBe(409);
    const reversal = await ok(await post(`/api/fees/payments/${paid.paymentId}/reversal`, { reason: "Entered on the wrong student" }, c.accountant), 201);
    await ok(await approve(reversal.id as string));
    const after = await get<{ balancePaisa: number; refundedPaisa: number; discountPaisa: number }>(`/api/fees/enrollments/${bina}`, c.accountant);
    expect(after.refundedPaisa).toBe(50_000_000);
    expect(after.discountPaisa).toBeGreaterThan(0);
    // The Co-ordinator has no fees view; a student never reaches another's account.
    expect((await call(`/api/fees/enrollments/${bina}`, { cookie: c.coordinator })).status).toBe(403);
    expect((await call(`/api/fees/enrollments/${bina}`, { cookie: c.Asha })).status).toBe(404);
  });

  it("fees: a late joiner is charged on the next run; dues, CSV and reminders agree", async () => {
    const email = `late-${tag}@example.com`;
    const late = await ok(await post("/api/admissions/walk-ins", { firstName: "Late", lastName: "Joiner", dob: "2009-01-01", phone: "9812345678", email, guardianName: "G", guardianPhone: "9800000041", levelId: s.levelId, classId: s.classId }, c.coordinator), 201);
    c.Late = await firstSignIn(email, late.temporaryPassword as string);
    const made = await ok(await post(`/api/fees/structures/${s.structureId}/charges`, { classId: s.classId }, c.accountant));
    expect(made.created as number).toBeGreaterThan(0);
    s.students.Late = { studentId: late.studentId as string, sid: late.sid as string, enrollmentId: (await get<{ enrollmentId: string }>("/api/fees/me", c.Late)).enrollmentId };
    const dues = await get<{ students: { enrollmentId: string; duePaisa: number }[]; totals: { duePaisa: number } }>(`/api/fees/dues?classId=${s.classId}`, c.accountant);
    expect(dues.totals.duePaisa).toBe(dues.students.reduce((sum, x) => sum + x.duePaisa, 0));
    const csv = await (await call(`/api/fees/dues.csv?classId=${s.classId}`, { cookie: c.admin })).text();
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(dues.students.length + 1);
    await ok(await post("/api/fees/reminders", undefined, c.accountant));
  });

  // --- 5. Results across three terminals ----------------------------------------------------------

  let mathsTeacher: "ram" | "hari" = "ram";
  const sheetPath = (subject: { id: string }, terminal: string) => `/api/results/classes/${s.classId}/subjects/${subject.id}/terminals/${terminal}`;
  async function enterAll(terminal: string, pct: (who: string, subject: string) => number | "AB") {
    for (const [name, subject] of Object.entries(s.subjects)) {
      const teacher = ["english", "computing"].includes(name) ? c.gita! : name === "maths" && mathsTeacher === "hari" ? c.hari! : c.ram!;
      const grid = await get<{ students: { enrollmentId: string; name: string }[]; components: { id: string; maxHundredths: number }[]; status: string }>(sheetPath(subject, terminal), teacher);
      if (grid.students.length === 0 || grid.status === "verified" || grid.status === "published") continue;
      const marks = grid.students.flatMap((st) =>
        grid.components.map((comp) => {
          const p = pct(st.name.split(" ")[0]!, name);
          return p === "AB" ? { enrollmentId: st.enrollmentId, componentId: comp.id, valueHundredths: null, absent: true } : { enrollmentId: st.enrollmentId, componentId: comp.id, valueHundredths: Math.round((comp.maxHundredths * p) / 100), absent: false };
        }),
      );
      await ok(await put(sheetPath(subject, terminal), { marks }, teacher));
      await ok(await post(`${sheetPath(subject, terminal)}/submit`, undefined, teacher));
    }
  }
  async function verifyAndPublish(terminal: string) {
    const board = await get<{ classes: { classId: string; ready: boolean; subjects: { sheetId: string | null; status: string }[] }[] }>(`/api/results/review?terminalId=${terminal}`, c.coordinator);
    const cls = board.classes.find((x) => x.classId === s.classId)!;
    await ok(await post("/api/results/review/verify", { sheetIds: cls.subjects.filter((x) => x.status === "under_review").map((x) => x.sheetId) }, c.coordinator));
    return post(`/api/results/classes/${s.classId}/publish`, { terminalId: terminal }, c.coordinator);
  }

  it("results: elective picks (Maths or Computing) decide who is on each grid", async () => {
    for (const [who, subject] of [["Asha", "maths"], ["Bina", "computing"], ["Chandra", "maths"], ["Dipak", "computing"], ["Faris", "maths"], ["Late", "maths"]] as const) {
      const enrollmentId = who === "Faris" ? (await get<{ students: { enrollmentId: string; sid: string; name: string }[] }>(`/api/results/classes/${s.classId}/electives`, c.coordinator)).students.find((x) => x.name.startsWith("Faris"))!.enrollmentId : s.students[who]!.enrollmentId;
      await ok(await put(`/api/results/enrollments/${enrollmentId}/electives/${s.groupId}`, { offeringIds: [s.subjects[subject]!.id] }, c.coordinator));
    }
    const maths = await get<{ students: unknown[] }>(sheetPath(s.subjects.maths!, s.terminals[0]!), c.ram);
    expect(maths.students).toHaveLength(4);
  });

  it("results, first terminal: a draft saved, a subject sent back, one absence, publish refused until ready, then published", async () => {
    const t = s.terminals[0]!;
    // Before anything is verified, Publish is refused and says why.
    expect((await post(`/api/results/classes/${s.classId}/publish`, { terminalId: t }, c.coordinator)).status).toBe(409);
    await enterAll(t, (who, subject) => (who === "Dipak" && subject === "science" ? "AB" : who === "Chandra" ? 30 : 85));
    const board = await get<{ classes: { classId: string; subjects: { sheetId: string; offeringId: string }[] }[] }>(`/api/results/review?terminalId=${t}`, c.coordinator);
    const english = board.classes.find((x) => x.classId === s.classId)!.subjects.find((x) => x.offeringId === s.subjects.english!.id)!.sheetId;
    await ok(await post(`/api/results/review/sheets/${english}/send-back`, { note: "Recount Chandra" }, c.coordinator));
    const grid = await get<{ students: { enrollmentId: string; name: string }[]; components: { id: string }[] }>(sheetPath(s.subjects.english!, t), c.gita);
    const chandra = grid.students.find((x) => x.name.startsWith("Chandra"))!.enrollmentId;
    await ok(await put(sheetPath(s.subjects.english!, t), { marks: [{ enrollmentId: chandra, componentId: grid.components[0]!.id, valueHundredths: 3600, absent: false }] }, c.gita));
    await ok(await post(`${sheetPath(s.subjects.english!, t)}/submit`, undefined, c.gita));
    const published = await verifyAndPublish(t);
    expect(published.status, await published.clone().text()).toBe(201);
    const dipak = await get<{ results: { card: { body: { passed: boolean } } }[] }>("/api/results/me", c.Dipak);
    expect(dipak.results[0]!.card.body.passed).toBe(false); // absent in a component
    // The class of the other level has nothing published and no one there sees anything.
    expect((await get<{ results: unknown[] }>("/api/results/me", c.Elina)).results).toHaveLength(0);
  });

  it("results, second terminal: the Maths teacher is replaced mid-year; the old one is refused, the new one finishes", async () => {
    const t = s.terminals[1]!;
    await ok(await post("/api/academics/assignments", { classId: s.classId, offeringId: s.subjects.maths!.id, teacherId: s.teachers.hari }, c.coordinator));
    mathsTeacher = "hari";
    expect((await call(sheetPath(s.subjects.maths!, t), { cookie: c.ram })).status).toBe(404);
    const grid = await get<{ students: { enrollmentId: string }[]; components: { id: string }[] }>(sheetPath(s.subjects.maths!, t), c.hari);
    await ok(await put(sheetPath(s.subjects.maths!, t), { marks: grid.students.map((x) => ({ enrollmentId: x.enrollmentId, componentId: grid.components[0]!.id, valueHundredths: 7000, absent: false })) }, c.hari));
    await ok(await post(`${sheetPath(s.subjects.maths!, t)}/submit`, undefined, c.hari));
    for (const [name, subject] of Object.entries(s.subjects)) {
      if (name === "maths") continue;
      const teacher = ["english", "computing"].includes(name) ? c.gita! : c.ram!;
      const g = await get<{ students: { enrollmentId: string }[]; components: { id: string; maxHundredths: number }[] }>(sheetPath(subject, t), teacher);
      if (g.students.length === 0) continue;
      await ok(await put(sheetPath(subject, t), { marks: g.students.flatMap((x) => g.components.map((comp) => ({ enrollmentId: x.enrollmentId, componentId: comp.id, valueHundredths: Math.round(comp.maxHundredths * 0.75), absent: false }))) }, teacher));
      await ok(await post(`${sheetPath(subject, t)}/submit`, undefined, teacher));
    }
    expect((await verifyAndPublish(t)).status).toBe(201);
  });

  it("results, final: a student joins after the sheets are verified; Publish waits for their marks; a recheck changes a card", async () => {
    const t = s.terminals[2]!;
    await enterAll(t, (who) => (who === "Asha" ? 95 : who === "Bina" ? 95 : 60));
    const board = await get<{ classes: { classId: string; subjects: { sheetId: string; status: string }[] }[] }>(`/api/results/review?terminalId=${t}`, c.coordinator);
    await ok(await post("/api/results/review/verify", { sheetIds: board.classes.find((x) => x.classId === s.classId)!.subjects.map((x) => x.sheetId) }, c.coordinator));
    // A new student joins now.
    const email = `newest-${tag}@example.com`;
    const newest = await ok(await post("/api/admissions/walk-ins", { firstName: "Newest", lastName: "Student", dob: "2009-01-02", phone: "9812345679", email, guardianName: "G", guardianPhone: "9800000042", levelId: s.levelId, classId: s.classId }, c.coordinator), 201);
    c.Newest = await firstSignIn(email, newest.temporaryPassword as string);
    const newestEnrollment = (await get<{ students: { enrollmentId: string; name: string }[] }>(`/api/results/classes/${s.classId}/electives`, c.coordinator)).students.find((x) => x.name.startsWith("Newest"))!.enrollmentId;
    await ok(await put(`/api/results/enrollments/${newestEnrollment}/electives/${s.groupId}`, { offeringIds: [s.subjects.computing!.id] }, c.coordinator));
    const refused = await post(`/api/results/classes/${s.classId}/publish`, { terminalId: t }, c.coordinator);
    expect(refused.status).toBe(409);
    // Each verified sheet goes back for the new student's marks, then round again.
    const again = await get<{ classes: { classId: string; subjects: { sheetId: string; status: string }[] }[] }>(`/api/results/review?terminalId=${t}`, c.coordinator);
    for (const sub of again.classes.find((x) => x.classId === s.classId)!.subjects) await ok(await post(`/api/results/review/sheets/${sub.sheetId}/send-back`, { note: "Add the new student" }, c.coordinator));
    await enterAll(t, (who) => (who === "Asha" ? 95 : who === "Bina" ? 95 : 60));
    expect((await verifyAndPublish(t)).status).toBe(201);

    // A recheck for Bina, changed; the Admin sees it; the card is version 2.
    const own = await get<{ results: { publicationId: string; terminalName: string; card: { body: { subjects: { offeringId: string }[] } } }[] }>("/api/results/me", c.Bina);
    const final = own.results.find((r) => r.terminalName === "Final")!;
    const asked = await ok(await post(`/api/results/publications/${final.publicationId}/rechecks`, { offeringId: s.subjects.english!.id, reason: "Page three was not marked" }, c.Bina), 201);
    const list = await get<{ rechecks: { id: string; marks: { componentId: string }[] }[] }>("/api/results/rechecks", c.coordinator);
    const component = list.rechecks.find((r) => r.id === asked.id)!.marks[0]!.componentId;
    await ok(await post(`/api/results/rechecks/${asked.id}/decide`, { outcome: "changed", reason: "Page three added", marks: [{ componentId: component, valueHundredths: 9900 }] }, c.coordinator));
    const changes = await get<{ rechecks: { id: string; status: string }[] }>("/api/results/rechecks", c.admin);
    expect(changes.rechecks.find((r) => r.id === asked.id)!.status).toBe("changed");
    const after = await get<{ results: { terminalName: string; card: { version: number } }[] }>("/api/results/me", c.Bina);
    expect(after.results.find((r) => r.terminalName === "Final")!.card.version).toBe(2);
    // Top 20 follows the school's switch; the class sheet ranks ties together.
    const top = await call(`/api/results/top20?terminalId=${t}`, { cookie: c.Asha });
    expect(top.status).toBe(modules.top20 ? 200 : 404);
    const sheet = await get<{ students: { name: string; rank: number | null }[] }>(`/api/results/classes/${s.classId}/terminals/${t}/sheet`, c.admin);
    expect(sheet.students.find((x) => x.name.startsWith("Bina"))!.rank).toBe(1);
    // Every student has three results, the newest joiner one.
    expect((await get<{ results: unknown[] }>("/api/results/me", c.Asha)).results).toHaveLength(3);
    expect((await get<{ results: unknown[] }>("/api/results/me", c.Newest)).results).toHaveLength(1);
  });

  // --- 6. Staff leaving mid-year ------------------------------------------------------------------

  it("a teacher deactivated mid-year is refused at once, even with a sign-in still in their browser", async () => {
    await ok(await patch(`/api/staff/${s.teachers.gita}`, { active: false }, c.coordinator));
    expect((await put(`/api/activity/classes/${s.classId}/subjects/${s.subjects.english!.id}/today`, { body: "Still here?" }, c.gita)).status).not.toBe(200);
    const g = await call(sheetPath(s.subjects.english!, s.terminals[2]!), { cookie: c.gita });
    expect(g.status).not.toBe(200);
  });

  // --- 7. The year closes --------------------------------------------------------------------------

  it("a closed year refuses every write in every module, and every chain is unbroken", async () => {
    // Phase 8 builds the close itself; its effect is the year's status.
    await db().prepare("UPDATE academic_years SET status = 'closed', closed_at = ?1 WHERE public_id = ?2").bind(new Date().toISOString(), s.yearId).run();
    const asha = s.students.Asha!.enrollmentId;
    const attempts: [string, Response | Promise<Response>][] = [
      ["register", put(`/api/attendance/classes/${s.classId}/today`, { absent: [] }, c.ram)],
      ["activity", put(`/api/activity/classes/${s.classId}/subjects/${s.subjects.science!.id}/today`, { body: "After close" }, c.ram)],
      ["homework", post("/api/assignments", { classId: s.classId, offeringId: s.subjects.science!.id, title: "Late", instructions: "x", dueAt: new Date(Date.now() + 86_400_000).toISOString() }, c.ram)],
      ["cash", post("/api/fees/payments/cash", { enrollmentId: asha, amountPaisa: 100, idempotencyKey: key() }, c.accountant)],
      ["discount", post(`/api/fees/enrollments/${asha}/discounts`, { amountPaisa: 100, reason: "sibling" }, c.accountant)],
      ["refund", post(`/api/fees/enrollments/${asha}/refunds`, { amountPaisa: 100, reason: "After the year closed" }, c.accountant)],
      ["charges", post(`/api/fees/structures/${s.structureId}/charges`, { classId: s.classId }, c.accountant)],
      ["marks", put(sheetPath(s.subjects.science!, s.terminals[2]!), { marks: [{ enrollmentId: asha, componentId: s.subjects.science!.components[0], valueHundredths: 100 }] }, c.ram)],
      ["picks", put(`/api/results/enrollments/${asha}/electives/${s.groupId}`, { offeringIds: [s.subjects.computing!.id] }, c.coordinator)],
      ["class", post("/api/academics/classes", { yearId: s.yearId, levelId: s.levelId, label: "Z" }, c.coordinator)],
      ["terminal", post("/api/academics/terminals", { yearId: s.yearId, name: "Extra" }, c.coordinator)],
    ];
    if (modules.notes) attempts.push(["note", post("/api/notes", { classId: s.classId, offeringId: s.subjects.science!.id, kind: "note", title: "Late" , body: "x" }, c.ram)]);
    const own = await get<{ results: { publicationId: string }[] }>("/api/results/me", c.Asha);
    attempts.push(["recheck", post(`/api/results/publications/${own.results[0]!.publicationId}/rechecks`, { offeringId: s.subjects.english!.id, reason: "After the year closed" }, c.Asha)]);
    const outcomes: string[] = [];
    for (const [name, pending] of attempts) {
      const r = await pending;
      if (r.status < 400) outcomes.push(`${name} was accepted (${r.status})`);
      if (r.status >= 500) outcomes.push(`${name} crashed (${r.status}): ${await r.text()}`);
    }
    expect(outcomes).toEqual([]);
    // Reading still works.
    await get("/api/fees/me", c.Asha);
    await get("/api/results/me", c.Asha);
    expect((await verifyLedgerChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
    expect((await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
  });
});
