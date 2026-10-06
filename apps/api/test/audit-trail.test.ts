import { beforeAll, describe, expect, it } from "vitest";

import { recordAudit } from "../src/core/audit";
import { createSection } from "../src/modules/academics/service";
import { seedSections } from "./academics-helpers";
import { classWith } from "./schoolday-helpers";
import { auditKey, call, db, person, type Person } from "./academics-helpers";

/**
 * The Audit trail and Sign-ins views (CLAUDE.md section 6, D-102, admin FUT F-11): the Admin and Support read every
 * audit entry and every sign-in attempt, in pages; nobody else does; the build team shows as "Support", never by name
 * or email (CLAUDE.md section 5); and nothing here can change an entry.
 */

let admin: Person, support: Person;
type Trail = { rows: { action: string; summary: string; actor: string | null; onBs: string | null; time: string }[]; total: number; page: number; pageSize: number };
type SignIns = { rows: { name: string | null; email: string; success: boolean; reason: string | null }[]; total: number };

beforeAll(async () => {
  admin = await person("admin", "institution");
  support = await person("super_admin", "institution");
  await createSection(db, auditKey, admin.publicId, { name: "Audit Trail Section" });
  await createSection(db, auditKey, support.publicId, { name: "Support Made Section" });
  const supportEmail = (await db.prepare("SELECT email FROM users WHERE public_id = ?1").bind(support.publicId).first<{ email: string }>())!.email;
  const adminEmail = (await db.prepare("SELECT email FROM users WHERE public_id = ?1").bind(admin.publicId).first<{ email: string }>())!.email;
  const at = new Date().toISOString();
  for (const [email, success, reason] of [
    [adminEmail, 0, "bad_password"],
    [adminEmail, 1, null],
    [supportEmail, 0, "bad_password"],
    ["nobody@school.example", 0, "unknown_user"],
  ] as const)
    await db.prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, NULL, ?2, ?3, ?4, '203.0.113.9', 'test')").bind(at, email, success, reason).run();
});

const trail = async (who: Person, query = "") => call(`/api/audit/events${query}`, { cookie: who.cookie });

describe("the audit trail", () => {
  it("lists entries newest first, with the person, the Nepali date and the time; Support never by name", async () => {
    const response = await trail(admin, "?q=Section");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Trail;
    const mine = body.rows.find((r) => r.summary.startsWith('Section "Audit Trail Section" added'))!;
    const theirs = body.rows.find((r) => r.summary.startsWith('Section "Support Made Section" added'))!;
    expect(mine.actor).toBe("admin person");
    expect(theirs.actor).toBe("Support");
    expect(mine.onBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mine.time).toMatch(/^\d{2}:\d{2}$/);
    expect(body.rows.indexOf(theirs)).toBeLessThan(body.rows.indexOf(mine)); // newest first
  });

  it("filters by area and searches; searching Support's real name finds nothing of theirs", async () => {
    const structure = (await (await trail(admin, "?area=structure")).json()) as Trail;
    expect(structure.rows.length).toBeGreaterThan(0);
    expect(structure.rows.every((r) => r.action.startsWith("academics.") || r.action.startsWith("setup."))).toBe(true);
    const fees = (await (await trail(admin, "?area=fees&q=Audit%20Trail%20Section")).json()) as Trail;
    expect(fees.total).toBe(0);
    const byName = (await (await trail(admin, "?q=super_admin%20person")).json()) as Trail;
    expect(byName.rows.some((r) => r.actor === "Support")).toBe(false);
  });

  it("pages 25 at a time", async () => {
    const body = (await (await trail(admin, "?page=1")).json()) as Trail;
    expect(body.pageSize).toBe(25);
    expect(body.rows.length).toBeLessThanOrEqual(25);
    expect(body.page).toBe(1);
  });

  it("is the Admin's and Support's only: every other role is refused (CLAUDE.md section 5)", async () => {
    expect((await trail(support)).status).toBe(200);
    for (const [role, scope] of [["coordinator", "institution"], ["accountant", "institution"], ["teacher", "assigned"], ["student", "own"]] as const) {
      const who = await person(role, scope);
      expect((await trail(who)).status, role).toBe(403);
      expect((await call("/api/audit/sign-ins", { cookie: who.cookie })).status, role).toBe(403);
    }
    expect((await call("/api/audit/events")).status).toBe(401);
  });

  it("an admission reads by the student's name and student ID, never an internal id (admin FUT F-04)", async () => {
    await seedSections();
    const fixture = await classWith("plus2", 1);
    const student = await db
      .prepare("SELECT st.public_id, st.sid, st.first_name || ' ' || st.last_name AS name FROM students st JOIN enrollments en ON en.student_id = st.id WHERE en.public_id = ?1")
      .bind(fixture.pupils[0]!.enrollmentId)
      .first<{ public_id: string; sid: string; name: string }>();
    await recordAudit(db, auditKey, { action: "admissions.approved", entityType: "student", entityPublicId: student!.public_id, actorPublicId: admin.publicId, summary: `Application approved; student ${student!.public_id} created` });
    const body = (await (await trail(admin, "?area=admissions")).json()) as Trail;
    expect(body.rows[0]!.summary).toBe(`${student!.name} admitted (${student!.sid})`);
  });

  it("offers no way to change an entry", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) expect((await call("/api/audit/events", { method, cookie: admin.cookie, body: {} })).status, method).toBeGreaterThanOrEqual(404);
  });
});

describe("sign-ins", () => {
  it("lists attempts with who and why; the build team's email is hidden", async () => {
    const body = (await (await call("/api/audit/sign-ins", { cookie: admin.cookie })).json()) as SignIns;
    expect(body.rows.some((r) => r.name === "admin person" && r.success === false && r.reason === "bad_password")).toBe(true);
    expect(body.rows.some((r) => r.name === "admin person" && r.success)).toBe(true);
    expect(body.rows.some((r) => r.email === "nobody@school.example" && r.name === null)).toBe(true);
    const supportRow = body.rows.find((r) => r.name === "Support")!;
    expect(supportRow.email).toBe("Support");
    expect(body.rows.some((r) => r.email.startsWith("super_admin-"))).toBe(false);
  });

  it("shows only failures when asked", async () => {
    const body = (await (await call("/api/audit/sign-ins?failed=1", { cookie: admin.cookie })).json()) as SignIns;
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => !r.success)).toBe(true);
  });
});
