import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, nepalDate } from "../src/core/dates";
import { chargeLinked } from "../src/modules/fees";
import { billingSchedule } from "../src/modules/fees/policy";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { YEAR, approvalOf, approveStructure, draftStructure, idOf, link, liveFees, uniqueName } from "./fees-helpers";
import { classWith, enrol, type ClassFixture } from "./schoolday-helpers";

/**
 * Fee structures, their levels and automatic charges (D-172, written before the code that replaced D-075). The Accountant
 * drafts a named structure with a start and an end date and priced lines; the Principal approves it; it is then linked
 * to levels (no approval) and every student of those levels is charged, and a student who joins later too. The
 * Co-ordinator has no fees access at all. CLAUDE.md section 6: approve-and-apply is one batch, nobody approves their own
 * request, a changed subject goes stale.
 */

let plus2: ClassFixture, bachelors: ClassFixture;
let accountant: Person, plus2Accountant: Person, bachelorsAccountant: Person, admin: Person, coordinator: Person, student: Person;

beforeAll(async () => {
  plus2 = await classWith("plus2", 3);
  bachelors = await classWith("bachelors", 1);
  accountant = await person("accountant", "institution");
  plus2Accountant = await person("accountant", "section", "plus2");
  bachelorsAccountant = await person("accountant", "section", "bachelors");
  admin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  student = plus2.pupils[0]!.person;
});

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const get = async <T>(path: string, who: Person = accountant) => (await (await call(path, { cookie: who.cookie })).json()) as T;
type View = { id: string; name: string; status: string; startDate: string; endDate: string; totalPaisa: number; levelsLinked: number; items: { id: string; name: string; amountPaisa: number }[]; levels: { levelId: string; students: number }[] };
const view = (id: string, who: Person = accountant) => get<View>(`/api/fees/structures/${id}`, who);
const chargesOf = (enrollmentId: string) =>
  db
    .prepare("SELECT le.amount_paisa, le.due_on, le.period, le.memo, u.public_id AS actor FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN users u ON u.id = le.created_by_user_id WHERE en.public_id = ?1 AND le.kind = 'charge' ORDER BY le.id")
    .bind(enrollmentId)
    .all<{ amount_paisa: number; due_on: string; period: string; memo: string; actor: string }>()
    .then((r) => r.results);

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

  it("a line of a fee structure is due on the start date, or the day a later student joined (D-172)", () => {
    const joined = bsToAd({ year: 2083, month: 6, day: 12 });
    expect(billingSchedule({ frequency: "one_time" }, year, { enrolledOn: joined, firstInProgramme: true })).toEqual([{ period: "once", dueOn: joined }]);
    expect(billingSchedule({ frequency: "one_time" }, year, { enrolledOn: bsToAd({ year: 2082, month: 12, day: 1 }), firstInProgramme: true })).toEqual([{ period: "once", dueOn: year.startDate }]);
  });

  it("a student enrolled mid-year is billed monthly from their own month on (a structure from before D-172)", () => {
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
  it("the Accountant drafts a named structure in a wing, with dates and lines in whole paisa; the lines are the total", async () => {
    const id = await draftStructure(accountant, { sectionKey: "plus2", name: uniqueName("Grade 11"), items: [{ name: "Tuition", amountPaisa: 800_000 }, { name: "Admission", amountPaisa: 150_000 }, { name: "Exam", amountPaisa: 50_000 }] });
    const v = await view(id);
    expect(v).toMatchObject({ status: "draft", startDate: YEAR.startDate, endDate: YEAR.endDate, totalPaisa: 1_000_000, levelsLinked: 0 });
    expect(v.items.map((i) => i.name)).toEqual(["Tuition", "Admission", "Exam"]);
    const listed = await get<{ structures: { id: string }[] }>("/api/fees/structures");
    expect(listed.structures.some((s) => s.id === id)).toBe(true);
  });

  it("refuses fractions, zero, negatives, an end before the start, and the same name for the same start date in a wing", async () => {
    const name = uniqueName();
    const id = await draftStructure(accountant, { sectionKey: "bachelors", name, items: [] });
    for (const amountPaisa of [10.5, 0, -5]) expect((await post(`/api/fees/structures/${id}/items`, { name: "Fee", amountPaisa }, accountant)).status).toBe(400);
    expect((await post("/api/fees/structures", { name: uniqueName(), sectionKey: "plus2", startDate: YEAR.endDate, endDate: YEAR.startDate }, accountant)).status).toBe(422);
    expect((await post("/api/fees/structures", { name, sectionKey: "bachelors", startDate: YEAR.startDate, endDate: YEAR.endDate }, accountant)).status).toBe(409);
    // The same name for the next year is the reuse the PM asked for, and is fine.
    expect((await post("/api/fees/structures", { name, sectionKey: "bachelors", startDate: "2027-04-14", endDate: "2028-04-12" }, accountant)).status).toBe(201);
  });

  it("only the Accountant (and Super Admin) drafts; the Co-ordinator, the Principal and a student cannot; a section Accountant stays in their wing", async () => {
    const body = { name: uniqueName(), sectionKey: "plus2", startDate: YEAR.startDate, endDate: YEAR.endDate };
    for (const who of [coordinator, admin, student]) expect((await post("/api/fees/structures", body, who)).status).toBe(403);
    expect((await call("/api/fees/structures", { cookie: coordinator.cookie })).status).toBe(403);
    expect((await post("/api/fees/structures", { ...body, name: uniqueName() }, bachelorsAccountant)).status).toBe(404);
    expect((await post("/api/fees/structures", { ...body, name: uniqueName() }, plus2Accountant)).status).toBe(201);
    const mine = await get<{ structures: { sectionKey: string }[] }>("/api/fees/structures", bachelorsAccountant);
    expect(mine.structures.every((s) => s.sectionKey === "bachelors")).toBe(true);
  });
});

describe("approval", () => {
  let id: string;
  beforeAll(async () => {
    id = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 300_000 }] });
  });

  it("sending locks the draft; a line change is refused while it waits", async () => {
    expect((await post(`/api/fees/structures/${id}/send`, {}, accountant)).status).toBe(201);
    expect((await post(`/api/fees/structures/${id}/items`, { name: "Extra", amountPaisa: 100 }, accountant)).status).toBe(409);
    expect((await view(id)).status).toBe("waiting");
  });

  it("the Accountant cannot approve it; the Principal can, and it goes live, fixed", async () => {
    const requestId = (await approvalOf(id))!;
    expect((await post(`/api/approvals/${requestId}/approve`, undefined, accountant)).status).toBe(403);
    expect((await post(`/api/approvals/${requestId}/approve`, undefined, admin)).status).toBe(200);
    expect((await view(id)).status).toBe("live");
    expect((await post(`/api/fees/structures/${id}/items`, { name: "Late", amountPaisa: 100 }, accountant)).status).toBe(409);
    await expect(db.prepare("UPDATE fee_structures SET status = 'draft' WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/can only be superseded/);
    await expect(db.prepare("UPDATE fee_structures SET name = 'Other' WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/not a draft is fixed/);
    await expect(db.prepare("UPDATE fee_items SET amount_paisa = 1 WHERE structure_id = (SELECT id FROM fee_structures WHERE public_id = ?1)").bind(id).run()).rejects.toThrow(/only a draft/);
  });

  it("a declined structure goes back to draft for the Accountant to change", async () => {
    const declined = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 1 }] });
    await post(`/api/fees/structures/${declined}/send`, {}, accountant);
    expect((await post(`/api/approvals/${(await approvalOf(declined))!}/decline`, { reason: "Tuition is wrong" }, admin)).status).toBe(200);
    expect((await view(declined)).status).toBe("draft");
    expect((await post(`/api/fees/structures/${declined}/items`, { name: "Fixed", amountPaisa: 5 }, accountant)).status).toBe(201);
  });

  it("an empty draft cannot be sent", async () => {
    const empty = await draftStructure(accountant, { sectionKey: "plus2", items: [] });
    expect((await post(`/api/fees/structures/${empty}/send`, {}, accountant)).status).toBe(404);
  });

  it("the Accountant who sent it does not approve their own, and the request goes stale if a line changes", async () => {
    const own = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 70_000 }] });
    await post(`/api/fees/structures/${own}/send`, {}, accountant);
    const requestId = (await approvalOf(own))!;
    expect((await post(`/api/approvals/${requestId}/approve`, undefined, accountant)).status).toBe(403);
    // A change after sending is impossible through the API (it is locked), so make one in the database and see the engine refuse.
    await db.prepare("UPDATE fee_structures SET version = version + 1 WHERE public_id = ?1").bind(own).run();
    expect((await post(`/api/approvals/${requestId}/approve`, undefined, admin)).status).toBe(409);
    expect((await view(own)).status).toBe("waiting");
  });
});

describe("the next period of a structure", () => {
  let first: string;
  beforeAll(async () => {
    first = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 900_000 }, { name: "Library", amountPaisa: 25_000 }] });
    await approveStructure(accountant, admin, first);
  });

  it("is a new draft with the same name and wing, the new dates and the lines copied in, needing its own approval", async () => {
    const response = await post(`/api/fees/structures/${first}/next-period`, { startDate: "2027-04-14", endDate: "2028-04-12" }, accountant);
    expect(response.status).toBe(201);
    const next = await idOf(response);
    const [a, b] = [await view(first), await view(next)];
    expect(b).toMatchObject({ status: "draft", name: a.name, startDate: "2027-04-14", endDate: "2028-04-12", totalPaisa: 925_000 });
    expect(b.items.map((i) => [i.name, i.amountPaisa])).toEqual([["Tuition", 900_000], ["Library", 25_000]]);
    // The lines can be edited before it is sent, and the old period is untouched.
    expect((await post(`/api/fees/structures/${next}/items`, { name: "Lab", amountPaisa: 10_000 }, accountant)).status).toBe(201);
    expect((await view(first)).totalPaisa).toBe(925_000);
    // Not approved yet: it cannot be linked.
    const linked = await link(accountant, next, [plus2.levelId]);
    expect(linked.body.levels[0]).toMatchObject({ ok: false, reason: "not_live" });
  });

  it("the same dates for the same name are refused, and a stranger cannot start it", async () => {
    expect((await post(`/api/fees/structures/${first}/next-period`, { startDate: YEAR.startDate, endDate: "2028-04-12" }, accountant)).status).toBe(409);
    expect((await post(`/api/fees/structures/${first}/next-period`, { startDate: "2028-04-13", endDate: "2029-04-12" }, bachelorsAccountant)).status).toBe(404);
    expect((await post(`/api/fees/structures/${first}/next-period`, { startDate: "2028-04-13", endDate: "2029-04-12" }, coordinator)).status).toBe(403);
    expect((await post(`/api/fees/structures/${first}/next-period`, { startDate: "2029-04-13", endDate: "2028-04-12" }, accountant)).status).toBe(422);
  });
});

describe("linking to levels", () => {
  it("only an approved structure can be linked; linking needs no approval, and is audited", async () => {
    const draft = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 100_000 }] });
    const early = await link(accountant, draft, [plus2.levelId]);
    expect(early.status).toBe(200);
    expect(early.body.levels[0]).toMatchObject({ ok: false, reason: "not_live" });
    expect(early.body.charged).toBe(0);
    await approveStructure(accountant, admin, draft);
    const before = await count("SELECT COUNT(*) AS n FROM approval_requests");
    const now = await link(accountant, draft, [plus2.levelId]);
    expect(now.body.levels[0]).toMatchObject({ ok: true });
    expect(await count("SELECT COUNT(*) AS n FROM approval_requests")).toBe(before); // no request was made
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'fees.structure.linked' AND entity_public_id = (SELECT public_id FROM fee_structures WHERE public_id = ?1)", draft)).toBe(1);
    expect((await view(draft)).levelsLinked).toBe(1);
  });

  it("several levels share one structure, and a level of another wing is refused", async () => {
    const second = await classWith("plus2", 1);
    const id = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 100_000 }] });
    await approveStructure(accountant, admin, id);
    const linked = await link(accountant, id, [second.levelId, bachelors.levelId]);
    expect(linked.body.levels).toEqual([
      { levelId: second.levelId, ok: true },
      { levelId: bachelors.levelId, ok: false, reason: "wrong_wing" },
    ]);
    const v = await view(id);
    expect(v.levels.map((l) => l.levelId)).toEqual([second.levelId]);
    expect(v.levels[0]!.students).toBe(1);
  });

  it("a level has one structure for any dates: overlapping dates are refused, next year's are not", async () => {
    const level = await classWith("plus2", 1);
    const a = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [level.levelId] });
    const overlapping = await draftStructure(accountant, { sectionKey: "plus2", startDate: "2026-10-01", endDate: "2027-09-30" });
    await approveStructure(accountant, admin, overlapping);
    expect((await link(accountant, overlapping, [level.levelId])).body.levels[0]).toMatchObject({ ok: false, reason: "conflict" });
    // Linking the same structure twice is the same refusal.
    expect((await link(accountant, a, [level.levelId])).body.levels[0]).toMatchObject({ ok: false, reason: "conflict" });
    const nextYear = await draftStructure(accountant, { sectionKey: "plus2", startDate: "2027-04-14", endDate: "2028-04-12" });
    await approveStructure(accountant, admin, nextYear);
    const linkedNext = await link(accountant, nextYear, [level.levelId]);
    expect(linkedNext.body.levels[0]).toMatchObject({ ok: true });
    // The term of these students has ended before next year's structure begins: nobody is charged for it yet.
    expect(linkedNext.body.charged).toBe(0);
  });

  it("the Co-ordinator, the Principal and a student cannot link; a section Accountant links only their own wing's structure", async () => {
    const level = await classWith("plus2", 1);
    const id = await draftStructure(accountant, { sectionKey: "plus2" });
    await approveStructure(accountant, admin, id);
    for (const who of [coordinator, admin, student]) expect((await post(`/api/fees/structures/${id}/levels`, { levelIds: [level.levelId] }, who)).status).toBe(403);
    expect((await post(`/api/fees/structures/${id}/levels`, { levelIds: [level.levelId] }, bachelorsAccountant)).status).toBe(404);
    expect((await link(plus2Accountant, id, [level.levelId])).body.levels[0]).toMatchObject({ ok: true });
  });

  it("a link follows the structure, never changes in place, and is made by triggers a plain insert cannot get around", async () => {
    const level = await classWith("plus2", 1);
    const id = await draftStructure(accountant, { sectionKey: "plus2" });
    await expect(
      db.prepare("INSERT INTO level_fee_structures (level_id, root_id, linked_by_user_id, linked_at) SELECT l.id, s.id, u.id, 'x' FROM levels l, fee_structures s, users u WHERE l.public_id = ?1 AND s.public_id = ?2 AND u.public_id = ?3").bind(level.levelId, id, accountant.publicId).run(),
    ).rejects.toThrow(/only a live fee structure/);
    await approveStructure(accountant, admin, id);
    await link(accountant, id, [level.levelId]);
    await expect(db.prepare("UPDATE level_fee_structures SET level_id = level_id").run()).rejects.toThrow(/never changed/);
  });
});

describe("automatic charging", () => {
  let fixture: ClassFixture;
  let structureId: string;
  beforeAll(async () => {
    fixture = await classWith("plus2", 2);
    structureId = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 800_000 }, { name: "Exam", amountPaisa: 50_000 }] });
    await approveStructure(accountant, admin, structureId);
  });

  it("nothing is charged until the structure is linked to the level", async () => {
    expect(await chargesOf(fixture.pupils[0]!.enrollmentId)).toEqual([]);
    expect(await chargeLinked(db, auditKey)).toMatchObject({ pending: false });
    expect(await chargesOf(fixture.pupils[0]!.enrollmentId)).toEqual([]);
  });

  it("linking charges every student of the level once, each line due on the structure's last day, with the balance right and the chain whole", async () => {
    const linked = await link(accountant, structureId, [fixture.levelId]);
    expect(linked.body).toMatchObject({ charged: 4, pending: false });
    for (const pupil of fixture.pupils) {
      const charges = await chargesOf(pupil.enrollmentId);
      const joined = nepalDate(new Date((await db.prepare("SELECT created_at FROM enrollments WHERE public_id = ?1").bind(pupil.enrollmentId).first<{ created_at: string }>())!.created_at));
      expect(joined > YEAR.startDate).toBe(true);
      expect(charges.map((c) => [c.memo, c.amount_paisa, c.due_on])).toEqual([
        ["Tuition", 800_000, YEAR.endDate],
        ["Exam", 50_000, YEAR.endDate],
      ]);
      expect(charges.every((c) => c.actor === accountant.publicId)).toBe(true); // the one who linked
    }
    const account = await get<{ chargedPaisa: number; balancePaisa: number }>(`/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}`);
    expect(account).toMatchObject({ chargedPaisa: 850_000, balancePaisa: 850_000 });
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
  });

  it("running it again, by the sweep or for one enrollment, makes nothing", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM ledger_entries");
    expect(await chargeLinked(db, auditKey)).toEqual({ created: 0, pending: false });
    expect(await chargeLinked(db, auditKey, { enrollmentPublicId: fixture.pupils[0]!.enrollmentId })).toEqual({ created: 0, pending: false });
    expect(await chargeLinked(db, auditKey, { rootPublicId: structureId })).toEqual({ created: 0, pending: false });
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries")).toBe(before);
  });

  it("a student who joins later is charged as soon as they join (and by the sweep if that was missed)", async () => {
    const late = await enrol(fixture.classId, "Latecomer");
    expect(await chargesOf(late.enrollmentId)).toEqual([]);
    expect(await chargeLinked(db, auditKey, { enrollmentPublicId: late.enrollmentId })).toEqual({ created: 2, pending: false });
    expect((await chargesOf(late.enrollmentId)).map((c) => c.amount_paisa)).toEqual([800_000, 50_000]);
    const missed = await enrol(fixture.classId, "Missed");
    expect(await chargeLinked(db, auditKey)).toMatchObject({ created: 2 }); // the sweep finds them
    expect((await chargesOf(missed.enrollmentId)).length).toBe(2);
  });

  it("a class of another level gets nothing, and a student sees their own charges but not another's", async () => {
    expect(await chargesOf(bachelors.pupils[0]!.enrollmentId)).toEqual([]);
    const own = fixture.pupils[0]!;
    const mine = await call("/api/fees/me", { cookie: own.person.cookie });
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { chargedPaisa: number }).chargedPaisa).toBe(850_000);
    expect((await call(`/api/fees/enrollments/${fixture.pupils[1]!.enrollmentId}`, { cookie: own.person.cookie })).status).toBe(404);
  });

  it("a structure whose dates do not meet the pupils' term charges them nothing, and a closed term is never charged", async () => {
    const far = await classWith("plus2", 1);
    await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [far.levelId], startDate: "2030-04-14", endDate: "2031-04-12" });
    expect(await chargesOf(far.pupils[0]!.enrollmentId)).toEqual([]);
  });

  it("a level linked to a structure bills the lines of the live version only, and a line switched off before approval is not billed", async () => {
    const level = await classWith("plus2", 1);
    const id = await draftStructure(accountant, { sectionKey: "plus2", items: [{ name: "Tuition", amountPaisa: 100_000 }, { name: "Dropped", amountPaisa: 9_000 }] });
    const dropped = (await view(id)).items.find((i) => i.name === "Dropped")!;
    expect((await call(`/api/fees/items/${dropped.id}`, { method: "PATCH", body: { isActive: false }, cookie: accountant.cookie })).status).toBe(200);
    await approveStructure(accountant, admin, id);
    await link(accountant, id, [level.levelId]);
    expect((await chargesOf(level.pupils[0]!.enrollmentId)).map((c) => c.memo)).toEqual(["Tuition"]);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});

describe("unlinking", () => {
  it("is allowed before anyone has paid, and the level can then take another structure", async () => {
    const level = await classWith("plus2", 1);
    const id = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [level.levelId] });
    const gone = await call(`/api/fees/structures/${id}/levels/${level.levelId}`, { method: "DELETE", cookie: accountant.cookie });
    expect(gone.status).toBe(200);
    expect((await view(id)).levelsLinked).toBe(0);
    const other = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [level.levelId] });
    expect((await view(other)).levelsLinked).toBe(1);
  });

  it("is refused once any student of the level, charged under it, has paid anything: the link is in use", async () => {
    const level = await classWith("plus2", 2);
    const id = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [level.levelId] });
    const paid = await post("/api/fees/payments/cash", { enrollmentId: level.pupils[1]!.enrollmentId, amountPaisa: 1_000, idempotencyKey: `unlink-${Math.random().toString(36).slice(2)}0000000` }, accountant);
    expect(paid.status).toBe(201);
    const refused = await call(`/api/fees/structures/${id}/levels/${level.levelId}`, { method: "DELETE", cookie: accountant.cookie });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "in_use" });
    expect((await view(id)).levelsLinked).toBe(1);
    // The database itself refuses, whoever asks, so no code path can drop it.
    await expect(db.prepare("DELETE FROM level_fee_structures WHERE level_id = (SELECT id FROM levels WHERE public_id = ?1)").bind(level.levelId).run()).rejects.toThrow(/fees are in use/);
  });

  it("a payment by a student of another level does not hold this level's link", async () => {
    const quiet = await classWith("plus2", 1);
    const busy = await classWith("plus2", 1);
    const id = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [quiet.levelId, busy.levelId] });
    await post("/api/fees/payments/cash", { enrollmentId: busy.pupils[0]!.enrollmentId, amountPaisa: 500, idempotencyKey: `other-${Math.random().toString(36).slice(2)}0000000` }, accountant);
    expect((await call(`/api/fees/structures/${id}/levels/${quiet.levelId}`, { method: "DELETE", cookie: accountant.cookie })).status).toBe(200);
    expect((await call(`/api/fees/structures/${id}/levels/${busy.levelId}`, { method: "DELETE", cookie: accountant.cookie })).status).toBe(409);
  });

  it("the Co-ordinator, a student and another wing's Accountant cannot unlink", async () => {
    const level = await classWith("plus2", 1);
    const id = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [level.levelId] });
    for (const who of [coordinator, admin, student]) expect((await call(`/api/fees/structures/${id}/levels/${level.levelId}`, { method: "DELETE", cookie: who.cookie })).status).toBe(403);
    expect((await call(`/api/fees/structures/${id}/levels/${level.levelId}`, { method: "DELETE", cookie: bachelorsAccountant.cookie })).status).toBe(404);
  });
});
