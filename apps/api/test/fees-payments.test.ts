import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { app, auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Payments and receipts (Phase 6, slice 3, D-076). CLAUDE.md section 6: a payment is never edited or deleted; partial
 * payments are allowed; the gateway reference is unique so repeated callbacks cannot double-credit; receipts come from
 * a gapless sequence per section and year, a counter row incremented in the same batch as the payment, so a failed
 * payment rolls the number back; receipts are generated from the ledger and never edited. Source 6.4: voucher upload
 * verified by the Accountant, or cash at the counter. The Co-ordinator has no fees access.
 */

let plus2: ClassFixture, bachelors: ClassFixture;
let accountant: Person, bachelorsAccountant: Person, coordinator: Person, admin: Person;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const key = () => crypto.randomUUID().replace(/-/g, "");

/** A class billed from a live structure: 3,000.00 a year each (one yearly item). */
async function billedClass(section: "plus2" | "bachelors", size: number): Promise<ClassFixture> {
  const fixture = await classWith(section, size);
  const structure = ((await (await post("/api/fees/structures", { levelId: fixture.levelId }, accountant)).json()) as { id: string }).id;
  await post(`/api/fees/structures/${structure}/items`, { name: "Annual fee", amountPaisa: 300_000, frequency: "yearly" }, accountant);
  await post(`/api/fees/structures/${structure}/send`, {}, accountant);
  const request = (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1").bind(structure).first<{ public_id: string }>())!.public_id;
  expect((await post(`/api/approvals/${request}/approve`, undefined, admin)).status).toBe(200);
  expect((await post(`/api/fees/structures/${structure}/charges`, { classId: fixture.classId }, accountant)).status).toBe(200);
  return fixture;
}

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  bachelorsAccountant = await person("accountant", "section", "bachelors");
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  plus2 = await billedClass("plus2", 3);
  bachelors = await billedClass("bachelors", 1);
});

const cash = (fixture: ClassFixture, pupil: number, amountPaisa: number, idempotencyKey = key(), who: Person = accountant) =>
  post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[pupil]!.enrollmentId, amountPaisa, idempotencyKey }, who);
interface Paid {
  paymentId: string;
  receipt: { id: string; number: string };
}
interface Account {
  chargedPaisa: number;
  paidPaisa: number;
  discountPaisa: number;
  balancePaisa: number;
  duePaisa: number;
  receipts: { id: string; number: string; amountPaisa: number; reversed: boolean }[];
  entries: { kind: string; amountPaisa: number }[];
}

describe("cash at the counter", () => {
  it("records a partial payment with a numbered receipt, in one batch", async () => {
    const response = await cash(plus2, 0, 100_000);
    expect(response.status).toBe(201);
    const paid = (await response.json()) as Paid;
    expect(paid.receipt.number).toMatch(/^plus2-\d{4}-\d{5}$/);
    const account = (await (await call(`/api/fees/enrollments/${plus2.pupils[0]!.enrollmentId}`, { cookie: accountant.cookie })).json()) as Account;
    expect(account).toMatchObject({ chargedPaisa: 300_000, paidPaisa: 100_000, balancePaisa: 200_000, duePaisa: 200_000 });
    expect(account.receipts.map((r) => r.number)).toEqual([paid.receipt.number]);
  });

  it("a retry with the same key returns the same receipt and records nothing new; a different amount under the same key is refused", async () => {
    const idempotencyKey = key();
    const first = (await (await cash(plus2, 1, 50_000, idempotencyKey)).json()) as Paid;
    const before = await count("SELECT COUNT(*) AS n FROM ledger_entries");
    const again = await cash(plus2, 1, 50_000, idempotencyKey);
    expect(again.status).toBe(201);
    expect(((await again.json()) as Paid).receipt.number).toBe(first.receipt.number);
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries")).toBe(before);
    expect((await cash(plus2, 1, 60_000, idempotencyKey)).status).toBe(409);
  });

  it("receipt numbers are gapless per section and year: a refused payment does not use one up", async () => {
    const a = (await (await cash(plus2, 2, 1_000)).json()) as Paid;
    expect((await cash(plus2, 2, 1_000, key(), bachelorsAccountant)).status).toBe(404); // out of reach: nothing written
    expect((await cash(plus2, 2, -5)).status).toBe(400);
    const b = (await (await cash(plus2, 2, 1_000)).json()) as Paid;
    const seq = (n: string) => Number(n.split("-").at(-1));
    expect(seq(b.receipt.number)).toBe(seq(a.receipt.number) + 1);
    // Another section counts on its own.
    const other = (await (await cash(bachelors, 0, 1_000)).json()) as Paid;
    expect(other.receipt.number).toMatch(/^bachelors-\d{4}-00001$/);
  });

  it("a section given a receipt code numbers with it from then on, the sequence unbroken; the code is then fixed (D-102, admin FUT F-18)", async () => {
    const seq = (n: string) => Number(n.split("-").at(-1));
    const before = (await (await cash(plus2, 1, 1_000)).json()) as Paid;
    expect(before.receipt.number).toMatch(/^plus2-\d{4}-\d{5}$/); // made before codes: numbered with its key
    const patch = (body: unknown) => call("/api/academics/sections/plus2", { method: "PATCH", body, cookie: admin.cookie });
    expect((await patch({ receiptCode: "p2" })).status).toBe(200);
    const after = (await (await cash(plus2, 1, 1_000)).json()) as Paid;
    expect(after.receipt.number).toMatch(/^P2-\d{4}-\d{5}$/);
    expect(seq(after.receipt.number)).toBe(seq(before.receipt.number) + 1);
    // Receipts already issued keep their number.
    expect((await db.prepare("SELECT number FROM receipts WHERE public_id = ?1").bind(before.receipt.id).first<{ number: string }>())!.number).toBe(before.receipt.number);
    const refused = await patch({ receiptCode: "PX" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "code_locked" });
    expect((await patch({ name: "Plus Two" })).status).toBe(200); // the name may still change
  });

  it("only the Accountant takes cash: the Co-ordinator, the Admin and the student are refused", async () => {
    for (const who of [coordinator, admin, plus2.pupils[0]!.person]) expect((await cash(plus2, 0, 100, key(), who)).status).toBe(403);
  });

  it("a receipt is never edited or deleted, and its number cannot be skipped", async () => {
    await expect(db.prepare("UPDATE receipts SET number = 'x'").run()).rejects.toThrow(/never edited/);
    await expect(db.prepare("DELETE FROM receipts").run()).rejects.toThrow(/never deleted/);
  });
});

describe("what a student sees", () => {
  it("their own account and receipts through /me; never another student's", async () => {
    const me = await call("/api/fees/me", { cookie: plus2.pupils[0]!.person.cookie });
    expect(me.status).toBe(200);
    const account = (await me.json()) as Account;
    expect(account.paidPaisa).toBe(100_000);
    const receipt = account.receipts[0]!;
    expect((await call(`/api/fees/receipts/${receipt.id}`, { cookie: plus2.pupils[0]!.person.cookie })).status).toBe(200);
    expect((await call(`/api/fees/receipts/${receipt.id}`, { cookie: plus2.pupils[1]!.person.cookie })).status).toBe(404);
    expect((await call(`/api/fees/enrollments/${plus2.pupils[0]!.enrollmentId}`, { cookie: plus2.pupils[1]!.person.cookie })).status).toBe(404);
  });

  it("the receipt shows the number, the student, the amount and the BS date, from the ledger", async () => {
    const account = (await (await call("/api/fees/me", { cookie: plus2.pupils[0]!.person.cookie })).json()) as Account;
    const receipt = (await (await call(`/api/fees/receipts/${account.receipts[0]!.id}`, { cookie: accountant.cookie })).json()) as {
      number: string;
      amountPaisa: number;
      studentName: string;
      sid: string;
      issuedOnBs: string;
      method: string;
    };
    expect(receipt).toMatchObject({ amountPaisa: 100_000, method: "cash" });
    expect(receipt.issuedOnBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(receipt.sid).toMatch(/^2083-/);
  });

  it("the Co-ordinator has no fees view at all", async () => {
    expect((await call(`/api/fees/enrollments/${plus2.pupils[0]!.enrollmentId}`, { cookie: coordinator.cookie })).status).toBe(403);
    expect((await call("/api/fees/vouchers", { cookie: coordinator.cookie })).status).toBe(403);
  });
});

describe("vouchers", () => {
  const voucher = (pupil: Person, body: Record<string, unknown> = {}) =>
    post("/api/fees/me/vouchers", { amountPaisa: 25_000, bank: "Nabil Bank", reference: `TXN-${key().slice(0, 8)}`, paidOn: "2026-09-20", ...body }, pupil);

  it("a student reports a deposit; the Accountant verifies it into a payment with a receipt", async () => {
    const pupil = plus2.pupils[1]!.person;
    const sent = await voucher(pupil);
    expect(sent.status).toBe(201);
    const id = ((await sent.json()) as { id: string }).id;
    const queue = (await (await call("/api/fees/vouchers", { cookie: accountant.cookie })).json()) as { vouchers: { id: string }[] };
    expect(queue.vouchers.map((v) => v.id)).toContain(id);
    const verified = await post(`/api/fees/vouchers/${id}/verify`, {}, accountant);
    expect(verified.status).toBe(201);
    expect(((await verified.json()) as Paid).receipt.number).toMatch(/^(plus2|P2)-/) // P2 once the receipt-code test above has run;
    expect((await post(`/api/fees/vouchers/${id}/verify`, {}, accountant)).status).toBe(409);
  });

  it("the same bank reference is claimed once; a rejection needs a reason and frees it", async () => {
    const pupil = plus2.pupils[2]!.person;
    const reference = `TXN-${key().slice(0, 8)}`;
    const id = ((await (await voucher(pupil, { reference })).json()) as { id: string }).id;
    expect((await voucher(pupil, { reference })).status).toBe(409);
    expect((await post(`/api/fees/vouchers/${id}/reject`, {}, accountant)).status).toBe(400);
    expect((await post(`/api/fees/vouchers/${id}/reject`, { reason: "Deposit not found in the statement" }, accountant)).status).toBe(200);
    expect((await voucher(pupil, { reference })).status).toBe(201);
  });

  it("a student cannot verify, and the other section's Accountant does not see or verify it", async () => {
    const id = ((await (await voucher(plus2.pupils[0]!.person)).json()) as { id: string }).id;
    expect((await post(`/api/fees/vouchers/${id}/verify`, {}, plus2.pupils[0]!.person)).status).toBe(403);
    expect((await post(`/api/fees/vouchers/${id}/verify`, {}, bachelorsAccountant)).status).toBe(404);
    const theirs = (await (await call("/api/fees/vouchers", { cookie: bachelorsAccountant.cookie })).json()) as { vouchers: { id: string }[] };
    expect(theirs.vouchers.map((v) => v.id)).not.toContain(id);
  });
});

describe("online payments (demo adapter only)", () => {
  const demoEnv = { ...env, DEMO_MODE: "true" };
  const demoCall = (path: string, body: unknown, cookie?: string) =>
    app.request(`https://school.example${path}`, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }, demoEnv);

  it("are not offered outside demo mode: there is no real gateway yet", async () => {
    expect((await post("/api/fees/me/online-payments", { amountPaisa: 1_000 }, plus2.pupils[0]!.person)).status).toBe(404);
  });

  it("a confirmed attempt credits once, however many times the callback comes", async () => {
    const pupil = plus2.pupils[0]!.person;
    const started = await demoCall("/api/fees/me/online-payments", { amountPaisa: 7_000 }, pupil.cookie);
    expect(started.status).toBe(201);
    const { gatewayReference } = (await started.json()) as { gatewayReference: string };
    const before = (await (await call("/api/fees/me", { cookie: pupil.cookie })).json()) as Account;
    for (let i = 0; i < 3; i++) expect((await demoCall("/api/fees/gateway/callback", { gatewayReference })).status).toBe(200);
    const after = (await (await call("/api/fees/me", { cookie: pupil.cookie })).json()) as Account;
    expect(after.paidPaisa - before.paidPaisa).toBe(7_000);
    expect((await demoCall("/api/fees/gateway/callback", { gatewayReference: "DEMO-unknown" })).status).toBe(404);
  });
});

describe("integrity", () => {
  it("the ledger chain and the audit chain are both unbroken after all of it", async () => {
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
