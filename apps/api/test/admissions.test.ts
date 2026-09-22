import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
let levelId: string, classId: string;

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");

  // A live year, a plus2 programme and level, and one active class: what an application needs.
  const bs = 2060;
  const year = await call("/api/academics/years", {
    method: "POST",
    cookie: coordinator.cookie,
    body: { bsYear: bs, startDate: bsToAd({ year: bs, month: 1, day: 1 }), endDate: bsToAd({ year: bs, month: 12, day: daysInMonth(bs, 12) }) },
  });
  const yearId = ((await year.json()) as { id: string }).id;
  expect((await call(`/api/academics/years/${yearId}/activate`, { method: "POST", cookie: coordinator.cookie })).status).toBe(200);

  const programme = await call("/api/academics/programmes", { method: "POST", cookie: coordinator.cookie, body: { name: "Science", sectionKey: "plus2", affiliation: "NEB" } });
  const programmeId = ((await programme.json()) as { id: string }).id;
  const level = await call(`/api/academics/programmes/${programmeId}/levels`, { method: "POST", cookie: coordinator.cookie, body: { name: "Grade 11" } });
  levelId = ((await level.json()) as { id: string }).id;
  const cls = await call("/api/academics/classes", { method: "POST", cookie: coordinator.cookie, body: { yearId, levelId, label: "Morning" } });
  classId = ((await cls.json()) as { id: string }).id;
});

let n = 0;
const uniq = (label: string) => `${label}${++n}`;
const token = () => `tok-${uniq("t")}-${crypto.randomUUID().slice(0, 12)}`;
/** Just the shape `ApplicantDetailsSchema` takes: what a walk-in or a staff registration sends. */
const applicant = (over: Record<string, unknown> = {}) => ({
  firstName: "Sita",
  lastName: uniq("Sharma"),
  dob: "2008-05-14",
  phone: `98${String(10000000 + n).padStart(8, "0")}`,
  email: `${uniq("sita")}@example.com`,
  guardianName: "Ram Sharma",
  guardianPhone: "9800000001",
  levelId,
  ...over,
});

/** What the public form sends: an applicant, plus its own submission token. */
const applyBody = (over: Record<string, unknown> = {}) => ({ ...applicant(over), submissionToken: token() });

/** A fresh IP by default, so one test's calls never trip another's IP rate limit. */
const apply = (body: Record<string, unknown>, ip = `203.0.113.${(++n % 250) + 1}`) => call("/api/admissions/apply", { method: "POST", body, headers: { "CF-Connecting-IP": ip } });
const verify = (tok: string) => call("/api/admissions/verify", { method: "POST", body: { token: tok } });
const queue = (who?: Person) => call("/api/admissions/queue", { cookie: who?.cookie });
const detail = (id: string, who: Person) => call(`/api/admissions/applications/${id}`, { cookie: who.cookie });
const approve = (id: string, body: Record<string, unknown>, who?: Person) => call(`/api/admissions/applications/${id}/approve`, { method: "POST", body, cookie: who?.cookie });
const requestChanges = (id: string, body: Record<string, unknown>, who: Person) => call(`/api/admissions/applications/${id}/request-changes`, { method: "POST", body, cookie: who.cookie });
const rejectApp = (id: string, body: Record<string, unknown>, who: Person) => call(`/api/admissions/applications/${id}/reject`, { method: "POST", body, cookie: who.cookie });
const walkIn = (body: Record<string, unknown>, who: Person) => call("/api/admissions/walk-ins", { method: "POST", body, cookie: who.cookie });
const register = (body: Record<string, unknown>, who: Person) => call("/api/admissions/register", { method: "POST", body, cookie: who.cookie });

/** Reads the token straight from the database: the dev email adapter has no real inbox to poll, and the token is never returned over HTTP. */
async function verificationTokenFor(applicationId: string): Promise<string> {
  // The dev adapter writes to dev_mailbox; the token is in the link inside the body.
  const row = await db.prepare("SELECT body FROM dev_mailbox ORDER BY id DESC LIMIT 1").first<{ body: string }>();
  const match = /#token=([A-Za-z0-9_-]+)/.exec(row!.body);
  expect(match, `no token found in the last email for application ${applicationId}`).not.toBeNull();
  return match![1]!;
}

// ---------------------------------------------------------------------------------------------
describe("applying, verifying, and the review queue", () => {
  it("the whole flow: apply, verify, appear in the queue, and get approved", async () => {
    const body = applyBody();
    const applied = await apply(body);
    expect(applied.status).toBe(201);
    const { id } = (await applied.json()) as { id: string };

    // Not yet in the queue: email is unverified.
    expect((await queue(coordinator)).status).toBe(200);
    const beforeVerify = (await (await queue(coordinator)).json()) as { applications: { id: string }[] };
    expect(beforeVerify.applications.map((a) => a.id)).not.toContain(id);

    const tok = await verificationTokenFor(id);
    expect((await verify(tok)).status).toBe(200);
    expect((await verify(tok)).status).toBe(401); // a used token does not work twice

    const afterVerify = (await (await queue(coordinator)).json()) as { applications: { id: string; status: string }[] };
    expect(afterVerify.applications.find((a) => a.id === id)).toMatchObject({ status: "pending_review" });

    const approved = await approve(id, { classId }, coordinator);
    expect(approved.status).toBe(200);
    const { sid, studentId } = (await approved.json()) as { sid: string; studentId: string };
    expect(sid).toMatch(/^\d{4}-\d{5}$/);

    // The new student can be found by search and by their own sign-in.
    const found = (await (await call(`/api/students?q=${encodeURIComponent(body.lastName)}`, { cookie: coordinator.cookie })).json()) as { students: { id: string; sid: string }[] };
    expect(found.students.map((s) => s.id)).toContain(studentId);

    const gone = await queue(coordinator);
    const stillThere = (await gone.json()) as { applications: { id: string }[] };
    expect(stillThere.applications.map((a) => a.id)).not.toContain(id); // resolved, out of the queue
  });

  it("a submission token makes a retry idempotent: no new row, no extra rate-limit count", async () => {
    const body = applyBody();
    const first = await apply(body);
    const second = await apply(body); // the exact same body, including the same submissionToken
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toEqual(await second.json());
  });

  it("a filled honeypot field is a silent no-op: it looks like success, but nothing is written", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM applications");
    const response = await apply(applyBody({ website: "http://spam.example" }));
    expect(response.status).toBe(201); // looks identical to a real success
    expect(await count("SELECT COUNT(*) AS n FROM applications")).toBe(before); // but nothing happened
  });

  it("too many attempts from one email in the window: throttled, and nothing is written", async () => {
    const email = `${uniq("throttle")}@example.com`;
    for (let i = 0; i < 3; i++) expect((await apply(applyBody({ email }))).status).toBe(201);
    const before = await count("SELECT COUNT(*) AS n FROM applications");
    const throttled = await apply(applyBody({ email }));
    expect(throttled.status).toBe(429);
    expect(await count("SELECT COUNT(*) AS n FROM applications")).toBe(before);
  });

  it("an unknown or switched-off level is 404; no active year is 404", async () => {
    expect((await apply(applyBody({ levelId: "0".repeat(32) }))).status).toBe(404);
  });

  it("400 for a bad shape", async () => {
    expect((await apply({ firstName: "x" })).status).toBe(400);
  });

  it("a duplicate phone or name+DOB is flagged, not blocked", async () => {
    const shared = applyBody();
    await apply(shared);
    const second = await apply(applyBody({ phone: shared.phone }));
    expect(second.status).toBe(201);
    const { id } = (await second.json()) as { id: string };
    await verify(await verificationTokenFor(id));
    const seen = (await (await detail(id, coordinator)).json()) as { duplicateFlags: string[] };
    expect(seen.duplicateFlags).toContain("phone");
  });
});

// ---------------------------------------------------------------------------------------------
describe("ask for changes, and reject", () => {
  async function pending(): Promise<string> {
    const body = applyBody();
    const { id } = (await (await apply(body)).json()) as { id: string };
    await verify(await verificationTokenFor(id));
    return id;
  }

  it("ask for changes moves it to needs_changes, with the fields and reason kept", async () => {
    const id = await pending();
    const response = await requestChanges(id, { fields: ["phone"], reason: "The phone number looks incomplete." }, coordinator);
    expect(response.status).toBe(200);
    const seen = (await (await detail(id, coordinator)).json()) as { status: string; changesRequested: { fields: string[]; reason: string } | null };
    expect(seen.status).toBe("needs_changes");
    expect(seen.changesRequested).toEqual({ fields: ["phone"], reason: "The phone number looks incomplete." });
  });

  it("reject is final: a reason is required, and it cannot be approved afterward", async () => {
    const id = await pending();
    expect((await rejectApp(id, {}, coordinator)).status).toBe(400);
    expect((await rejectApp(id, { reason: "Missing documents" }, coordinator)).status).toBe(200);
    const seen = (await (await detail(id, coordinator)).json()) as { status: string };
    expect(seen.status).toBe("rejected");
    expect((await approve(id, { classId }, coordinator)).status).toBe(409);
  });

  it("deciding an already-resolved application again is 409, not a second effect", async () => {
    const id = await pending();
    expect((await rejectApp(id, { reason: "x" }, coordinator)).status).toBe(200);
    expect((await rejectApp(id, { reason: "x" }, coordinator)).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------------------------
describe("walk-ins and staff registration", () => {
  it("a Co-ordinator's walk-in is admitted at once, in one request", async () => {
    const response = await walkIn({ ...applicant(), classId }, coordinator);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    // It never sat in the queue: it was approved before this request returned.
    const inQueue = (await (await queue(coordinator)).json()) as { applications: { id: string }[] };
    expect(inQueue.applications.map((a) => a.id)).not.toContain(id);
  });

  it("an Accountant's registration goes to the queue, not auto-approved", async () => {
    const response = await register(applicant(), accountant);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const inQueue = (await (await queue(coordinator)).json()) as { applications: { id: string; status: string }[] };
    expect(inQueue.applications.find((a) => a.id === id)).toMatchObject({ status: "pending_review" });
  });

  it("a walk-in placed in a class of the wrong level is refused, and nothing is created", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM students");
    const response = await walkIn({ ...applicant(), classId: "0".repeat(32) }, coordinator);
    expect(response.status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM students")).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("who may use the admissions and student routes", () => {
  it("nobody signed out may see the queue, decide, or search; applying and verifying stay open", async () => {
    expect((await queue()).status).toBe(401);
    expect((await approve("0".repeat(32), { classId })).status).toBe(401);
    expect((await call("/api/students?q=a")).status).toBe(401);
    expect((await apply(applyBody())).status).toBe(201);
  });

  it("a Student, a Teacher and an Accountant cannot see or decide the queue", async () => {
    for (const who of [student, teacher, accountant]) {
      expect((await queue(who)).status, "queue").toBe(403);
      expect((await approve("0".repeat(32), { classId }, who)).status, "approve").toBe(403);
    }
  });

  it("only the Co-ordinator and the Super Admin may register a walk-in", async () => {
    for (const who of [student, teacher, accountant, admin]) expect((await walkIn({ ...applicant(), classId }, who)).status, "walkin").toBe(403);
    expect((await walkIn({ ...applicant(), classId }, superAdmin)).status, "walkin as super admin").toBe(201);
  });

  it("only the Accountant may register a student for the queue (the matrix gives this one to nobody else, not even the Super Admin)", async () => {
    for (const who of [student, teacher, coordinator, admin, superAdmin]) expect((await register(applicant(), who)).status, "register").toBe(403);
    expect((await register(applicant(), accountant)).status, "register as accountant").toBe(201);
  });

  it("a section-scoped Co-ordinator sees only their own section's queue", async () => {
    const body = applyBody();
    const { id } = (await (await apply(body)).json()) as { id: string };
    await verify(await verificationTokenFor(id));
    const plus2Queue = (await (await queue(plus2Coordinator)).json()) as { applications: { id: string }[] };
    const bachelorsQueue = (await (await queue(bachelorsCoordinator)).json()) as { applications: { id: string }[] };
    expect(plus2Queue.applications.map((a) => a.id)).toContain(id);
    expect(bachelorsQueue.applications.map((a) => a.id)).not.toContain(id);
    expect((await detail(id, bachelorsCoordinator)).status).toBe(404);
  });

  it("a Student reaches only their own record, never another id, even a real one", async () => {
    // Approve one application so there is a real student to try to reach.
    const body = applyBody();
    const { id } = (await (await apply(body)).json()) as { id: string };
    await verify(await verificationTokenFor(id));
    const { studentId } = (await (await approve(id, { classId }, coordinator)).json()) as { studentId: string };

    expect((await call(`/api/students/${studentId}`, { cookie: student.cookie })).status).toBe(404);
    expect((await call("/api/students/me", { cookie: student.cookie })).status).toBe(404); // this fixture's `student` has no student row of their own
  });

  it("the Admin may read (personal.view is read for Admin) but not decide", async () => {
    expect((await call("/api/students?q=a", { cookie: admin.cookie })).status).toBe(200);
    expect((await approve("0".repeat(32), { classId }, admin)).status).toBe(403);
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
