import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { verifyPassword } from "../src/core/passwords";
import { createUser } from "../src/modules/accounts/service";
import { createStaff, createTeacher, issueTemporaryPassword, listStaff, setStaffActive } from "../src/modules/accounts/service";
import { newSession, signIn } from "../src/modules/auth/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";
import { env } from "cloudflare:test";

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

const users = () => count("SELECT COUNT(*) AS n FROM users");
const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");
let n = 0;
const email = (label = "new") => `${label}-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
const staffInput = (over: Record<string, unknown> = {}) => ({ fullName: "Sita Sharma", email: email(), role: "coordinator", ...over });
const teacherInput = (over: Record<string, unknown> = {}) => ({ fullName: "Ram Karki", email: email("teacher"), homeSectionKey: "plus2", ...over });

const ok = <T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(`setup failed (${what}): ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
};
const newTeacher = async (who: Person = coordinator, section = "plus2") => ok(await createTeacher(db, auditKey, who.publicId, teacherInput({ homeSectionKey: section })), "teacher");

/** A person with a known ordinary password (not flagged), for tests that sign in. */
async function known(role: string, scope = "institution", section?: string) {
  const address = email(role);
  const { publicId } = await createUser(db, auditKey, { email: address, password: "blue-river-lamp-2083", fullName: `${role} known`, roles: [{ role: role as never, scope: scope as never, ...(section ? { sectionKey: section } : {}) }] });
  return { publicId, email: address };
}
const canSignIn = async (address: string, password: string) => (await signIn({ db, sessionSecret: env.SESSION_SECRET }, { email: address, password, ip: null, userAgent: null })).ok;

// ---------------------------------------------------------------------------------------------
describe("createStaff (Co-ordinators and Accountants)", () => {
  it("the Admin adds a Co-ordinator: a one-time password comes back, only its hash is kept, and the person must change it", async () => {
    const input = staffInput({ fullName: "  Sita Sharma  ", email: `  Sita.Sharma-${n}@School.Example ` });
    const result = ok(await createStaff(db, auditKey, admin.publicId, input as never), "staff");
    expect(result.temporaryPassword).toMatch(TEMP_FORMAT);

    const row = await db.prepare("SELECT email, full_name, is_active, must_change_password, password_hash FROM users WHERE public_id = ?1").bind(result.publicId).first<{ email: string; full_name: string; is_active: number; must_change_password: number; password_hash: string }>();
    expect(row).toMatchObject({ full_name: "Sita Sharma", is_active: 1, must_change_password: 1 });
    expect(row!.email).toBe(row!.email.toLowerCase());
    expect(row!.password_hash).not.toContain(result.temporaryPassword);
    expect(verifyPassword(result.temporaryPassword, row!.password_hash)).toBe(true);

    const role = await db.prepare("SELECT ra.role, ra.scope_type, ra.section_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id WHERE u.public_id = ?1").bind(result.publicId).all();
    expect(role.results).toEqual([{ role: "coordinator", scope_type: "institution", section_id: null }]);

    const entry = await db.prepare("SELECT a.action, u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1").bind(result.publicId).first();
    expect(entry).toEqual({ action: "accounts.staff.created", actor: admin.publicId });
  });

  it("the temporary password is in no audit entry and no queued message", async () => {
    const result = ok(await createStaff(db, auditKey, admin.publicId, staffInput() as never), "staff");
    const everything = JSON.stringify((await db.prepare("SELECT * FROM audit_events").all()).results) + JSON.stringify((await db.prepare("SELECT * FROM outbox_events").all()).results);
    expect(everything).not.toContain(result.temporaryPassword);
  });

  it("an Accountant may be limited to one section", async () => {
    const result = ok(await createStaff(db, auditKey, admin.publicId, staffInput({ role: "accountant", sectionKey: "plus2" }) as never), "staff");
    const role = await db.prepare("SELECT ra.role, ra.scope_type, s.key AS section FROM role_assignments ra JOIN users u ON u.id = ra.user_id JOIN sections s ON s.id = ra.section_id WHERE u.public_id = ?1").bind(result.publicId).first();
    expect(role).toEqual({ role: "accountant", scope_type: "section", section: "plus2" });
  });

  it("the Super Admin may too", async () => {
    expect((await createStaff(db, auditKey, superAdmin.publicId, staffInput() as never)).ok).toBe(true);
  });

  it("no other role may, a switched-off Admin may not, and nothing is written", async () => {
    const off = await person("admin", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = [await users(), await audits()];
    for (const [name, who] of [["co-ordinator", coordinator], ["+2 co-ordinator", plus2Coordinator], ["accountant", accountant], ["teacher", teacher], ["student", student], ["switched-off admin", off]] as const) {
      expect(await createStaff(db, auditKey, who.publicId, staffInput() as never), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await users(), await audits()]).toEqual(before);
  });

  it("a repeat email (in any letter case) is a conflict: no second person, no orphan, no audit entry", async () => {
    const input = staffInput();
    ok(await createStaff(db, auditKey, admin.publicId, input as never), "staff");
    const before = [await users(), await audits(), await count("SELECT COUNT(*) AS n FROM role_assignments")];
    expect(await createStaff(db, auditKey, admin.publicId, { ...input, email: input.email.toUpperCase() } as never)).toEqual({ ok: false, reason: "conflict" });
    expect([await users(), await audits(), await count("SELECT COUNT(*) AS n FROM role_assignments")]).toEqual(before);
  });

  it("refuses an unknown section (not found) and writes nothing", async () => {
    const before = [await users(), await audits()];
    expect(await createStaff(db, auditKey, admin.publicId, staffInput({ role: "accountant", sectionKey: "nowhere" }) as never)).toEqual({ ok: false, reason: "not_found" });
    expect([await users(), await audits()]).toEqual(before);
  });

  it.each([
    ["a name that is too short", { fullName: "S" }],
    ["an email that is not an email", { email: "not-an-email" }],
    ["a role that cannot be made here (teacher)", { role: "teacher" }],
    ["a role that cannot be made here (admin)", { role: "admin" }],
    ["a field that is not allowed (a password)", { password: "hunter2hunter2" }],
  ])("refuses %s, and writes nothing", async (_label, over) => {
    const before = [await users(), await audits()];
    expect(await createStaff(db, auditKey, admin.publicId, staffInput(over) as never)).toMatchObject({ ok: false, reason: "invalid" });
    expect([await users(), await audits()]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("createTeacher", () => {
  it("a whole-school Co-ordinator adds a teacher with a home section, a role of teacher, and a one-time password", async () => {
    const result = await newTeacher(coordinator, "bachelors");
    expect(result.temporaryPassword).toMatch(TEMP_FORMAT);
    const row = await db
      .prepare("SELECT ra.role, ra.scope_type, s.key AS home, u.must_change_password AS flagged FROM users u JOIN role_assignments ra ON ra.user_id = u.id JOIN staff_profiles sp ON sp.user_id = u.id JOIN sections s ON s.id = sp.home_section_id WHERE u.public_id = ?1")
      .bind(result.publicId)
      .first();
    expect(row).toEqual({ role: "teacher", scope_type: "assigned", home: "bachelors", flagged: 1 });
    expect(await auditActions(result.publicId)).toEqual(["accounts.staff.created"]);
  });

  it("a section-scoped Co-ordinator may add teachers only to their own section", async () => {
    expect((await createTeacher(db, auditKey, plus2Coordinator.publicId, teacherInput({ homeSectionKey: "plus2" }) as never)).ok).toBe(true);
    const before = [await users(), await audits()];
    expect(await createTeacher(db, auditKey, plus2Coordinator.publicId, teacherInput({ homeSectionKey: "bachelors" }) as never)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await createTeacher(db, auditKey, bachelorsCoordinator.publicId, teacherInput({ homeSectionKey: "plus2" }) as never)).toEqual({ ok: false, reason: "not_allowed" });
    expect([await users(), await audits()]).toEqual(before);
  });

  it("the Super Admin may; the Admin, an Accountant, a teacher and a student may not", async () => {
    expect((await createTeacher(db, auditKey, superAdmin.publicId, teacherInput() as never)).ok).toBe(true);
    const before = [await users(), await audits()];
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createTeacher(db, auditKey, who.publicId, teacherInput() as never), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await users(), await audits()]).toEqual(before);
  });

  it("an unknown home section is not found, a repeat email is a conflict, and nothing is left behind", async () => {
    const before = [await users(), await audits(), await count("SELECT COUNT(*) AS n FROM staff_profiles")];
    expect(await createTeacher(db, auditKey, coordinator.publicId, teacherInput({ homeSectionKey: "nowhere" }) as never)).toEqual({ ok: false, reason: "not_found" });
    const input = teacherInput();
    ok(await createTeacher(db, auditKey, coordinator.publicId, input as never), "teacher");
    const mid = [await users(), await audits(), await count("SELECT COUNT(*) AS n FROM staff_profiles")];
    expect(await createTeacher(db, auditKey, coordinator.publicId, { ...input, email: input.email.toUpperCase() } as never)).toEqual({ ok: false, reason: "conflict" });
    expect([await users(), await audits(), await count("SELECT COUNT(*) AS n FROM staff_profiles")]).toEqual(mid);
    expect(mid[0]).toBe(before[0]! + 1);
  });

  it("refuses a missing home section and a role field, and writes nothing", async () => {
    const before = [await users(), await audits()];
    expect(await createTeacher(db, auditKey, coordinator.publicId, { fullName: "Ram Karki", email: email() } as never)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createTeacher(db, auditKey, coordinator.publicId, teacherInput({ role: "coordinator" }) as never)).toMatchObject({ ok: false, reason: "invalid" });
    expect([await users(), await audits()]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("switching a person off and on", () => {
  it("the Admin switches a Co-ordinator off: they cannot sign in, and their open sessions end at once; switching on lets them in", async () => {
    const target = await known("coordinator");
    const session = await newSession(db, { userId: (await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(target.publicId).first<{ id: number }>())!.id, ip: null, userAgent: null, now: new Date() });
    await session.statement.run();
    expect(await canSignIn(target.email, "blue-river-lamp-2083")).toBe(true);

    expect(await setStaffActive(db, auditKey, admin.publicId, target.publicId, false)).toEqual({ ok: true });
    expect(await db.prepare("SELECT is_active FROM users WHERE public_id = ?1").bind(target.publicId).first()).toEqual({ is_active: 0 });
    const revoked = await db.prepare("SELECT revoked_at, revoked_reason FROM sessions WHERE public_id = ?1").bind(session.sessionId).first<{ revoked_at: string | null; revoked_reason: string | null }>();
    expect(revoked!.revoked_at).not.toBeNull();
    expect(await canSignIn(target.email, "blue-river-lamp-2083")).toBe(false);

    expect(await setStaffActive(db, auditKey, admin.publicId, target.publicId, true)).toEqual({ ok: true });
    expect(await canSignIn(target.email, "blue-river-lamp-2083")).toBe(true);
    expect(await auditActions(target.publicId)).toEqual(["accounts.user.created", "accounts.staff.updated", "accounts.staff.updated"]);
  });

  it("who may switch whom: the Admin manages Co-ordinators and Accountants; a Co-ordinator manages teachers; the Super Admin anyone but themselves", async () => {
    const coo = await known("coordinator");
    const acc = await known("accountant");
    const tea = await newTeacher();
    const adm = await known("admin");
    const matrix: [string, Person, string, boolean][] = [
      ["admin -> co-ordinator", admin, coo.publicId, true],
      ["admin -> accountant", admin, acc.publicId, true],
      ["admin -> teacher", admin, tea.publicId, false],
      ["admin -> another admin", admin, adm.publicId, false],
      ["co-ordinator -> teacher", coordinator, tea.publicId, true],
      ["co-ordinator -> co-ordinator", coordinator, coo.publicId, false],
      ["co-ordinator -> accountant", coordinator, acc.publicId, false],
      ["co-ordinator -> admin", coordinator, adm.publicId, false],
      ["accountant -> teacher", accountant, tea.publicId, false],
      ["teacher -> co-ordinator", teacher, coo.publicId, false],
      ["student -> teacher", student, tea.publicId, false],
      ["super admin -> admin", superAdmin, adm.publicId, true],
      ["super admin -> teacher", superAdmin, tea.publicId, true],
    ];
    for (const [name, who, target, allowed] of matrix) {
      const result = await setStaffActive(db, auditKey, who.publicId, target, false);
      expect(result, name).toEqual(allowed ? { ok: true } : { ok: false, reason: "not_allowed" });
      await db.prepare("UPDATE users SET is_active = 1 WHERE public_id = ?1").bind(target).run();
    }
  });

  it("nobody switches off themselves, and nothing changes", async () => {
    const me = await known("coordinator");
    const meAdmin = await known("admin");
    const meSuper = await known("super_admin");
    const before = await audits();
    for (const target of [me, meAdmin, meSuper]) {
      const result = await setStaffActive(db, auditKey, target.publicId, target.publicId, false);
      expect(result).toEqual({ ok: false, reason: "not_allowed" });
      expect(await db.prepare("SELECT is_active FROM users WHERE public_id = ?1").bind(target.publicId).first()).toEqual({ is_active: 1 });
    }
    expect(await audits()).toBe(before);
  });

  it("a section-scoped Co-ordinator manages only their own section's teachers, even with the right id", async () => {
    const plus2Teacher = await newTeacher(coordinator, "plus2");
    const bachelorsTeacher = await newTeacher(coordinator, "bachelors");
    expect(await setStaffActive(db, auditKey, plus2Coordinator.publicId, bachelorsTeacher.publicId, false)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await db.prepare("SELECT is_active FROM users WHERE public_id = ?1").bind(bachelorsTeacher.publicId).first()).toEqual({ is_active: 1 });
    expect(await setStaffActive(db, auditKey, plus2Coordinator.publicId, plus2Teacher.publicId, false)).toEqual({ ok: true });
    expect(await setStaffActive(db, auditKey, bachelorsCoordinator.publicId, bachelorsTeacher.publicId, false)).toEqual({ ok: true });
  });

  it("an unknown person is not found; a person already in that state changes nothing and records nothing", async () => {
    expect(await setStaffActive(db, auditKey, admin.publicId, "0".repeat(32), false)).toEqual({ ok: false, reason: "not_found" });
    const tea = await newTeacher();
    const before = await audits();
    expect(await setStaffActive(db, auditKey, coordinator.publicId, tea.publicId, true)).toEqual({ ok: true }); // already on
    expect(await audits()).toBe(before);
  });

  it("a switched-off actor with a valid sign-in is refused, and the person stays as they were", async () => {
    const off = await person("admin", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const target = await known("coordinator");
    expect(await setStaffActive(db, auditKey, off.publicId, target.publicId, false)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await db.prepare("SELECT is_active FROM users WHERE public_id = ?1").bind(target.publicId).first()).toEqual({ is_active: 1 });
  });
});

// ---------------------------------------------------------------------------------------------
describe("a new temporary password", () => {
  it("replaces the password, forces a change, ends open sessions, clears a lockout, and is shown once", async () => {
    const target = await known("coordinator");
    const id = (await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(target.publicId).first<{ id: number }>())!.id;
    const session = await newSession(db, { userId: id, ip: null, userAgent: null, now: new Date() });
    await session.statement.run();
    await db.prepare("UPDATE users SET failed_login_count = 4, locked_until = '2999-01-01T00:00:00Z' WHERE id = ?1").bind(id).run();

    const result = ok(await issueTemporaryPassword(db, auditKey, admin.publicId, target.publicId), "issue");
    expect(result.temporaryPassword).toMatch(TEMP_FORMAT);
    expect(await db.prepare("SELECT must_change_password AS f, failed_login_count AS c, locked_until AS l FROM users WHERE id = ?1").bind(id).first()).toEqual({ f: 1, c: 0, l: null });
    expect((await db.prepare("SELECT revoked_at FROM sessions WHERE public_id = ?1").bind(session.sessionId).first<{ revoked_at: string | null }>())!.revoked_at).not.toBeNull();

    expect(await canSignIn(target.email, "blue-river-lamp-2083")).toBe(false); // the old password is gone
    const step = await signIn({ db, sessionSecret: env.SESSION_SECRET }, { email: target.email, password: result.temporaryPassword, ip: null, userAgent: null });
    expect(step).toMatchObject({ ok: true, passwordChange: "required" });

    const everything = JSON.stringify((await db.prepare("SELECT * FROM audit_events").all()).results);
    expect(everything).not.toContain(result.temporaryPassword);
    expect(await auditActions(target.publicId)).toEqual(["accounts.user.created", "accounts.password.issued"]);
  });

  it("is limited exactly like switching off: the Admin for Co-ordinators and Accountants, a Co-ordinator for teachers, the Super Admin for anyone else but themselves", async () => {
    const coo = await known("coordinator");
    const tea = await newTeacher();
    const before = await audits();
    expect((await issueTemporaryPassword(db, auditKey, coordinator.publicId, coo.publicId))).toEqual({ ok: false, reason: "not_allowed" });
    expect((await issueTemporaryPassword(db, auditKey, admin.publicId, tea.publicId))).toEqual({ ok: false, reason: "not_allowed" });
    for (const who of [accountant, teacher, student]) expect(await issueTemporaryPassword(db, auditKey, who.publicId, coo.publicId)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await issueTemporaryPassword(db, auditKey, admin.publicId, admin.publicId)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await audits()).toBe(before);
    expect((await issueTemporaryPassword(db, auditKey, coordinator.publicId, tea.publicId)).ok).toBe(true);
    expect((await issueTemporaryPassword(db, auditKey, superAdmin.publicId, coo.publicId)).ok).toBe(true);
    expect(await canSignIn(coo.email, "blue-river-lamp-2083")).toBe(false);
  });

  it("a section-scoped Co-ordinator may issue only for their own section's teachers; an unknown person is not found", async () => {
    const other = await newTeacher(coordinator, "bachelors");
    expect(await issueTemporaryPassword(db, auditKey, plus2Coordinator.publicId, other.publicId)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await issueTemporaryPassword(db, auditKey, admin.publicId, "0".repeat(32))).toEqual({ ok: false, reason: "not_found" });
    expect(verifyPassword(other.temporaryPassword, (await db.prepare("SELECT password_hash FROM users WHERE public_id = ?1").bind(other.publicId).first<{ password_hash: string }>())!.password_hash)).toBe(true); // unchanged
  });
});

// ---------------------------------------------------------------------------------------------
describe("listStaff", () => {
  it("shows the Admin Co-ordinators, Accountants and teachers; never Admins or Super Admins", async () => {
    const coo = ok(await createStaff(db, auditKey, admin.publicId, staffInput() as never), "staff");
    const tea = await newTeacher();
    const list = await listStaff(db, [{ role: "admin", scope: "institution" }]);
    const ids = list.staff.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([coo.publicId, tea.publicId]));
    expect(ids).not.toContain(admin.publicId);
    expect(ids).not.toContain(superAdmin.publicId);
    const row = list.staff.find((s) => s.id === coo.publicId)!;
    expect(row).toMatchObject({ active: true, mustChangePassword: true, roles: [{ role: "coordinator", scope: "institution", section: null }], homeSection: null });
    expect(list.staff.find((s) => s.id === tea.publicId)).toMatchObject({ roles: [{ role: "teacher" }], homeSection: "plus2" });
  });

  it("shows a Co-ordinator only teachers, and a section-scoped one only their own section's", async () => {
    const plus2Teacher = await newTeacher(coordinator, "plus2");
    const bachelorsTeacher = await newTeacher(coordinator, "bachelors");
    const coo = ok(await createStaff(db, auditKey, admin.publicId, staffInput() as never), "staff");

    const all = (await listStaff(db, [{ role: "coordinator", scope: "institution" }])).staff;
    expect(all.every((s) => s.roles.every((r) => r.role === "teacher"))).toBe(true);
    expect(all.map((s) => s.id)).toEqual(expect.arrayContaining([plus2Teacher.publicId, bachelorsTeacher.publicId]));
    expect(all.map((s) => s.id)).not.toContain(coo.publicId);

    const scoped = (await listStaff(db, [{ role: "coordinator", scope: "section", section: "plus2" }])).staff;
    expect(scoped.map((s) => s.id)).toContain(plus2Teacher.publicId);
    expect(scoped.map((s) => s.id)).not.toContain(bachelorsTeacher.publicId);
    expect(scoped.every((s) => s.homeSection === "plus2")).toBe(true);
  });

  it("shows the Super Admin Admins too, but never another Super Admin; and nobody else sees anything", async () => {
    const made = await known("admin");
    const list = (await listStaff(db, [{ role: "super_admin", scope: "institution" }])).staff;
    expect(list.map((s) => s.id)).toContain(made.publicId);
    expect(list.map((s) => s.id)).not.toContain(superAdmin.publicId);
    for (const role of ["accountant", "teacher", "student"]) expect((await listStaff(db, [{ role, scope: "institution" }])).staff).toEqual([]);
  });

  it("carries no password, hash or secret", async () => {
    await newTeacher();
    const text = JSON.stringify(await listStaff(db, [{ role: "super_admin", scope: "institution" }]));
    // The only password-related field is the yes/no flag mustChangePassword: no key is a password, a hash, a secret or a temporary password.
    const keys = new Set<string>();
    JSON.parse(text, (key, value) => (keys.add(key), value));
    expect([...keys].filter((key) => /hash|secret|temporary|^password/i.test(key))).toEqual([]);
    expect(keys.has("mustChangePassword")).toBe(true);
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
