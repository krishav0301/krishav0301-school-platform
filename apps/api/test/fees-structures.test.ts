import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd } from "../src/core/dates";
import { billingSchedule } from "../src/modules/fees/policy";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { classWith, enrol, type ClassFixture } from "./schoolday-helpers";

/**
 * Fee structures and charges (Phase 6, slice 2, D-075). Source 6.4: the Accountant drafts the yearly fee structure;
 * items are One-time, Monthly, Yearly or Whole course, in NPR; fixed for the year and the same for every student in a
 * class; the Admin approves before it goes live. CLAUDE.md section 6: approve-and-apply is one batch, nobody approves
 * their own request, a changed subject goes stale. The Co-ordinator has no fees access at all.
 */

let plus2: ClassFixture, bachelors: ClassFixture;
let accountant: Person, plus2Accountant: Person, bachelorsAccountant: Person, admin: Person, coordinator: Person, superAdmin: Person;

beforeAll(async () => {
  plus2 = await classWith("plus2", 3);
  bachelors = await classWith("bachelors", 1);
  accountant = await person("accountant", "institution");
  plus2Accountant = await person("accountant", "section", "plus2");
  bachelorsAccountant = await person("accountant", "section", "bachelors");
  admin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  superAdmin = await person("super_admin", "institution");
});

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const idOf = async (r: Response) => ((await r.json()) as { id: string }).id;
async function draftFor(fixture: ClassFixture, who: Person = accountant): Promise<string> {
  const response = await post("/api/fees/structures", { levelId: fixture.levelId }, who);
  expect(response.status).toBe(201);
  return idOf(response);
}
const addItem = (structureId: string, item: Record<string, unknown>, who: Person = accountant) => post(`/api/fees/structures/${structureId}/items`, item, who);
const approvalFor = async (structureId: string) =>
  (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 AND status = 'pending'").bind(structureId).first<{ public_id: string }>())?.public_id;
const decide = (requestId: string, body: { approve: boolean; reason?: string }, who: Person = admin) =>
  body.approve ? post(`/api/approvals/${requestId}/approve`, undefined, who) : post(`/api/approvals/${requestId}/decline`, { reason: body.reason }, who);

describe("the billing schedule (the policy seam)", () => {
  const year = { bsYear: 2083, startDate: bsToAd({ year: 2083, month: 1, day: 1 }) };

  it("monthly is twelve charges, each due on the first of its BS month; one-time and yearly are one charge on the first day", () => {
    const monthly = billingSchedule({ frequency: "monthly" }, year, { enrolledOn: year.startDate, firstInProgramme: true });
    expect(monthly).toHaveLength(12);
    expect(monthly[0]).toEqual({ period: "2083-01", dueOn: bsToAd({ year: 2083, month: 1, day: 1 }) });
    expect(monthly[11]).toEqual({ period: "2083-12", dueOn: bsToAd({ year: 2083, month: 12, day: 1 }) });
    expect(billingSchedule({ frequency: "yearly" }, year, { enrolledOn: year.startDate, firstInProgramme: true })).toEqual([{ period: "year", dueOn: year.startDate }]);
    expect(billingSchedule({ frequency: "one_time" }, year, { enrolledOn: year.startDate, firstInProgramme: true })).toEqual([{ period: "once", dueOn: year.startDate }]);
  });

  it("a student enrolled mid-year is billed monthly from their own month on", () => {
    const joined = bsToAd({ year: 2083, month: 6, day: 12 });
    const monthly = billingSchedule({ frequency: "monthly" }, year, { enrolledOn: joined, firstInProgramme: true });
    expect(monthly.map((m) => m.period)).toEqual(["2083-06", "2083-07", "2083-08", "2083-09", "2083-10", "2083-11", "2083-12"]);
  });

  it("a whole-course item is charged only in the student's first year of the programme", () => {
    expect(billingSchedule({ frequency: "whole_course" }, year, { enrolledOn: year.startDate, firstInProgramme: true })).toEqual([{ period: "course", dueOn: year.startDate }]);
    expect(billingSchedule({ frequency: "whole_course" }, year, { enrolledOn: year.startDate, firstInProgramme: false })).toEqual([]);
  });
});

describe("drafting", () => {
  it("the Accountant drafts a structure for a level with items in whole paisa", async () => {
    const id = await draftFor(plus2);
    expect((await addItem(id, { name: "Tuition", amountPaisa: 250_000, frequency: "monthly" })).status).toBe(201);
    expect((await addItem(id, { name: "Admission", amountPaisa: 1_000_000, frequency: "one_time" })).status).toBe(201);
    const view = (await (await call(`/api/fees/structures/${id}`, { cookie: accountant.cookie })).json()) as { status: string; items: { name: string; amountPaisa: number }[]; yearlyTotalPaisa: number };
    expect(view.status).toBe("draft");
    expect(view.items.map((i) => i.name)).toEqual(["Tuition", "Admission"]);
    expect(view.yearlyTotalPaisa).toBe(250_000 * 12 + 1_000_000);
  });

  it("refuses fractions, zero, negatives and a second structure for the same level and year", async () => {
    const id = await draftFor(bachelors);
    expect((await addItem(id, { name: "Fee", amountPaisa: 10.5, frequency: "yearly" })).status).toBe(400);
    expect((await addItem(id, { name: "Fee", amountPaisa: 0, frequency: "yearly" })).status).toBe(400);
    expect((await addItem(id, { name: "Fee", amountPaisa: -5, frequency: "yearly" })).status).toBe(400);
    expect((await post("/api/fees/structures", { levelId: bachelors.levelId }, accountant)).status).toBe(409);
  });

  it("only the Accountant (and Super Admin) drafts; the Co-ordinator has no fees access at all; a section-scoped Accountant stays in their section", async () => {
    for (const who of [coordinator, admin]) expect((await post("/api/fees/structures", { levelId: plus2.levelId }, who)).status).toBe(403);
    expect((await call("/api/fees/structures", { cookie: coordinator.cookie })).status).toBe(403);
    const other = await classWith("bachelors", 0);
    expect((await post("/api/fees/structures", { levelId: other.levelId }, plus2Accountant)).status).toBe(404);
    expect((await post("/api/fees/structures", { levelId: other.levelId }, bachelorsAccountant)).status).toBe(201);
  });
});

describe("approval", () => {
  let structureId: string;
  beforeAll(async () => {
    const fixture = await classWith("plus2", 2);
    structureId = await draftFor(fixture);
    await addItem(structureId, { name: "Tuition", amountPaisa: 300_000, frequency: "monthly" });
  });

  it("sending locks the draft; an item change is refused while it waits", async () => {
    expect((await post(`/api/fees/structures/${structureId}/send`, {}, accountant)).status).toBe(201);
    expect((await addItem(structureId, { name: "Extra", amountPaisa: 100, frequency: "yearly" })).status).toBe(409);
  });

  it("the Accountant cannot approve it; an Admin can, and it goes live, fixed", async () => {
    const requestId = (await approvalFor(structureId))!;
    expect((await decide(requestId, { approve: true }, accountant)).status).toBe(403);
    expect((await decide(requestId, { approve: true })).status).toBe(200);
    const view = (await (await call(`/api/fees/structures/${structureId}`, { cookie: accountant.cookie })).json()) as { status: string };
    expect(view.status).toBe("live");
    expect((await addItem(structureId, { name: "Late", amountPaisa: 100, frequency: "yearly" })).status).toBe(409);
    await expect(db.prepare("UPDATE fee_structures SET status = 'draft' WHERE public_id = ?1").bind(structureId).run()).rejects.toThrow(/fixed for the year/);
  });

  it("a declined structure goes back to draft for the Accountant to change", async () => {
    const fixture = await classWith("plus2", 0);
    const id = await draftFor(fixture);
    await addItem(id, { name: "Tuition", amountPaisa: 1, frequency: "yearly" });
    await post(`/api/fees/structures/${id}/send`, {}, accountant);
    expect((await decide((await approvalFor(id))!, { approve: false, reason: "Tuition is wrong" })).status).toBe(200);
    expect(((await (await call(`/api/fees/structures/${id}`, { cookie: accountant.cookie })).json()) as { status: string }).status).toBe("draft");
  });

  it("an empty draft cannot be sent", async () => {
    const fixture = await classWith("plus2", 0);
    const id = await draftFor(fixture);
    expect((await post(`/api/fees/structures/${id}/send`, {}, accountant)).status).toBe(404);
  });
});

describe("charges", () => {
  let fixture: ClassFixture;
  let structureId: string;
  beforeAll(async () => {
    fixture = await classWith("plus2", 2);
    structureId = await draftFor(fixture);
    await addItem(structureId, { name: "Tuition", amountPaisa: 200_000, frequency: "monthly" });
    await addItem(structureId, { name: "Exam", amountPaisa: 50_000, frequency: "yearly" });
  });

  it("are refused before the structure is live", async () => {
    expect((await post(`/api/fees/structures/${structureId}/charges`, { classId: fixture.classId }, accountant)).status).toBe(409);
  });

  it("once live, generate every enrolled student's charges for the class, with the balance right and the chain whole", async () => {
    await post(`/api/fees/structures/${structureId}/send`, {}, accountant);
    await decide((await approvalFor(structureId))!, { approve: true }, superAdmin);
    const response = await post(`/api/fees/structures/${structureId}/charges`, { classId: fixture.classId }, accountant);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { created: number };
    expect(body.created).toBeGreaterThanOrEqual(2 * 2); // at least one month of tuition and the exam fee each
    const perStudent = await db
      .prepare("SELECT COUNT(*) AS n, SUM(amount_paisa) AS total FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1")
      .bind(fixture.pupils[0]!.enrollmentId)
      .first<{ n: number; total: number }>();
    expect(perStudent!.total).toBe((perStudent!.n - 1) * 200_000 + 50_000);
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
  });

  it("generating again changes nothing: charges are made once per student, item and period", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM ledger_entries");
    const response = await post(`/api/fees/structures/${structureId}/charges`, { classId: fixture.classId }, accountant);
    expect(((await response.json()) as { created: number }).created).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries")).toBe(before);
  });

  it("a student admitted later gets their charges on the next run", async () => {
    const late = await enrol(fixture.classId, "Latecomer");
    const response = await post(`/api/fees/structures/${structureId}/charges`, { classId: fixture.classId }, accountant);
    expect(((await response.json()) as { created: number }).created).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1", late.enrollmentId)).toBeGreaterThan(0);
  });

  it("a class of another level, the Co-ordinator, and the other section's Accountant get nothing", async () => {
    expect((await post(`/api/fees/structures/${structureId}/charges`, { classId: bachelors.classId }, accountant)).status).toBe(404);
    expect((await post(`/api/fees/structures/${structureId}/charges`, { classId: fixture.classId }, coordinator)).status).toBe(403);
    expect((await post(`/api/fees/structures/${structureId}/charges`, { classId: fixture.classId }, bachelorsAccountant)).status).toBe(404);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
