import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";

const TEMP_FORMAT = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;

let admin: Person, coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  admin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

const send = (method: string, path: string, body: unknown, who?: Person) => call(path, { method, body, ...(who ? { cookie: who.cookie } : {}) });
const get = (path: string, who?: Person) => call(path, who ? { cookie: who.cookie } : {});
let n = 0;
const email = (label: string) => `${label}-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
const staffBody = (over: Record<string, unknown> = {}) => ({ fullName: "Sita Sharma", email: email("staff"), role: "coordinator", ...over });
const teacherBody = (over: Record<string, unknown> = {}) => ({ fullName: "Ram Karki", email: email("teacher"), homeSectionKey: "plus2", ...over });
const noId = "0".repeat(32);

interface Made {
  id: string;
  temporaryPassword: string;
}
async function makeTeacher(who: Person = coordinator, section = "plus2", body: Record<string, unknown> = {}): Promise<Made & { email: string }> {
  const payload = teacherBody({ homeSectionKey: section, ...body });
  const response = await send("POST", "/api/teachers", payload, who);
  expect(response.status).toBe(201);
  return { ...((await response.json()) as Made), email: payload.email as string };
}
async function makeStaff(who: Person = admin, body: Record<string, unknown> = {}): Promise<Made & { email: string }> {
  const payload = staffBody(body);
  const response = await send("POST", "/api/staff", payload, who);
  expect(response.status).toBe(201);
  return { ...((await response.json()) as Made), email: payload.email as string };
}

const reads: [string, string][] = [["GET", "/api/staff"]];
const writes: [string, string, unknown][] = [
  ["POST", "/api/staff", staffBody()],
  ["POST", "/api/teachers", teacherBody()],
  ["PATCH", `/api/staff/${noId}`, { active: false }],
  ["POST", `/api/staff/${noId}/temporary-password`, undefined],
];

// ---------------------------------------------------------------------------------------------
describe("who may use the staff routes", () => {
  it("nobody who is signed out: 401 everywhere, and a garbage body is not even looked at", async () => {
    for (const [method, path] of reads) expect((await send(method, path, undefined)).status, path).toBe(401);
    for (const [method, path, body] of writes) expect((await send(method, path, body)).status, `${method} ${path}`).toBe(401);
    expect((await send("POST", "/api/staff", { nonsense: true })).status).toBe(401);
  });

  it("students, teachers and accountants: 403 everywhere, and nobody is created", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM users");
    for (const who of [student, teacher, accountant]) {
      for (const [method, path] of reads) expect((await send(method, path, undefined, who)).status, path).toBe(403);
      for (const [method, path, body] of writes) expect((await send(method, path, body, who)).status, `${method} ${path}`).toBe(403);
    }
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
  });

  it("the Admin may list, add Co-ordinators and Accountants, and manage them, but not teachers", async () => {
    expect((await get("/api/staff", admin)).status).toBe(200);
    const coo = await makeStaff(admin);
    await makeStaff(admin, { role: "accountant", sectionKey: "plus2" });
    expect((await send("POST", "/api/teachers", teacherBody(), admin)).status).toBe(403);
    expect((await send("PATCH", `/api/staff/${coo.id}`, { active: false }, admin)).status).toBe(200);
    expect((await send("POST", `/api/staff/${coo.id}/temporary-password`, undefined, admin)).status).toBe(200);
    const tea = await makeTeacher(coordinator);
    expect((await send("PATCH", `/api/staff/${tea.id}`, { active: false }, admin)).status).toBe(403);
    expect((await send("POST", `/api/staff/${tea.id}/temporary-password`, undefined, admin)).status).toBe(403);
  });

  it("a Co-ordinator may list and add teachers and manage them, but not add or manage Co-ordinators", async () => {
    expect((await get("/api/staff", coordinator)).status).toBe(200);
    const tea = await makeTeacher(coordinator);
    expect((await send("POST", "/api/staff", staffBody(), coordinator)).status).toBe(403);
    expect((await send("PATCH", `/api/staff/${tea.id}`, { active: false }, coordinator)).status).toBe(200);
    const coo = await makeStaff(admin);
    expect((await send("PATCH", `/api/staff/${coo.id}`, { active: false }, coordinator)).status).toBe(403);
    expect((await send("POST", `/api/staff/${coo.id}/temporary-password`, undefined, coordinator)).status).toBe(403);
  });

  it("the Super Admin may do all of it, and nobody switches off themselves (403)", async () => {
    expect((await get("/api/staff", superAdmin)).status).toBe(200);
    await makeStaff(superAdmin);
    await makeTeacher(superAdmin);
    expect((await send("PATCH", `/api/staff/${superAdmin.publicId}`, { active: false }, superAdmin)).status).toBe(403);
    expect((await send("PATCH", `/api/staff/${admin.publicId}`, { active: false }, admin)).status).toBe(403);
  });

  it("a switched-off Admin with a valid sign-in is refused (403), not served from the token", async () => {
    const off = await person("admin", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = await count("SELECT COUNT(*) AS n FROM users");
    expect((await send("POST", "/api/staff", staffBody(), off)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the secrets", () => {
  it("a new person's temporary password comes back once, never cached, in the documented shape", async () => {
    const response = await send("POST", "/api/staff", staffBody(), admin);
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as Made;
    expect(body.temporaryPassword).toMatch(TEMP_FORMAT);
    expect(Object.keys(body).sort()).toEqual(["id", "temporaryPassword"]);
  });

  it("a new temporary password is never cached either", async () => {
    const tea = await makeTeacher();
    const response = await send("POST", `/api/staff/${tea.id}/temporary-password`, undefined, coordinator);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { temporaryPassword: string };
    expect(body.temporaryPassword).toMatch(TEMP_FORMAT);
    expect(body.temporaryPassword).not.toBe(tea.temporaryPassword);
  });

  it("the list is never cached, says who has not signed in yet, and carries no password, hash or secret", async () => {
    const tea = await makeTeacher();
    const response = await get("/api/staff", coordinator);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    const keys = new Set<string>();
    JSON.parse(text, (key, value) => (keys.add(key), value));
    expect([...keys].filter((key) => /hash|secret|temporary|^password/i.test(key))).toEqual([]);
    expect(text).not.toContain(tea.temporaryPassword);
    const list = JSON.parse(text) as { staff: { id: string; mustChangePassword: boolean; homeSection: string | null }[] };
    expect(list.staff.find((s) => s.id === tea.id)).toMatchObject({ mustChangePassword: true, homeSection: "plus2" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("the whole flow, from the outside", () => {
  it("create, sign in with the temporary password, choose your own, get switched off, get switched on", async () => {
    const tea = await makeTeacher(coordinator, "plus2");

    // 1. The temporary password gives only a step, no session.
    const first = await call("/api/auth/sign-in", { method: "POST", body: { email: tea.email, password: tea.temporaryPassword } });
    expect(first.status).toBe(200);
    const step = (await first.json()) as { passwordChange?: string; challenge?: string };
    expect(step.passwordChange).toBe("required");
    expect(first.headers.getSetCookie()).toEqual([]);

    // 2. Choosing a password gives the session.
    const chosen = "Mango-Sunrise-Harbour-4471";
    const changed = await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password: chosen } });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ user: { email: tea.email }, roles: [{ role: "teacher", scope: "assigned" }] });
    const listed = (await (await get("/api/staff", coordinator)).json()) as { staff: { id: string; mustChangePassword: boolean }[] };
    expect(listed.staff.find((s) => s.id === tea.id)!.mustChangePassword).toBe(false);

    // 3. Switched off: cannot sign in.
    expect((await send("PATCH", `/api/staff/${tea.id}`, { active: false }, coordinator)).status).toBe(200);
    expect((await call("/api/auth/sign-in", { method: "POST", body: { email: tea.email, password: chosen } })).status).toBe(401);

    // 4. Switched on again: can.
    expect((await send("PATCH", `/api/staff/${tea.id}`, { active: true }, coordinator)).status).toBe(200);
    expect((await call("/api/auth/sign-in", { method: "POST", body: { email: tea.email, password: chosen } })).status).toBe(200);
  });

  it("a forgotten password: a new temporary one locks out the old, and forces a change again", async () => {
    const coo = await makeStaff(admin);
    const chosen = "Mango-Sunrise-Harbour-4471";
    const step = (await (await call("/api/auth/sign-in", { method: "POST", body: { email: coo.email, password: coo.temporaryPassword } })).json()) as { challenge: string };
    expect((await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password: chosen } })).status).toBe(200);

    const issued = (await (await send("POST", `/api/staff/${coo.id}/temporary-password`, undefined, admin)).json()) as { temporaryPassword: string };
    expect((await call("/api/auth/sign-in", { method: "POST", body: { email: coo.email, password: chosen } })).status).toBe(401);
    const again = await call("/api/auth/sign-in", { method: "POST", body: { email: coo.email, password: issued.temporaryPassword } });
    expect(await again.json()).toMatchObject({ passwordChange: "required" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("a section-scoped Co-ordinator gets nothing from the other section (data-level)", () => {
  it("does not see the other section's teachers in the list", async () => {
    const mine = await makeTeacher(coordinator, "plus2");
    const theirs = await makeTeacher(coordinator, "bachelors");
    const seen = async (who: Person) => ((await (await get("/api/staff", who)).json()) as { staff: { id: string }[] }).staff.map((s) => s.id);
    expect(await seen(plus2Coordinator)).toContain(mine.id);
    expect(await seen(plus2Coordinator)).not.toContain(theirs.id);
    expect(await seen(bachelorsCoordinator)).toContain(theirs.id);
    expect(await seen(bachelorsCoordinator)).not.toContain(mine.id);
    expect(await seen(coordinator)).toEqual(expect.arrayContaining([mine.id, theirs.id]));
  });

  it("cannot add to, switch off, or re-password the other section's teachers, even with the right id", async () => {
    const theirs = await makeTeacher(coordinator, "bachelors");
    const before = await count("SELECT COUNT(*) AS n FROM users");
    expect((await send("POST", "/api/teachers", teacherBody({ homeSectionKey: "bachelors" }), plus2Coordinator)).status).toBe(403);
    expect((await send("PATCH", `/api/staff/${theirs.id}`, { active: false }, plus2Coordinator)).status).toBe(403);
    expect((await send("POST", `/api/staff/${theirs.id}/temporary-password`, undefined, plus2Coordinator)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
    expect(await db.prepare("SELECT is_active FROM users WHERE public_id = ?1").bind(theirs.id).first()).toEqual({ is_active: 1 });
    expect((await send("POST", "/api/teachers", teacherBody({ homeSectionKey: "plus2" }), plus2Coordinator)).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------
describe("status codes for the failure cases", () => {
  it("400 for a bad shape, 409 for an email that is taken, 404 for an unknown person, 404 for an unknown section", async () => {
    expect((await send("POST", "/api/staff", { fullName: "x" }, admin)).status).toBe(400);
    expect((await send("POST", "/api/staff", staffBody({ role: "teacher" }), admin)).status).toBe(400);
    expect((await send("POST", "/api/staff", staffBody({ password: "hunter2hunter2" }), admin)).status).toBe(400);
    expect((await send("PATCH", `/api/staff/${noId}`, { nonsense: 1 }, admin)).status).toBe(400);

    const made = await makeStaff(admin);
    const repeat = await send("POST", "/api/staff", staffBody({ email: made.email.toUpperCase() }), admin);
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toEqual({ error: "email_taken" });

    expect((await send("PATCH", `/api/staff/${noId}`, { active: false }, admin)).status).toBe(404);
    expect((await send("POST", `/api/staff/${noId}/temporary-password`, undefined, admin)).status).toBe(404);
    expect((await send("POST", "/api/teachers", teacherBody({ homeSectionKey: "nowhere" }), coordinator)).status).toBe(404);
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
