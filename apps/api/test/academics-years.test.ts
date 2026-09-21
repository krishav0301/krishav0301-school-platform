import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { activateYear, createYear, updateYear } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";

let bs = 2010;
/** A BS year not used yet in this file: its first and last day, from the verified calendar. */
const freshYear = (over: Record<string, unknown> = {}) => {
  const bsYear = ++bs;
  return {
    bsYear,
    startDate: bsToAd({ year: bsYear, month: 1, day: 1 }),
    endDate: bsToAd({ year: bsYear, month: 12, day: daysInMonth(bsYear, 12) }),
    ...over,
  } as { bsYear: number; startDate: string; endDate: string; label?: string };
};

let coordinator: Person, sectionCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  sectionCoordinator = await person("coordinator", "section", "plus2");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

const years = () => count("SELECT COUNT(*) AS n FROM academic_years");
const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");

// ---------------------------------------------------------------------------------------------
describe("createYear", () => {
  it("adds a draft year, names it after its BS year, and records who did it", async () => {
    const input = freshYear();
    const result = await createYear(db, auditKey, coordinator.publicId, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await db.prepare("SELECT bs_year, label, start_date, end_date, status FROM academic_years WHERE public_id = ?1").bind(result.publicId).first();
    expect(row).toEqual({ bs_year: input.bsYear, label: String(input.bsYear), start_date: input.startDate, end_date: input.endDate, status: "draft" });
    const entry = await db
      .prepare("SELECT a.action, u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1")
      .bind(result.publicId)
      .first();
    expect(entry).toEqual({ action: "academics.year.created", actor: coordinator.publicId });
  });

  it("takes a label of the person's own choosing", async () => {
    const result = await createYear(db, auditKey, coordinator.publicId, freshYear({ label: "2083/84" }));
    expect(result.ok).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM academic_years WHERE label = '2083/84'")).toBe(1);
  });

  it("the Super Admin may too", async () => {
    expect((await createYear(db, auditKey, superAdmin.publicId, freshYear())).ok).toBe(true);
  });

  const bad: [string, () => Record<string, unknown>, RegExp][] = [
    ["a year whose calendar is not verified", () => ({ bsYear: 2090, startDate: "2033-04-14", endDate: "2034-04-13" }), /not been verified/],
    ["a start day that is not in the BS year", () => { const f = freshYear(); return { ...f, startDate: bsToAd({ year: f.bsYear + 1, month: 1, day: 1 }), endDate: bsToAd({ year: f.bsYear + 1, month: 12, day: 1 }) }; }, /not in BS/],
    ["an end that is not after the start", () => { const f = freshYear(); return { ...f, endDate: f.startDate }; }, /end after/i],
    ["a day that does not exist", () => ({ ...freshYear(), startDate: "2026-02-30" }), /does not exist/],
    ["an empty label", () => ({ ...freshYear(), label: "  " }), /name/i],
    ["a field that is not allowed (the status)", () => ({ ...freshYear(), status: "active" }), /./],
  ];
  it.each(bad)("refuses %s, and writes nothing", async (_label, make, message) => {
    const before = [await years(), await audits()];
    const result = await createYear(db, auditKey, coordinator.publicId, make() as never);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect((result as { message: string }).message).toMatch(message);
    expect([await years(), await audits()]).toEqual(before);
  });

  it("refuses everyone but an institution-wide Co-ordinator and the Super Admin, and writes nothing", async () => {
    const before = [await years(), await audits()];
    for (const [name, who] of [["admin", admin], ["accountant", accountant], ["teacher", teacher], ["student", student], ["a +2 Co-ordinator", sectionCoordinator]] as const) {
      expect(await createYear(db, auditKey, who.publicId, freshYear()), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await years(), await audits()]).toEqual(before);
  });

  it("re-checks the person in the database: a switched-off account or role is refused even with a valid token", async () => {
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    expect(await createYear(db, auditKey, off.publicId, freshYear())).toEqual({ ok: false, reason: "not_allowed" });

    const demoted = await person("coordinator", "institution");
    await db.prepare("UPDATE role_assignments SET is_active = 0 WHERE user_id = (SELECT id FROM users WHERE public_id = ?1)").bind(demoted.publicId).run();
    expect(await createYear(db, auditKey, demoted.publicId, freshYear())).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("a second year with the same BS year is a conflict and leaves no false audit entry", async () => {
    const input = freshYear();
    expect((await createYear(db, auditKey, coordinator.publicId, input)).ok).toBe(true);
    const before = await audits();
    expect(await createYear(db, auditKey, coordinator.publicId, { ...input, label: "another" })).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateYear", () => {
  const draft = async () => {
    const r = await createYear(db, auditKey, coordinator.publicId, freshYear());
    if (!r.ok) throw new Error("setup failed");
    return r.publicId;
  };

  it("changes the label and records before and after", async () => {
    const id = await draft();
    expect(await updateYear(db, auditKey, coordinator.publicId, id, { label: "Renamed" })).toEqual({ ok: true });
    expect(await db.prepare("SELECT label FROM academic_years WHERE public_id = ?1").bind(id).first()).toEqual({ label: "Renamed" });
    expect(await auditActions(id)).toEqual(["academics.year.created", "academics.year.updated"]);
  });

  it("changing nothing records nothing", async () => {
    const id = await draft();
    const before = await audits();
    expect(await updateYear(db, auditKey, coordinator.publicId, id, {})).toEqual({ ok: true });
    expect(await audits()).toBe(before);
  });

  it("checks the merged year again (end before start is refused, nothing changes)", async () => {
    const id = await draft();
    const start = (await db.prepare("SELECT start_date FROM academic_years WHERE public_id = ?1").bind(id).first<{ start_date: string }>())!.start_date;
    expect(await updateYear(db, auditKey, coordinator.publicId, id, { endDate: start })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses an unknown year, another person, and a year that is no longer a draft", async () => {
    expect(await updateYear(db, auditKey, coordinator.publicId, "0".repeat(32), { label: "x" })).toEqual({ ok: false, reason: "not_found" });
    const id = await draft();
    expect(await updateYear(db, auditKey, admin.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateYear(db, auditKey, sectionCoordinator.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE public_id = ?1").bind(id).run();
    expect(await updateYear(db, auditKey, coordinator.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "not_draft" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("activateYear", () => {
  it("one winner when two are activated at once; the loser is told another year is active; nothing is applied twice", async () => {
    const a = await createYear(db, auditKey, coordinator.publicId, freshYear());
    const b = await createYear(db, auditKey, coordinator.publicId, freshYear());
    if (!a.ok || !b.ok) throw new Error("setup failed");

    const results = await Promise.all([activateYear(db, auditKey, coordinator.publicId, a.publicId), activateYear(db, auditKey, coordinator.publicId, b.publicId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "another_active" });
    expect(await count("SELECT COUNT(*) AS n FROM academic_years WHERE status = 'active'")).toBe(1);

    const winner = results[0]!.ok ? a.publicId : b.publicId;
    const loser = winner === a.publicId ? b.publicId : a.publicId;
    expect(await auditActions(winner)).toContain("academics.year.activated");
    expect(await auditActions(loser)).not.toContain("academics.year.activated");

    // Already active: a repeat says so, and records nothing more.
    const before = await audits();
    expect(await activateYear(db, auditKey, coordinator.publicId, winner)).toEqual({ ok: false, reason: "not_draft" });
    expect(await audits()).toBe(before);

    // Others are refused, and an unknown id is not found.
    const c = await createYear(db, auditKey, coordinator.publicId, freshYear());
    if (!c.ok) throw new Error("setup failed");
    expect(await activateYear(db, auditKey, admin.publicId, c.publicId)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await activateYear(db, auditKey, coordinator.publicId, "0".repeat(32))).toEqual({ ok: false, reason: "not_found" });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
