import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { newPublicId } from "../src/core/ids";
import { authorize } from "../src/core/permissions";
import type { RoleClaim } from "../src/core/tokens";
import { listPeople } from "../src/modules/accounts/people";
import { createStaff, createTeacher, setStaffAccess, setStaffActive } from "../src/modules/accounts/staff";
import { addLevel, createOffering, createProgramme, createSubject } from "../src/modules/academics/service";
import { auditActions, auditKey, call, db, person, programmesAdmin, seedSections, type Person } from "./academics-helpers";

/**
 * The People & Access screen (D-099): the two lists, searched, filtered and paged in the database; who sees which;
 * the counts; a teacher's subjects, programmes and who added them; several sections at once; and changing access.
 */

let admin: Person, superAdmin: Person, coordinator: Person, plus2Coordinator: Person, accountant: Person, teacher: Person;
const ADMIN: RoleClaim[] = [{ role: "admin", scope: "institution" }];
const word = "pp" + crypto.randomUUID().slice(0, 6); // only this file's people carry it

beforeAll(async () => {
  await seedSections();
  admin = await person("admin", "institution");
  superAdmin = await person("super_admin", "institution");
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
});

let n = 0;
async function staff(role: "coordinator" | "accountant", sectionKeys: string[] = [], name = `${word} ${role} ${++n}`) {
  const made = await createStaff(db, auditKey, admin.publicId, { fullName: name, email: `${word}-${role}-${++n}@school.example`, role, sectionKeys });
  if (!made.ok) throw new Error(`staff setup failed: ${JSON.stringify(made)}`);
  return made.publicId;
}
async function newTeacher(section: "plus2" | "bachelors", by = coordinator.publicId, name = `${word} teacher ${++n}`) {
  const made = await createTeacher(db, auditKey, by, { fullName: name, email: `${word}-t-${++n}@school.example`, homeSectionKey: section });
  if (!made.ok) throw new Error(`teacher setup failed: ${JSON.stringify(made)}`);
  return made.publicId;
}
const rolesOf = async (publicId: string) =>
  (
    await db
      .prepare(
        `SELECT ra.role, ra.scope_type AS scope, s.key AS section, ra.is_active AS active FROM role_assignments ra JOIN users u ON u.id = ra.user_id
           LEFT JOIN sections s ON s.id = ra.section_id WHERE u.public_id = ?1 ORDER BY ra.scope_type, s.key`,
      )
      .bind(publicId)
      .all<{ role: string; scope: string; section: string | null; active: number }>()
  ).results;
const activeScope = async (publicId: string) => (await rolesOf(publicId)).filter((r) => r.active === 1).map((r) => r.section ?? "whole school");

// ---------------------------------------------------------------------------------------------
describe("several sections at once (D-099)", () => {
  it("a Co-ordinator may be given two sections: one role row for each", async () => {
    const id = await staff("coordinator", ["plus2", "bachelors"]);
    expect(await activeScope(id)).toEqual(["bachelors", "plus2"]);
  });

  it("no sections means the whole school; one section still works the old way", async () => {
    expect(await activeScope(await staff("accountant"))).toEqual(["whole school"]);
    const old = await createStaff(db, auditKey, admin.publicId, { fullName: `${word} old way`, email: `${word}-old@school.example`, role: "accountant", sectionKey: "plus2" });
    expect(old.ok && (await activeScope(old.publicId))).toEqual(["plus2"]);
  });

  it("refuses a section that does not exist or is switched off, a section given twice, and both ways at once", async () => {
    await db.prepare("INSERT OR IGNORE INTO sections (key, name, ordering, is_active) VALUES ('closedsec', 'Closed section', 9, 0)").run();
    const attempt = (extra: Record<string, unknown>) => createStaff(db, auditKey, admin.publicId, { fullName: `${word} x`, email: `${word}-x${++n}@school.example`, role: "coordinator", ...extra });
    expect(await attempt({ sectionKeys: ["nosuch"] })).toEqual({ ok: false, reason: "not_found" });
    expect(await attempt({ sectionKeys: ["closedsec"] })).toEqual({ ok: false, reason: "not_found" });
    expect(await attempt({ sectionKeys: ["plus2", "plus2"] })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await attempt({ sectionKey: "plus2", sectionKeys: ["bachelors"] })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("the new person's sign-in carries every section, so the permission layer sees them all", async () => {
    const grant = authorize(
      [
        { role: "coordinator", scope: "section", section: "plus2" },
        { role: "coordinator", scope: "section", section: "bachelors" },
      ],
      "students.search",
    );
    expect(grant!.sections.sort()).toEqual(["bachelors", "plus2"]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("changing where access reaches (D-099)", () => {
  it("whole school to two sections, and back; audited each time with before and after", async () => {
    const id = await staff("coordinator");
    expect(await setStaffAccess(db, auditKey, admin.publicId, id, ["plus2", "bachelors"])).toEqual({ ok: true });
    expect(await activeScope(id)).toEqual(["bachelors", "plus2"]);
    expect(await setStaffAccess(db, auditKey, admin.publicId, id, [])).toEqual({ ok: true });
    expect(await activeScope(id)).toEqual(["whole school"]);
    // Nothing is deleted: the section rows stay, switched off.
    expect((await rolesOf(id)).length).toBe(3);
    expect(await auditActions(id)).toEqual(["accounts.staff.created", "accounts.access.changed", "accounts.access.changed"]);
    const entry = await db.prepare("SELECT before_json, after_json FROM audit_events WHERE entity_public_id = ?1 AND action = 'accounts.access.changed' ORDER BY id LIMIT 1").bind(id).first<{ before_json: string; after_json: string }>();
    expect(JSON.parse(entry!.before_json)).toEqual({ role: "coordinator", sections: "whole school" });
    expect(JSON.parse(entry!.after_json)).toEqual({ role: "coordinator", sections: ["bachelors", "plus2"] });
  });

  it("the same scope again changes nothing and records nothing", async () => {
    const id = await staff("accountant", ["plus2"]);
    expect(await setStaffAccess(db, auditKey, admin.publicId, id, ["plus2"])).toEqual({ ok: true });
    expect(await auditActions(id)).toEqual(["accounts.staff.created"]);
  });

  it("only an Admin or Super Admin, never for themselves, and only for a Co-ordinator or an Accountant", async () => {
    const id = await staff("accountant");
    for (const who of [coordinator, plus2Coordinator, accountant, teacher]) expect(await setStaffAccess(db, auditKey, who.publicId, id, ["plus2"])).toEqual({ ok: false, reason: "not_allowed" });
    expect(await setStaffAccess(db, auditKey, superAdmin.publicId, id, ["plus2"])).toEqual({ ok: true });
    const t = await newTeacher("plus2");
    expect(await setStaffAccess(db, auditKey, admin.publicId, t, ["plus2"])).toEqual({ ok: false, reason: "not_allowed" });
    expect(await setStaffAccess(db, auditKey, admin.publicId, admin.publicId, [])).toEqual({ ok: false, reason: "not_allowed" });
    expect(await setStaffAccess(db, auditKey, admin.publicId, newPublicId(), [])).toEqual({ ok: false, reason: "not_found" });
    expect(await activeScope(id)).toEqual(["plus2"]);
  });

  it("refuses a section that does not exist or is switched off, and changes nothing", async () => {
    const id = await staff("coordinator");
    expect(await setStaffAccess(db, auditKey, admin.publicId, id, ["nosuch"])).toMatchObject({ ok: false, reason: "invalid" });
    expect(await setStaffAccess(db, auditKey, admin.publicId, id, ["closedsec"])).toMatchObject({ ok: false, reason: "invalid" });
    expect(await activeScope(id)).toEqual(["whole school"]);
  });

  it("an Admin switched off a moment ago changes nothing, and leaves no audit entry", async () => {
    const id = await staff("coordinator");
    const other = await person("admin", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(other.publicId).run();
    expect(await setStaffAccess(db, auditKey, other.publicId, id, ["plus2"])).toEqual({ ok: false, reason: "not_allowed" });
    expect(await auditActions(id)).toEqual(["accounts.staff.created"]);
  });

  it("the route: Admin 200, Co-ordinator and Accountant 403, signed out 401, a bad body 400", async () => {
    const id = await staff("accountant");
    const patch = (cookie: string | undefined, body: unknown) => call(`/api/staff/${id}/access`, { method: "PATCH", body, ...(cookie && { cookie }) });
    expect((await patch(undefined, { sectionKeys: [] })).status).toBe(401);
    expect((await patch(coordinator.cookie, { sectionKeys: [] })).status).toBe(403);
    expect((await patch(accountant.cookie, { sectionKeys: [] })).status).toBe(403);
    expect((await patch(admin.cookie, { sectionKeys: "plus2" })).status).toBe(400);
    expect((await patch(admin.cookie, { sectionKeys: ["plus2"], role: "admin" })).status).toBe(400);
    expect((await patch(admin.cookie, { sectionKeys: ["plus2"] })).status).toBe(200);
    expect(await activeScope(id)).toEqual(["plus2"]);
  });

  it("leaves the audit chain whole", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the two lists (D-099)", () => {
  let gita: string, hari: string, ramesh: string, anita: string, bikash: string, programmeId: string;

  beforeAll(async () => {
    gita = await staff("accountant", [], `${word} Gita Thapa`);
    hari = await staff("coordinator", ["bachelors"], `${word} Hari Yadav`);
    ramesh = await staff("accountant", ["plus2"], `${word} Ramesh Shrestha`);
    await setStaffActive(db, auditKey, admin.publicId, ramesh, false);
    anita = await newTeacher("bachelors", coordinator.publicId, `${word} Anita Mandal`);
    bikash = await newTeacher("plus2", plus2Coordinator.publicId, `${word} Bikash Chaudhary`);

    // Anita teaches Computer Science in a programme, in a class of an open year.
    const p = await createProgramme(db, auditKey, (await programmesAdmin()).publicId, { name: `${word} BCA`, sectionKey: "bachelors", affiliation: "TU" });
    if (!p.ok) throw new Error("programme");
    programmeId = p.publicId;
    const l = await addLevel(db, auditKey, (await programmesAdmin()).publicId, p.publicId, { name: "Year 1" });
    if (!l.ok) throw new Error("level");
    const s = await createSubject(db, auditKey, coordinator.publicId, { name: `${word} Computer Science` });
    if (!s.ok) throw new Error("subject");
    const o = await createOffering(db, auditKey, coordinator.publicId, { levelId: l.publicId, subjectId: s.publicId });
    if (!o.ok) throw new Error("offering");
    const year = newPublicId();
    await db.prepare("INSERT INTO academic_years (public_id, bs_year, label, start_date, end_date, status, created_at) VALUES (?1, 2071, 'Year 2071', '2026-04-14', '2027-04-13', 'draft', '2026-09-22T00:00:00Z')").bind(year).run();
    const cls = newPublicId();
    await db
      .prepare("INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label) SELECT ?1, y.id, lv.programme_id, lv.id, '' FROM academic_years y, levels lv WHERE y.public_id = ?2 AND lv.public_id = ?3")
      .bind(cls, year, l.publicId)
      .run();
    await db
      .prepare(
        `INSERT INTO teacher_assignments (public_id, class_id, offering_id, teacher_user_id, created_at)
         SELECT ?1, c.id, so.id, u.id, '2026-09-22T00:00:00Z' FROM classes c, subject_offerings so, users u WHERE c.public_id = ?2 AND so.public_id = ?3 AND u.public_id = ?4`,
      )
      .bind(newPublicId(), cls, o.publicId, anita)
      .run();
  });

  const admins = (extra: Partial<Parameters<typeof listPeople>[3]> = {}) => listPeople(db, ADMIN, admin.publicId, { group: "admin", q: word, pageSize: 50, ...extra });
  const teachers = (extra: Partial<Parameters<typeof listPeople>[3]> = {}, viewer: RoleClaim[] = ADMIN, viewerId = admin.publicId) =>
    listPeople(db, viewer, viewerId, { group: "teaching", q: word, pageSize: 50, ...extra });
  const ids = (list: { people: { id: string }[] }) => list.people.map((p) => p.id);

  it("administrative staff are Co-ordinators and Accountants only, never teachers or Admins", async () => {
    const list = await admins();
    expect(ids(list)).toEqual(expect.arrayContaining([gita, hari, ramesh]));
    expect(ids(list)).not.toContain(anita);
    expect(list.people.every((p) => p.role === "coordinator" || p.role === "accountant")).toBe(true);
    expect(ids(await listPeople(db, ADMIN, admin.publicId, { group: "admin", pageSize: 50 }))).not.toContain(admin.publicId);
  });

  it("each carries its access, its account status and its sign-in separately, and whether the viewer may manage it", async () => {
    const list = await admins();
    const g = list.people.find((p) => p.id === gita)!;
    expect(g).toMatchObject({ role: "accountant", sections: [], active: true, lastSignInAt: null, canManage: true });
    expect(list.people.find((p) => p.id === hari)!.sections).toEqual([{ key: "bachelors", name: "Bachelor's" }]);
    expect(list.people.find((p) => p.id === ramesh)).toMatchObject({ active: false, sections: [{ key: "plus2", name: "+2" }] });
    // Never a password or its hash: only the flag that one must still be chosen.
    expect(JSON.stringify(list)).not.toMatch(/hash|temporaryPassword|"password"/i);
  });

  it("filters by role, status and section (a whole-school person counts for every section), and searches name or email", async () => {
    expect(ids(await admins({ role: "accountant" }))).toEqual(expect.arrayContaining([gita, ramesh]));
    expect(ids(await admins({ role: "accountant" }))).not.toContain(hari);
    expect((await admins({ role: "accountant" })).people.every((p) => p.role === "accountant")).toBe(true);
    expect(ids(await admins({ status: "off" }))).toContain(ramesh);
    expect((await admins({ status: "off" })).people.every((p) => !p.active)).toBe(true);
    expect(ids(await admins({ section: "bachelors" }))).toEqual(expect.arrayContaining([gita, hari]));
    expect(ids(await admins({ section: "bachelors" }))).not.toContain(ramesh);
    expect(ids(await admins({ q: `${word} Hari` }))).toEqual([hari]);
    expect(ids(await admins({ q: "%" }))).toEqual([]); // a wildcard is a plain character
  });

  it("teachers carry their home section, what they teach, the programme, and who added them", async () => {
    const list = await teachers();
    const a = list.people.find((p) => p.id === anita)!;
    expect(a).toMatchObject({ role: "teacher", homeSection: { key: "bachelors", name: "Bachelor's" }, subjects: [`${word} Computer Science`], programmes: [`${word} BCA`] });
    expect(a.addedBy).toEqual({ name: "coordinator person", role: "coordinator", support: false });
    expect(list.people.find((p) => p.id === bikash)!.subjects).toEqual([]);
  });

  it("a teacher added by the build team shows as Support, never by name", async () => {
    const t = await newTeacher("plus2", superAdmin.publicId);
    expect((await teachers()).people.find((p) => p.id === t)!.addedBy).toEqual({ name: null, role: null, support: true });
  });

  it("filters teachers by home section, programme and status", async () => {
    expect(ids(await teachers({ section: "plus2" }))).toContain(bikash);
    expect(ids(await teachers({ section: "plus2" }))).not.toContain(anita);
    expect(ids(await teachers({ programme: programmeId }))).toEqual([anita]);
    expect(ids(await teachers({ status: "off" }))).toEqual([]);
  });

  it("the Principal may look at teachers but not manage them; their Co-ordinator may", async () => {
    expect((await teachers()).people.find((p) => p.id === anita)!.canManage).toBe(false);
    const asCoordinator = await teachers({}, [{ role: "coordinator", scope: "institution" }], coordinator.publicId);
    expect(asCoordinator.people.find((p) => p.id === anita)!.canManage).toBe(true);
  });

  it("a Co-ordinator sees no administrative staff, and a limited one only their own section's teachers", async () => {
    expect((await listPeople(db, [{ role: "coordinator", scope: "institution" }], coordinator.publicId, { group: "admin", q: word })).people).toEqual([]);
    const limited = await teachers({}, [{ role: "coordinator", scope: "section", section: "plus2" }], plus2Coordinator.publicId);
    expect(ids(limited)).toContain(bikash);
    expect(ids(limited)).not.toContain(anita);
  });

  it("an Accountant or a teacher sees nobody", async () => {
    for (const viewer of [[{ role: "accountant", scope: "institution" }], [{ role: "teacher", scope: "assigned" }]] as RoleClaim[][]) {
      expect((await listPeople(db, viewer, accountant.publicId, { group: "teaching" })).people).toEqual([]);
      expect((await listPeople(db, viewer, accountant.publicId, { group: "admin" })).people).toEqual([]);
    }
  });

  it("pages in the database, by name, and says how many match", async () => {
    const first = await admins({ pageSize: 2 });
    const second = await admins({ pageSize: 2, page: 2 });
    expect(first.total).toBeGreaterThanOrEqual(3);
    expect(first.people).toHaveLength(2);
    expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
    const names = (await admins()).people.map((p) => p.fullName.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it("counts switched-on people, whatever the filters; a Co-ordinator's counts hold only teachers", async () => {
    const before = (await admins({ q: "nobody matches this" })).counts;
    const extra = await staff("coordinator");
    const after = (await admins({ q: "nobody matches this" })).counts;
    expect(after.coordinators - before.coordinators).toBe(1);
    await setStaffActive(db, auditKey, admin.publicId, extra, false);
    expect((await admins({ q: "nobody" })).counts.coordinators).toBe(before.coordinators);
    const coo = await teachers({}, [{ role: "coordinator", scope: "institution" }], coordinator.publicId);
    expect(coo.counts.coordinators).toBe(0);
    expect(coo.counts.teachers).toBeGreaterThan(0);
  });

  it("the route: shape, filters checked, who may see", async () => {
    const response = await call(`/api/people?group=admin&q=${word}&role=accountant&status=active&page=1&pageSize=5`, { cookie: admin.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["counts", "page", "pageSize", "people", "sections", "total"]);
    for (const bad of ["group=all", "group=admin&role=teacher", "group=admin&status=gone", "group=teaching&programme=x", "group=admin&pageSize=51", ""]) {
      expect((await call(`/api/people?${bad}`, { cookie: admin.cookie })).status, bad).toBe(400);
    }
    expect((await call("/api/people?group=admin")).status).toBe(401);
    expect((await call("/api/people?group=admin", { cookie: accountant.cookie })).status).toBe(403);
    expect((await call("/api/people?group=teaching", { cookie: teacher.cookie })).status).toBe(403);
  });
});
