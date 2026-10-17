import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { applyPriceChanges, chargeLinked } from "../src/modules/fees";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { approvalOf, draftStructure, idOf, liveFees } from "./fees-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Editing an approved fee structure (D-172, slice 3), written before the code. The Accountant asks, with a reason; the
 * Principal decides the request; a draft copy appears; the Accountant edits it and sends it; the Principal approves it. The
 * approved version stays in force until then. When the new version goes live, each student's billing is brought to its prices
 * by new ledger entries: a lower price makes a discount entry (a student who had paid in full shows a credit), a higher one an
 * extra charge. The Principal's approval covers that. Nobody approves their own request; a repeat changes nothing.
 */

let accountant: Person, otherAccountant: Person, admin: Person, secondAdmin: Person, coordinator: Person;

beforeAll(async () => {
  await classWith("bachelors", 1);
  await classWith("plus2", 1);
  accountant = await person("accountant", "institution");
  otherAccountant = await person("accountant", "section", "bachelors");
  admin = await person("admin", "institution");
  secondAdmin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
});

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const patch = (path: string, body: unknown, who: Person) => call(path, { method: "PATCH", body, cookie: who.cookie });
type View = { id: string; status: string; editing: boolean; editRequested: boolean; totalPaisa: number; inForce: { id: string; totalPaisa: number } | null; items: { id: string; name: string; amountPaisa: number }[] };
const view = async (id: string, who: Person = accountant) => (await (await call(`/api/fees/structures/${id}`, { cookie: who.cookie })).json()) as View;
type Account = { chargedPaisa: number; discountPaisa: number; paidPaisa: number; balancePaisa: number; creditPaisa: number };
const account = async (enrollmentId: string) => (await (await call(`/api/fees/enrollments/${enrollmentId}`, { cookie: accountant.cookie })).json()) as Account;
const pay = (enrollmentId: string, amountPaisa: number) =>
  post("/api/fees/payments/cash", { enrollmentId, amountPaisa, idempotencyKey: `edit-${crypto.randomUUID().replace(/-/g, "")}` }, accountant);
const entries = (enrollmentId: string) =>
  db
    .prepare("SELECT le.kind, le.amount_paisa, le.source_type, le.memo FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1 ORDER BY le.id")
    .bind(enrollmentId)
    .all<{ kind: string; amount_paisa: number; source_type: string | null; memo: string | null }>()
    .then((r) => r.results);

/** A structure live for a class of two, Tuition 800.00 and Exam 200.00, the first pupil paid in full. */
async function scene() {
  const fixture = await classWith("plus2", 2);
  const id = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [fixture.levelId], items: [{ name: "Tuition", amountPaisa: 800_000 }, { name: "Exam", amountPaisa: 200_000 }] });
  expect((await pay(fixture.pupils[0]!.enrollmentId, 1_000_000)).status).toBe(201);
  return { fixture, id };
}

/** Asks, has the Principal approve, and returns the draft version's id. */
async function openEdit(id: string, reason = "Tuition changes for the new session"): Promise<string> {
  const asked = await post(`/api/fees/structures/${id}/edit-request`, { reason }, accountant);
  expect(asked.status, await asked.clone().text()).toBe(201);
  const requestId = await idOf(asked);
  expect((await post(`/api/approvals/${requestId}/approve`, undefined, admin)).status).toBe(200);
  const v = await view(id);
  expect(v.editing).toBe(true);
  return v.id;
}
const change = async (draftId: string, name: string, amountPaisa: number) => {
  const item = (await view(draftId)).items.find((i) => i.name === name)!;
  expect((await patch(`/api/fees/items/${item.id}`, { amountPaisa }, accountant)).status).toBe(200);
};
const sendAndApprove = async (draftId: string) => {
  expect((await post(`/api/fees/structures/${draftId}/send`, {}, accountant)).status).toBe(201);
  const approved = await post(`/api/approvals/${(await approvalOf(draftId))!}/approve`, undefined, admin);
  expect(approved.status, await approved.clone().text()).toBe(200);
};

describe("asking to edit an approved structure", () => {
  it("the Accountant asks with a reason; the approved version stays in force, charges untouched, and nothing is drafted yet", async () => {
    const { fixture, id } = await scene();
    const before = await entries(fixture.pupils[0]!.enrollmentId);
    const asked = await post(`/api/fees/structures/${id}/edit-request`, { reason: "Tuition changes" }, accountant);
    expect(asked.status).toBe(201);
    const v = await view(id);
    expect(v).toMatchObject({ status: "live", editing: false, editRequested: true, totalPaisa: 1_000_000 });
    expect(await entries(fixture.pupils[0]!.enrollmentId)).toEqual(before);
    // The Principal sees it in the inbox with the reason, the lines and the total.
    const inbox = (await (await call(`/api/approvals/${await idOf(asked)}`, { cookie: admin.cookie })).json()) as { request: { kind: string }; detail: { kind: string; reason: string; totalPaisa: number; items: unknown[] } };
    expect(inbox.request.kind).toBe("fee_structure_edit");
    expect(inbox.detail).toMatchObject({ kind: "fee_structure_edit", reason: "Tuition changes", totalPaisa: 1_000_000 });
    expect(inbox.detail.items).toHaveLength(2);
  });

  it("needs a reason; only the Accountant of the wing asks; a second request while one is open is refused; a draft cannot be edited", async () => {
    const { id } = await scene();
    expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "x" }, accountant)).status).toBe(400);
    for (const who of [coordinator, admin]) expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "Because" }, who)).status).toBe(403);
    expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "Because" }, otherAccountant)).status).toBe(404);
    expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "First" }, accountant)).status).toBe(201);
    expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "Second" }, accountant)).status).toBe(409);
    const draft = await draftStructure(accountant, { sectionKey: "plus2" });
    expect((await post(`/api/fees/structures/${draft}/edit-request`, { reason: "Not approved yet" }, accountant)).status).toBe(404);
  });

  it("the Accountant cannot approve it, and the Principal can decline it with a reason: nothing is drafted", async () => {
    const { id } = await scene();
    const requestId = await idOf(await post(`/api/fees/structures/${id}/edit-request`, { reason: "Change" }, accountant));
    expect((await post(`/api/approvals/${requestId}/approve`, undefined, accountant)).status).toBe(403);
    expect((await post(`/api/approvals/${requestId}/decline`, { reason: "Not this term" }, admin)).status).toBe(200);
    expect(await view(id)).toMatchObject({ status: "live", editing: false, editRequested: false });
    // A new request can be made after a decline.
    expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "Again" }, accountant)).status).toBe(201);
  });

  it("approving makes a draft copy of the version in force: same lines, editable, the approved one still live", async () => {
    const { id } = await scene();
    const draftId = await openEdit(id);
    expect(draftId).not.toBe(id);
    const draft = await view(draftId);
    expect(draft).toMatchObject({ status: "draft", editing: true, totalPaisa: 1_000_000, inForce: { id, totalPaisa: 1_000_000 } });
    expect(draft.items.map((i) => [i.name, i.amountPaisa])).toEqual([["Tuition", 800_000], ["Exam", 200_000]]);
    // The version in force is read by its own id too, and is fixed.
    expect(await db.prepare("SELECT status FROM fee_structures WHERE public_id = ?1").bind(id).first()).toEqual({ status: "live" });
    expect((await post(`/api/fees/structures/${id}/items`, { name: "Late", amountPaisa: 100 }, accountant)).status).toBe(409);
    // While it is a draft, no second edit can be asked for.
    expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "More" }, accountant)).status).toBe(404);
  });

  it("a draft edit can be given up: the approved version is untouched and a new edit can be asked for", async () => {
    const { id } = await scene();
    const draftId = await openEdit(id);
    await change(draftId, "Tuition", 1);
    expect((await post(`/api/fees/structures/${draftId}/discard`, {}, otherAccountant)).status).toBe(404);
    expect((await post(`/api/fees/structures/${draftId}/discard`, {}, coordinator)).status).toBe(403);
    expect((await post(`/api/fees/structures/${draftId}/discard`, {}, accountant)).status).toBe(200);
    expect(await view(id)).toMatchObject({ status: "live", editing: false, totalPaisa: 1_000_000 });
    // The approved version itself cannot be discarded.
    expect((await post(`/api/fees/structures/${id}/discard`, {}, accountant)).status).toBe(404);
    await expect(db.prepare("UPDATE fee_structures SET status = 'discarded' WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/can only be superseded|can be discarded/);
    expect((await post(`/api/fees/structures/${id}/edit-request`, { reason: "A better edit" }, accountant)).status).toBe(201);
  });
});

describe("the new version goes live: prices corrected by new entries", () => {
  it("a price that goes down gives a discount entry; the student who paid in full shows a credit, the other owes less", async () => {
    const { fixture, id } = await scene();
    const [paid, unpaid] = [fixture.pupils[0]!.enrollmentId, fixture.pupils[1]!.enrollmentId];
    const draftId = await openEdit(id);
    await change(draftId, "Tuition", 700_000);
    await sendAndApprove(draftId);
    expect(await view(draftId)).toMatchObject({ status: "live", editing: false, totalPaisa: 900_000, inForce: null });
    expect(await account(paid)).toMatchObject({ chargedPaisa: 1_000_000, discountPaisa: 100_000, paidPaisa: 1_000_000, balancePaisa: -100_000, creditPaisa: 100_000 });
    expect(await account(unpaid)).toMatchObject({ chargedPaisa: 1_000_000, discountPaisa: 100_000, balancePaisa: 900_000, creditPaisa: 0 });
    expect((await entries(paid)).filter((e) => e.source_type === "price_change").map((e) => [e.kind, e.amount_paisa, e.memo])).toEqual([["discount", -100_000, "Price change: Tuition"]]);
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
  });

  it("a price that goes up gives an extra charge on every student's billing, paid or not", async () => {
    const { fixture, id } = await scene();
    const draftId = await openEdit(id);
    await change(draftId, "Exam", 250_000);
    await sendAndApprove(draftId);
    expect(await account(fixture.pupils[0]!.enrollmentId)).toMatchObject({ chargedPaisa: 1_050_000, paidPaisa: 1_000_000, balancePaisa: 50_000 });
    expect(await account(fixture.pupils[1]!.enrollmentId)).toMatchObject({ chargedPaisa: 1_050_000, balancePaisa: 1_050_000 });
    const extra = (await entries(fixture.pupils[1]!.enrollmentId)).filter((e) => e.memo === "Price change: Exam");
    expect(extra.map((e) => [e.kind, e.amount_paisa])).toEqual([["charge", 50_000]]);
  });

  it("a second edit corrects from what was billed after the first: down then up, and the nets are right", async () => {
    const { fixture, id } = await scene();
    const first = await openEdit(id);
    await change(first, "Tuition", 700_000);
    await sendAndApprove(first);
    const second = await openEdit(first, "Raise it again");
    await change(second, "Tuition", 750_000);
    await sendAndApprove(second);
    expect(await view(second)).toMatchObject({ totalPaisa: 950_000 });
    const unpaid = await account(fixture.pupils[1]!.enrollmentId);
    // Billed 1,000 at first, 100 off, then 50 back on: 950 owed in all.
    expect(unpaid.chargedPaisa - unpaid.discountPaisa).toBe(950_000);
    expect(unpaid.balancePaisa).toBe(950_000);
  });

  it("the corrections are made once: running them again, or approving again, changes nothing", async () => {
    const { fixture, id } = await scene();
    const draftId = await openEdit(id);
    await change(draftId, "Tuition", 600_000);
    await sendAndApprove(draftId);
    const before = await count("SELECT COUNT(*) AS n FROM ledger_entries");
    expect(await applyPriceChanges(db, auditKey)).toEqual({ created: 0, pending: false });
    expect(await applyPriceChanges(db, auditKey, { rootPublicId: id })).toEqual({ created: 0, pending: false });
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries")).toBe(before);
    expect(await account(fixture.pupils[1]!.enrollmentId)).toMatchObject({ discountPaisa: 200_000 });
  });

  it("a new line is charged to every student by the sweep, in full; a removed line stays as billed and is not charged again", async () => {
    const { fixture, id } = await scene();
    const draftId = await openEdit(id);
    expect((await post(`/api/fees/structures/${draftId}/items`, { name: "Library", amountPaisa: 30_000 }, accountant)).status).toBe(201);
    const exam = (await view(draftId)).items.find((i) => i.name === "Exam")!;
    expect((await patch(`/api/fees/items/${exam.id}`, { isActive: false }, accountant)).status).toBe(200);
    await sendAndApprove(draftId);
    // The new line is charged by the sweep (or the approval's own step), once.
    await chargeLinked(db, auditKey);
    await chargeLinked(db, auditKey);
    const mine = (await entries(fixture.pupils[1]!.enrollmentId)).filter((e) => e.kind === "charge").map((e) => [e.memo, e.amount_paisa]);
    expect(mine).toEqual([["Tuition", 800_000], ["Exam", 200_000], ["Library", 30_000]]);
    // A student who joins later is charged the lines of the version in force, with no corrections owed.
    const late = await classWith("plus2", 0);
    expect(late.pupils).toHaveLength(0);
  });

  it("a decline sends the new version back to draft with the approved one still in force and nothing corrected", async () => {
    const { fixture, id } = await scene();
    const draftId = await openEdit(id);
    await change(draftId, "Tuition", 100_000);
    expect((await post(`/api/fees/structures/${draftId}/send`, {}, accountant)).status).toBe(201);
    expect((await post(`/api/approvals/${(await approvalOf(draftId))!}/decline`, { reason: "Too low" }, admin)).status).toBe(200);
    expect(await view(id)).toMatchObject({ status: "draft", editing: true, inForce: { id, totalPaisa: 1_000_000 } });
    expect(await account(fixture.pupils[1]!.enrollmentId)).toMatchObject({ discountPaisa: 0, balancePaisa: 1_000_000 });
  });

  it("two Principals approving the same version at once: one wins, the corrections are made once", async () => {
    const { fixture, id } = await scene();
    const draftId = await openEdit(id);
    await change(draftId, "Tuition", 500_000);
    expect((await post(`/api/fees/structures/${draftId}/send`, {}, accountant)).status).toBe(201);
    const requestId = (await approvalOf(draftId))!;
    const [a, b] = await Promise.all([post(`/api/approvals/${requestId}/approve`, undefined, admin), post(`/api/approvals/${requestId}/approve`, undefined, secondAdmin)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await account(fixture.pupils[1]!.enrollmentId)).toMatchObject({ discountPaisa: 300_000, balancePaisa: 700_000 });
    expect(await count("SELECT COUNT(*) AS n FROM fee_structures WHERE status = 'live' AND COALESCE(root_id, id) = (SELECT COALESCE(root_id, id) FROM fee_structures WHERE public_id = ?1)", id)).toBe(1);
  });

  it("only one version of a structure is ever live, and a superseded one is final", async () => {
    const { id } = await scene();
    const draftId = await openEdit(id);
    await sendAndApprove(draftId);
    expect(await db.prepare("SELECT status FROM fee_structures WHERE public_id = ?1").bind(id).first()).toEqual({ status: "superseded" });
    await expect(db.prepare("UPDATE fee_structures SET status = 'live' WHERE public_id = ?1").bind(id).run()).rejects.toThrow(/final/);
  });

  it("the audit chain is unbroken", async () => {
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});

describe("a student charged under an edited structure", () => {
  it("is charged by a later version's lines only for what they were not billed, and the level's link follows the structure", async () => {
    const { fixture, id } = await scene();
    const draftId = await openEdit(id);
    await change(draftId, "Tuition", 900_000);
    await sendAndApprove(draftId);
    // The link points at the structure, so the new version bills a student who joins now at once, at the new prices.
    const { enrol } = await import("./schoolday-helpers");
    const joiner = await enrol(fixture.classId, "AfterEdit");
    await chargeLinked(db, auditKey, { enrollmentPublicId: joiner.enrollmentId });
    expect((await entries(joiner.enrollmentId)).filter((e) => e.kind === "charge").map((e) => [e.memo, e.amount_paisa])).toEqual([["Tuition", 900_000], ["Exam", 200_000]]);
    expect(await account(joiner.enrollmentId)).toMatchObject({ chargedPaisa: 1_100_000, balancePaisa: 1_100_000 });
  });
});

export type { ClassFixture };
