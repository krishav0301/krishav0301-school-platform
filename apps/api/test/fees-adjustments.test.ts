import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { ledgerInserts, verifyLedgerChain, writeMoney } from "../src/modules/fees/ledger";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Discounts, reversals and refunds (Phase 6, slice 4, D-077), written before the code. Source 6.4: any reduction is a
 * discount (an amount or a percentage, with a reason), and the Admin approves every one; until then the full fee
 * stands. A payment is never deleted: a mistake is reversed, and the Admin approves every reversal. A refund is
 * started by the Accountant, approved by the Admin, and then recorded with how the money went back. CLAUDE.md section
 * 6: approve-and-apply is one batch with a conditional update, so a race has one winner and a retry is "already
 * resolved"; a request goes stale if what it refers to changes; nobody approves their own. Section 9: discount reasons
 * are Scholarship, Sibling, Staff child, Other.
 */

let fixture: ClassFixture;
let accountant: Person, otherAccountant: Person, admin: Person, secondAdmin: Person, coordinator: Person;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
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
  fixture = await classWith("plus2", 3);
  const structure = ((await (await post("/api/fees/structures", { levelId: fixture.levelId }, accountant)).json()) as { id: string }).id;
  await post(`/api/fees/structures/${structure}/items`, { name: "Annual fee", amountPaisa: 400_000, frequency: "yearly" }, accountant);
  await post(`/api/fees/structures/${structure}/send`, {}, accountant);
  await approve(await requestOf(structure));
  await post(`/api/fees/structures/${structure}/charges`, { classId: fixture.classId }, accountant);
});

describe("discounts", () => {
  it("a proposed discount changes nothing until an Admin approves it; then the ledger has it, once", async () => {
    const proposed = await post(`/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}/discounts`, { percent: 25, reason: "scholarship" }, accountant);
    expect(proposed.status).toBe(201);
    const { id } = (await proposed.json()) as { id: string };
    expect((await account()).discountPaisa).toBe(0);

    const requestId = await requestOf(id);
    expect((await approve(requestId)).status).toBe(200);
    expect(await account()).toMatchObject({ discountPaisa: 100_000, balancePaisa: 300_000 });
    // A second click, or a second Admin a moment later, is "already resolved", and nothing is applied twice.
    expect((await approve(requestId, secondAdmin)).status).toBe(409);
    expect((await account()).discountPaisa).toBe(100_000);
  });

  it("an amount works too; 'Other' needs a note; unknown reasons, fractions and more than was charged are refused", async () => {
    const path = `/api/fees/enrollments/${fixture.pupils[1]!.enrollmentId}/discounts`;
    expect((await post(path, { amountPaisa: 5_000, reason: "other" }, accountant)).status).toBe(422);
    expect((await post(path, { amountPaisa: 5_000, reason: "loyalty" }, accountant)).status).toBe(400);
    expect((await post(path, { amountPaisa: 50.5, reason: "sibling" }, accountant)).status).toBe(400);
    expect((await post(path, { amountPaisa: 400_001, reason: "sibling" }, accountant)).status).toBe(422);
    expect((await post(path, { amountPaisa: 5_000, percent: 5, reason: "sibling" }, accountant)).status).toBe(400);
    expect((await post(path, { amountPaisa: 5_000, reason: "other", note: "Hardship, per the Principal" }, accountant)).status).toBe(201);
  });

  it("a declined discount is never applied", async () => {
    const { id } = (await (await post(`/api/fees/enrollments/${fixture.pupils[2]!.enrollmentId}/discounts`, { amountPaisa: 10_000, reason: "staff_child" }, accountant)).json()) as { id: string };
    expect((await post(`/api/approvals/${await requestOf(id)}/decline`, { reason: "Not a staff child" }, admin)).status).toBe(200);
    expect((await account(2)).discountPaisa).toBe(0);
  });

  it("a discount goes stale if the student's charges change before the decision; a payment does not stale it", async () => {
    const { id } = (await (await post(`/api/fees/enrollments/${fixture.pupils[2]!.enrollmentId}/discounts`, { percent: 10, reason: "sibling" }, accountant)).json()) as { id: string };
    await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[2]!.enrollmentId, amountPaisa: 1_000, idempotencyKey: key() }, accountant);
    // A new charge for this student (as a later structure run or carried dues would make) changes what 10% means.
    const fee = (await db.prepare("SELECT fi.public_id FROM fee_items fi LIMIT 1").first<{ public_id: string }>())!.public_id;
    await writeMoney(db, auditKey, { action: "test.charge", entityType: "ledger", actorPublicId: accountant.publicId, summary: "test" }, async (head) =>
      (await ledgerInserts(db, auditKey, head, [{ publicId: crypto.randomUUID().replace(/-/g, ""), enrollmentPublicId: fixture.pupils[2]!.enrollmentId, kind: "charge", amountPaisa: 1_000, feeItemPublicId: fee, period: "extra", dueOn: "2026-05-01", actorPublicId: accountant.publicId, createdAt: new Date().toISOString() }])).statements,
    );
    expect((await approve(await requestOf(id))).status).toBe(409);
    expect((await account(2)).discountPaisa).toBe(0);
  });

  it("two requests on one student are decided independently: approving one does not stale the other", async () => {
    const pupil = fixture.pupils[1]!.enrollmentId;
    const payment = ((await (await post("/api/fees/payments/cash", { enrollmentId: pupil, amountPaisa: 2_000, idempotencyKey: key() }, accountant)).json()) as { paymentId: string }).paymentId;
    const discount = ((await (await post(`/api/fees/enrollments/${pupil}/discounts`, { amountPaisa: 1_000, reason: "sibling" }, accountant)).json()) as { id: string }).id;
    const reversal = ((await (await post(`/api/fees/payments/${payment}/reversal`, { reason: "Wrong student" }, accountant)).json()) as { id: string }).id;
    expect((await approve(await requestOf(discount))).status).toBe(200);
    expect((await approve(await requestOf(reversal))).status).toBe(200);
  });

  it("only the Accountant proposes; the Co-ordinator and the Admin cannot; the other section's Accountant reaches nothing", async () => {
    const path = `/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}/discounts`;
    for (const who of [coordinator, admin]) expect((await post(path, { amountPaisa: 100, reason: "sibling" }, who)).status).toBe(403);
    expect((await post(path, { amountPaisa: 100, reason: "sibling" }, otherAccountant)).status).toBe(404);
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

describe("refunds", () => {
  it("a refund is only of credit, needs an Admin, and is written to the ledger only when recorded", async () => {
    // Pupil 0 pays more than is owed: 300,000 due after the discount; pays 350,000.
    await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: 350_000, idempotencyKey: key() }, accountant);
    expect((await account()).creditPaisa).toBe(50_000);

    const path = `/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}/refunds`;
    expect((await post(path, { amountPaisa: 50_001, reason: "Overpaid" }, accountant)).status).toBe(422);
    const { id } = (await (await post(path, { amountPaisa: 50_000, reason: "Overpaid" }, accountant)).json()) as { id: string };

    expect((await post(`/api/fees/refunds/${id}/record`, { method: "cash" }, accountant)).status).toBe(409); // not approved yet
    expect((await approve(await requestOf(id))).status).toBe(200);
    expect((await account()).refundedPaisa).toBe(0); // approved, not yet paid back

    expect((await post(`/api/fees/refunds/${id}/record`, { method: "bank_transfer", reference: "NB-4432" }, accountant)).status).toBe(200);
    expect(await account()).toMatchObject({ refundedPaisa: 50_000, creditPaisa: 0, balancePaisa: 0 });
    expect((await post(`/api/fees/refunds/${id}/record`, { method: "cash" }, accountant)).status).toBe(409); // once
  });

  it("a pending refund survives a discount (more credit) but goes stale on a new charge (less credit) (D-084)", async () => {
    const pupil = fixture.pupils[1]!.enrollmentId;
    await post("/api/fees/payments/cash", { enrollmentId: pupil, amountPaisa: 500_000, idempotencyKey: key() }, accountant);
    const refund = async () => ((await (await post(`/api/fees/enrollments/${pupil}/refunds`, { amountPaisa: 10_000, reason: "Overpaid" }, accountant)).json()) as { id: string }).id;
    const first = await refund();
    const discount = ((await (await post(`/api/fees/enrollments/${pupil}/discounts`, { amountPaisa: 5_000, reason: "sibling" }, accountant)).json()) as { id: string }).id;
    expect((await approve(await requestOf(discount))).status).toBe(200);
    expect((await approve(await requestOf(first))).status).toBe(200); // the discount only added credit
    const second = await refund();
    const fee = (await db.prepare("SELECT fi.public_id FROM fee_items fi LIMIT 1").first<{ public_id: string }>())!.public_id;
    await writeMoney(db, auditKey, { action: "test.charge", entityType: "ledger", actorPublicId: accountant.publicId, summary: "test" }, async (head) =>
      (await ledgerInserts(db, auditKey, head, [{ publicId: crypto.randomUUID().replace(/-/g, ""), enrollmentPublicId: pupil, kind: "charge", amountPaisa: 1_000, feeItemPublicId: fee, period: "extra-refund", dueOn: "2026-05-01", actorPublicId: accountant.publicId, createdAt: new Date().toISOString() }])).statements,
    );
    expect((await approve(await requestOf(second))).status).toBe(409); // a charge took credit away: ask again
  });

  it("the Admin who is asked cannot be the one who asked (an Accountant who is also an Admin)", async () => {
    const accountantRole = await person("accountant", "institution");
    await db.prepare("INSERT INTO role_assignments (user_id, role, scope_type) SELECT id, 'admin', 'institution' FROM users WHERE public_id = ?1").bind(accountantRole.publicId).run();
    const moment = Math.floor(Date.now() / 1000);
    const token = await signAccessToken(env.SESSION_SECRET, {
      sub: accountantRole.publicId,
      sid: "s",
      name: "Both",
      roles: [
        { role: "accountant", scope: "institution" },
        { role: "admin", scope: "institution" },
      ] as RoleClaim[],
      iat: moment,
      exp: moment + 600,
    });
    const both: Person = { publicId: accountantRole.publicId, cookie: `__Host-access=${token}` };
    const { id } = (await (await post(`/api/fees/enrollments/${fixture.pupils[2]!.enrollmentId}/discounts`, { amountPaisa: 100, reason: "sibling" }, both)).json()) as { id: string };
    expect((await approve(await requestOf(id), both)).status).toBe(403);
  });
});

describe("integrity", () => {
  it("the ledger and audit chains are unbroken, and no adjustment row was ever deleted", async () => {
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
    await expect(db.prepare("DELETE FROM fee_adjustments").run()).rejects.toThrow(/never deleted/);
    expect(await count("SELECT COUNT(*) AS n FROM fee_adjustments")).toBeGreaterThan(0);
  });
});
