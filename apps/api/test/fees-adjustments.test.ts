import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { liveFees } from "./fees-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Discounts, reversals and refunds (D-172, slice 4; first written as D-077). The Principal alone gives a discount, on the
 * student's fees page, with no approval, never more than the fees in all. For 15 days the Principal can change or remove
 * it (a new ledger entry that cancels the old one); then it is frozen. A payment is never deleted: a mistake is reversed,
 * and the Admin approves every reversal. The Accountant pays back credit on their own, up to the credit and no more.
 */

let fixture: ClassFixture;
let accountant: Person, otherAccountant: Person, admin: Person, secondAdmin: Person, coordinator: Person;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const patch = (path: string, body: unknown, who: Person) => call(path, { method: "PATCH", body, cookie: who.cookie });
const remove = (path: string, who: Person) => call(path, { method: "DELETE", cookie: who.cookie });
const key = () => crypto.randomUUID().replace(/-/g, "");
const account = async (pupil = 0) =>
  (await (await call(`/api/fees/enrollments/${fixture.pupils[pupil]!.enrollmentId}`, { cookie: accountant.cookie })).json()) as {
    chargedPaisa: number;
    discountPaisa: number;
    paidPaisa: number;
    refundedPaisa: number;
    balancePaisa: number;
    creditPaisa: number;
    receipts: { id: string; reversed: boolean }[];
    entries: { id: string; kind: string; amountPaisa: number }[];
  };
const discountsPath = (pupil: number) => `/api/fees/enrollments/${fixture.pupils[pupil]!.enrollmentId}/discounts`;
const give = async (pupil: number, body: unknown, who: Person = admin) => {
  const response = await post(discountsPath(pupil), body, who);
  return { status: response.status, id: response.status === 201 ? ((await response.json()) as { id: string }).id : "" };
};
const requestOf = async (adjustmentId: string) =>
  (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(adjustmentId).first<{ public_id: string }>())!.public_id;
const approve = (requestId: string, who: Person = admin) => post(`/api/approvals/${requestId}/approve`, undefined, who);

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  otherAccountant = await person("accountant", "section", "bachelors");
  admin = await person("admin", "institution");
  secondAdmin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  fixture = await classWith("plus2", 4);
  await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [fixture.levelId], items: [{ name: "Annual fee", amountPaisa: 400_000 }] });
});

afterEach(() => vi.useRealTimers());

describe("discounts", () => {
  it("the Principal gives one and it applies at once, with no approval; the ledger has it once", async () => {
    const given = await give(0, { percent: 25, reason: "scholarship" });
    expect(given.status).toBe(201);
    expect(await account()).toMatchObject({ discountPaisa: 100_000, balancePaisa: 300_000 });
    expect(await count("SELECT COUNT(*) AS n FROM approval_requests WHERE subject_public_id = ?1", given.id)).toBe(0);
    const listed = (await (await call(discountsPath(0), { cookie: accountant.cookie })).json()) as { discounts: { id: string; amountPaisa: number; canChange: boolean; status: string }[] };
    expect(listed.discounts).toMatchObject([{ id: given.id, amountPaisa: 100_000, canChange: true, status: "active" }]);
  });

  it("an amount works too; 'Other' needs a note; unknown reasons, fractions and more than the fees are refused", async () => {
    expect((await give(1, { amountPaisa: 5_000, reason: "other" })).status).toBe(422);
    expect((await give(1, { amountPaisa: 5_000, reason: "loyalty" })).status).toBe(400);
    expect((await give(1, { amountPaisa: 50.5, reason: "sibling" })).status).toBe(400);
    expect((await give(1, { amountPaisa: 400_001, reason: "sibling" })).status).toBe(422);
    expect((await give(1, { amountPaisa: 5_000, percent: 5, reason: "sibling" })).status).toBe(400);
    expect((await give(1, { amountPaisa: 5_000, reason: "other", note: "Hardship, per the Principal" })).status).toBe(201);
  });

  it("discounts together never exceed the fees, also when two Principals give at the same moment", async () => {
    const room = (await account(2)).chargedPaisa;
    const results = await Promise.all([give(2, { amountPaisa: room - 1_000, reason: "scholarship" }, admin), give(2, { amountPaisa: room - 1_000, reason: "sibling" }, secondAdmin)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const after = await account(2);
    expect(after.discountPaisa).toBe(room - 1_000);
    expect(after.balancePaisa).toBe(1_000);
    expect((await give(2, { amountPaisa: 2_000, reason: "sibling" })).status).toBe(422);
    expect((await give(2, { amountPaisa: 1_000, reason: "sibling" })).status).toBe(201); // exactly what is left
  });

  it("only the Principal gives or changes one: the Accountant, the Co-ordinator and a stranger cannot", async () => {
    for (const who of [accountant, coordinator, otherAccountant]) expect((await give(0, { amountPaisa: 100, reason: "sibling" }, who)).status).toBe(403);
    const mine = await give(3, { amountPaisa: 1_000, reason: "sibling" });
    for (const who of [accountant, coordinator]) {
      expect((await patch(`/api/fees/discounts/${mine.id}`, { amountPaisa: 2_000, reason: "sibling" }, who)).status).toBe(403);
      expect((await remove(`/api/fees/discounts/${mine.id}`, who)).status).toBe(403);
    }
  });
});

describe("changing or removing a discount, inside 15 days", () => {
  it("changing it takes the old one back and gives the new one, in one step: the net is the new amount", async () => {
    const first = await give(1, { amountPaisa: 20_000, reason: "sibling" });
    const before = await account(1);
    const changed = await patch(`/api/fees/discounts/${first.id}`, { amountPaisa: 30_000, reason: "scholarship" }, admin);
    expect(changed.status).toBe(200);
    const after = await account(1);
    expect(after.discountPaisa).toBe(before.discountPaisa + 10_000);
    expect(after.balancePaisa).toBe(before.balancePaisa - 10_000);
    const listed = (await (await call(discountsPath(1), { cookie: admin.cookie })).json()) as { discounts: { id: string; status: string; amountPaisa: number }[] };
    expect(listed.discounts.find((d) => d.id === first.id)?.status).toBe("replaced");
    const newId = ((await changed.json()) as { id: string }).id;
    expect(listed.discounts.find((d) => d.id === newId)).toMatchObject({ status: "active", amountPaisa: 30_000 });
    // The old entry is not edited: a positive entry cancels it, and the chain holds.
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
  });

  it("removing it gives the money back to the bill: the student owes it again", async () => {
    const before = await account(3);
    const given = await give(3, { amountPaisa: 4_000, reason: "staff_child" });
    expect((await account(3)).balancePaisa).toBe(before.balancePaisa - 4_000);
    expect((await remove(`/api/fees/discounts/${given.id}`, admin)).status).toBe(200);
    expect(await account(3)).toMatchObject({ discountPaisa: before.discountPaisa, balancePaisa: before.balancePaisa });
    // Once: a second removal, or a change of a removed discount, is refused.
    expect((await remove(`/api/fees/discounts/${given.id}`, admin)).status).toBe(409);
    expect((await patch(`/api/fees/discounts/${given.id}`, { amountPaisa: 100, reason: "sibling" }, admin)).status).toBe(409);
  });

  it("a change that would take the discounts past the fees is refused and leaves the old one as it was", async () => {
    const given = await give(0, { amountPaisa: 1_000, reason: "sibling" });
    const before = await account(0);
    expect((await patch(`/api/fees/discounts/${given.id}`, { amountPaisa: before.chargedPaisa, reason: "sibling" }, admin)).status).toBe(422);
    expect(await account(0)).toMatchObject({ discountPaisa: before.discountPaisa });
  });

  it("two Principals removing the same discount at once: one wins, it is undone once", async () => {
    const given = await give(1, { amountPaisa: 3_000, reason: "sibling" });
    const before = await account(1);
    const results = await Promise.all([remove(`/api/fees/discounts/${given.id}`, admin), remove(`/api/fees/discounts/${given.id}`, secondAdmin)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await account(1)).discountPaisa).toBe(before.discountPaisa - 3_000);
  });

  it("after 15 days it is frozen: no change, no removal, for anyone", async () => {
    const given = await give(1, { amountPaisa: 2_000, reason: "sibling" });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 16 * 86_400_000 });
    const later = await person("admin", "institution"); // a token minted on the later day
    expect((await patch(`/api/fees/discounts/${given.id}`, { amountPaisa: 1_000, reason: "sibling" }, later)).status).toBe(409);
    expect((await remove(`/api/fees/discounts/${given.id}`, later)).status).toBe(409);
    const listed = (await (await call(discountsPath(1), { cookie: later.cookie })).json()) as { discounts: { id: string; canChange: boolean }[] };
    expect(listed.discounts.find((d) => d.id === given.id)?.canChange).toBe(false);
  });

  it("the window carries over a change: a replacement does not get a fresh 15 days", async () => {
    const first = await give(3, { amountPaisa: 500, reason: "sibling" });
    expect(first.status).toBe(201);
    const original = await db.prepare("SELECT window_ends_at FROM student_discounts WHERE public_id = ?1").bind(first.id).first<{ window_ends_at: string }>();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 10 * 86_400_000 });
    const later = await person("admin", "institution");
    const changed = await patch(`/api/fees/discounts/${first.id}`, { amountPaisa: 400, reason: "sibling" }, later);
    expect(changed.status).toBe(200);
    const next = await db.prepare("SELECT window_ends_at FROM student_discounts WHERE public_id = ?1").bind(((await changed.json()) as { id: string }).id).first<{ window_ends_at: string }>();
    expect(next!.window_ends_at).toBe(original!.window_ends_at);
  });

  it("the database refuses what the service would not: a discount row is never edited or deleted, an undo cancels one discount once, in full", async () => {
    await expect(db.prepare("DELETE FROM student_discounts").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("UPDATE student_discounts SET amount_paisa = amount_paisa + 1").run()).rejects.toThrow(/only moves/);
    const row = await db.prepare("SELECT le.public_id AS entry, en.public_id AS enrollment FROM student_discounts sd JOIN ledger_entries le ON le.id = sd.entry_id JOIN enrollments en ON en.id = sd.enrollment_id WHERE sd.status = 'active' LIMIT 1").first<{ entry: string; enrollment: string }>();
    const bad = (amount: number, refers: string | null) =>
      db
        .prepare(
          `INSERT INTO ledger_entries (public_id, enrollment_id, kind, amount_paisa, refers_to_id, created_by_user_id, created_at, prev_hash, hash)
           SELECT ?1, en.id, 'discount', ?2, (SELECT id FROM ledger_entries WHERE public_id = ?3), 1, 'now', (SELECT last_hash FROM ledger_chain_head), ?1 FROM enrollments en WHERE en.public_id = ?4`,
        )
        .bind(crypto.randomUUID().replace(/-/g, ""), amount, refers, row!.enrollment)
        .run();
    await expect(bad(7, row!.entry)).rejects.toThrow(/in full/); // not the discount's own amount
    await expect(bad(5, null)).rejects.toThrow(/CHECK/); // a positive discount must point at one
    const payment = await db.prepare("SELECT public_id FROM ledger_entries WHERE kind = 'payment' LIMIT 1").first<{ public_id: string }>();
    if (payment) await expect(bad(5, payment.public_id)).rejects.toThrow();
  });
});

describe("reversals", () => {
  let paymentId: string;
  beforeAll(async () => {
    paymentId = ((await (await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[1]!.enrollmentId, amountPaisa: 50_000, idempotencyKey: key() }, accountant)).json()) as { paymentId: string }).paymentId;
  });

  it("a reversal needs an Admin; once approved the payment is cancelled in full by a new entry, and its receipt shows it", async () => {
    const before = await account(1);
    const requested = await post(`/api/fees/payments/${paymentId}/reversal`, { reason: "Entered against the wrong student" }, accountant);
    expect(requested.status).toBe(201);
    const { id } = (await requested.json()) as { id: string };
    expect((await account(1)).paidPaisa).toBe(before.paidPaisa);
    expect((await approve(await requestOf(id))).status).toBe(200);
    const after = await account(1);
    expect(after.paidPaisa).toBe(before.paidPaisa - 50_000);
    expect(after.entries.find((e) => e.id === paymentId)).toBeTruthy(); // never deleted
    expect(after.receipts.find((r) => r.reversed)).toBeTruthy();
  });

  it("a payment is reversed once; a reason is required; a non-payment cannot be reversed", async () => {
    expect((await post(`/api/fees/payments/${paymentId}/reversal`, { reason: "Again" }, accountant)).status).toBe(409);
    const other = ((await (await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[1]!.enrollmentId, amountPaisa: 100, idempotencyKey: key() }, accountant)).json()) as { paymentId: string }).paymentId;
    expect((await post(`/api/fees/payments/${other}/reversal`, {}, accountant)).status).toBe(400);
    const charge = (await account(1)).entries.find((e) => e.kind === "charge")!.id;
    expect((await post(`/api/fees/payments/${charge}/reversal`, { reason: "Not a payment" }, accountant)).status).toBe(404);
  });
});

describe("refunds of credit", () => {
  const refund = (pupil: number, body: unknown, who: Person = accountant) => post(`/api/fees/enrollments/${fixture.pupils[pupil]!.enrollmentId}/refunds`, body, who);

  it("the Accountant pays back credit on their own, up to the credit: it is in the ledger at once, with how it was paid", async () => {
    // Pupil 0: 400,000 less the 100,000 discount is 300,000; pays 350,000, so 50,000 is credit.
    await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: 350_000, idempotencyKey: key() }, accountant);
    expect((await account()).creditPaisa).toBeGreaterThanOrEqual(49_000);
    const credit = (await account()).creditPaisa;
    expect((await refund(0, { amountPaisa: credit + 1, method: "cash" })).status).toBe(422);
    const done = await refund(0, { amountPaisa: credit, method: "bank_transfer", reference: "NB-4432", reason: "Overpaid" });
    expect(done.status).toBe(201);
    expect(await account()).toMatchObject({ refundedPaisa: credit, creditPaisa: 0 });
    expect(await count("SELECT COUNT(*) AS n FROM approval_requests WHERE subject_public_id = ?1", ((await done.json()) as { id: string }).id)).toBe(0);
    // Nothing is left to give back.
    expect((await refund(0, { amountPaisa: 1, method: "cash" })).status).toBe(422);
  });

  it("a price drop or a Principal's discount that leaves a student in credit can be refunded the same way", async () => {
    const pupil = fixture.pupils[3]!.enrollmentId;
    await post("/api/fees/payments/cash", { enrollmentId: pupil, amountPaisa: 400_000, idempotencyKey: key() }, accountant);
    const before = (await account(3)).creditPaisa;
    expect((await give(3, { amountPaisa: 8_000, reason: "sibling" })).status).toBe(201);
    expect((await account(3)).creditPaisa).toBe(before + 8_000);
    expect((await refund(3, { amountPaisa: before + 8_000, method: "cash" })).status).toBe(201);
    expect((await account(3)).creditPaisa).toBe(0);
  });

  it("two refunds at the same moment never pay back more than the credit", async () => {
    const pupil = fixture.pupils[2]!.enrollmentId;
    await post("/api/fees/payments/cash", { enrollmentId: pupil, amountPaisa: 600_000, idempotencyKey: key() }, accountant);
    const credit = (await account(2)).creditPaisa;
    expect(credit).toBeGreaterThan(0);
    const results = await Promise.all([refund(2, { amountPaisa: credit, method: "cash" }), refund(2, { amountPaisa: credit, method: "cheque", reference: "C-1" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await account(2)).creditPaisa).toBe(0);
  });

  it("only the Accountant of the wing refunds: not the Principal, not the Co-ordinator, not the other wing's Accountant; a method is required", async () => {
    for (const who of [admin, coordinator]) expect((await refund(1, { amountPaisa: 1, method: "cash" }, who)).status).toBe(403);
    expect((await refund(1, { amountPaisa: 1, method: "cash" }, otherAccountant)).status).toBe(404);
    expect((await refund(1, { amountPaisa: 1 })).status).toBe(400);
    expect((await refund(1, { amountPaisa: 1, method: "gift" })).status).toBe(400);
  });
});

describe("integrity", () => {
  it("the ledger and audit chains are unbroken, and no adjustment or discount row was ever deleted", async () => {
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
    await expect(db.prepare("DELETE FROM fee_adjustments").run()).rejects.toThrow(/never deleted/);
    expect(await count("SELECT COUNT(*) AS n FROM fee_adjustments")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM student_discounts")).toBeGreaterThan(0);
  });
});

describe("a closed year", () => {
  it("a discount, its change and a refund are all refused once the year is closed, and nothing is applied", async () => {
    const pupil = fixture.pupils[0]!.enrollmentId;
    const given = await give(0, { amountPaisa: 100, reason: "sibling" }).catch(() => ({ status: 0, id: "" }));
    const before = (await account()).discountPaisa;
    await db
      .prepare("UPDATE academic_years SET status = 'closed', closed_at = ?1 WHERE id = (SELECT academic_year_id FROM enrollments WHERE public_id = ?2)")
      .bind(new Date().toISOString(), pupil)
      .run();
    expect((await give(0, { amountPaisa: 100, reason: "sibling" })).status).toBe(409);
    if (given.id) expect((await remove(`/api/fees/discounts/${given.id}`, admin)).status).toBe(409);
    expect((await post(`/api/fees/enrollments/${pupil}/refunds`, { amountPaisa: 100, method: "cash" }, accountant)).status).toBe(409);
    expect((await account()).discountPaisa).toBe(before);
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
  });
});
