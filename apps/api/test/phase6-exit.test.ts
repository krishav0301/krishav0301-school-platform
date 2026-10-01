/**
 * The Phase 6 exit check (docs/build-plan.md): fees end to end, for BOTH schools, through the real HTTP API, starting
 * from each school's own pack, with real sign-ins from the real first-password flows.
 *
 *  - the Accountant drafts this year's fee structure for a level (a monthly and a yearly item), an Admin approves it,
 *    and charges are made for the class
 *  - a student pays part in cash (a gapless receipt), reports a bank deposit the Accountant verifies (the next receipt)
 *  - a discount and a reversal each change nothing until an Admin approves, then apply once
 *  - the student sees their own account and receipts; another student cannot; the Co-ordinator has no fees access
 *  - the dues list and its CSV agree with the account; the ledger chain and the audit chain are unbroken
 *
 * The sample school bills monthly (its pack's point: "monthly fees"), so both run the same monthly-and-yearly flow.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, parsePack, type Pack } from "../src/core/config";
import { bsToAd, daysInMonth, todayBs } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { seedProgrammes } from "./programme-fixtures";

const app = createApp();

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("Phase 6 exit check: $label", ({ json, database }) => {
  const pack: Pack = parsePack(json);
  const db = () => database();

  const call = (path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: options.method ?? "GET",
        headers: { "Sec-Fetch-Site": "same-origin", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      { ...env, DB: db() },
    );
  const post = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "POST", body, cookie });
  const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");
  const key = () => crypto.randomUUID().replace(/-/g, "");

  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"]) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-p6exit-${crypto.randomUUID().slice(0, 6)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `${role} person`,
      roles: [{ role: role as never, scope: scope as never }],
    });
    const now = Math.floor(Date.now() / 1000);
    return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [{ role, scope } as RoleClaim], iat: now, exp: now + 600 })}`;
  }
  async function firstSignIn(email: string, temporaryPassword: string): Promise<string> {
    const first = await call("/api/auth/sign-in", { method: "POST", body: { email, password: temporaryPassword } });
    const step = (await first.json()) as { challenge?: string };
    const changed = await call("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password: "Papaya-Compass-Ledger-8823" } });
    expect(changed.status).toBe(200);
    return cookiesOf(changed);
  }
  const approveLatest = async (subjectId: string, cookie: string | undefined) => {
    const request = (await db().prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(subjectId).first<{ public_id: string }>())!.public_id;
    return post(`/api/approvals/${request}/approve`, undefined, cookie);
  };

  const cookies: Record<string, string> = {};
  const state: { levelId?: string; classId?: string; structureId?: string; paymentId?: string } = {};

  it("setup: this year, a class, two admitted students with their own sign-ins", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack); // a school starts with no programmes: the Admin makes them (D-087)
    cookies.coordinator = await signedIn("coordinator", "institution");
    cookies.accountant = await signedIn("accountant", "institution");
    cookies.admin = await signedIn("admin", "institution");
    const programmes = (await (await call("/api/academics/programmes", { cookie: cookies.coordinator })).json()) as { programmes: { levels: { id: string }[] }[] };
    state.levelId = programmes.programmes[0]!.levels[0]!.id;
    const b = todayBs().year;
    const yearId = await idOf(await post("/api/academics/years", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }) }, cookies.coordinator));
    expect((await post(`/api/academics/years/${yearId}/activate`, undefined, cookies.coordinator)).status).toBe(200);
    state.classId = await idOf(await post("/api/academics/classes", { yearId, levelId: state.levelId, label: "" }, cookies.coordinator));
    for (const first of ["Sita", "Hari"]) {
      const email = `${first.toLowerCase()}-p6exit-${crypto.randomUUID().slice(0, 6)}@example.com`;
      const admitted = await post(
        "/api/admissions/walk-ins",
        { firstName: first, lastName: "Exit", dob: "2009-11-02", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email, guardianName: "Guardian", guardianPhone: "9800000021", levelId: state.levelId, classId: state.classId },
        cookies.coordinator,
      );
      expect(admitted.status).toBe(201);
      cookies[first] = await firstSignIn(email, ((await admitted.json()) as { temporaryPassword: string }).temporaryPassword);
    }
  });

  it("the fee structure: drafted, not the Co-ordinator's, approved by an Admin, charges made", async () => {
    expect((await post("/api/fees/structures", { levelId: state.levelId }, cookies.coordinator)).status).toBe(403);
    state.structureId = await idOf(await post("/api/fees/structures", { levelId: state.levelId }, cookies.accountant));
    expect((await post(`/api/fees/structures/${state.structureId}/items`, { name: "Tuition", amountPaisa: 150_000, frequency: "monthly" }, cookies.accountant)).status).toBe(201);
    expect((await post(`/api/fees/structures/${state.structureId}/items`, { name: "Exam", amountPaisa: 200_000, frequency: "yearly" }, cookies.accountant)).status).toBe(201);
    expect((await post(`/api/fees/structures/${state.structureId}/send`, {}, cookies.accountant)).status).toBe(201);
    expect((await approveLatest(state.structureId!, cookies.admin)).status).toBe(200);
    const made = await post(`/api/fees/structures/${state.structureId}/charges`, { classId: state.classId }, cookies.accountant);
    expect(((await made.json()) as { created: number }).created).toBeGreaterThanOrEqual(4);
  });

  it("payments: cash and a verified voucher, each with the next receipt number", async () => {
    const sita = (await (await call("/api/fees/me", { cookie: cookies.Sita })).json()) as { enrollmentId: string; chargedPaisa: number };
    expect(sita.chargedPaisa).toBeGreaterThan(0);
    const cash = (await (await post("/api/fees/payments/cash", { enrollmentId: sita.enrollmentId, amountPaisa: 100_000, idempotencyKey: key() }, cookies.accountant)).json()) as { paymentId: string; receipt: { number: string } };
    state.paymentId = cash.paymentId;
    const voucherId = await idOf(await post("/api/fees/me/vouchers", { amountPaisa: 50_000, bank: "Nabil Bank", reference: `EXIT-${key().slice(0, 6)}`, paidOn: bsToAd(todayBs()) }, cookies.Sita));
    const verified = (await (await post(`/api/fees/vouchers/${voucherId}/verify`, {}, cookies.accountant)).json()) as { receipt: { number: string } };
    const seq = (n: string) => Number(n.split("-").at(-1));
    expect(seq(verified.receipt.number)).toBe(seq(cash.receipt.number) + 1);
  });

  it("a discount and a reversal apply only once an Admin approves them", async () => {
    const before = (await (await call("/api/fees/me", { cookie: cookies.Sita })).json()) as { enrollmentId: string; discountPaisa: number; paidPaisa: number };
    const discountId = await idOf(await post(`/api/fees/enrollments/${before.enrollmentId}/discounts`, { amountPaisa: 20_000, reason: "sibling" }, cookies.accountant));
    const reversalId = await idOf(await post(`/api/fees/payments/${state.paymentId}/reversal`, { reason: "Recorded twice" }, cookies.accountant));
    expect(((await (await call("/api/fees/me", { cookie: cookies.Sita })).json()) as { discountPaisa: number }).discountPaisa).toBe(0);
    expect((await approveLatest(discountId, cookies.admin)).status).toBe(200);
    expect((await approveLatest(reversalId, cookies.admin)).status).toBe(200);
    const after = (await (await call("/api/fees/me", { cookie: cookies.Sita })).json()) as { discountPaisa: number; paidPaisa: number; receipts: { reversed: boolean }[] };
    expect(after.discountPaisa).toBe(20_000);
    expect(after.paidPaisa).toBe(before.paidPaisa - 100_000);
    expect(after.receipts.some((r) => r.reversed)).toBe(true);
  });

  it("reach: each student sees only their own; the Co-ordinator has no fees view", async () => {
    const sita = (await (await call("/api/fees/me", { cookie: cookies.Sita })).json()) as { enrollmentId: string; receipts: { id: string }[] };
    expect((await call(`/api/fees/receipts/${sita.receipts[0]!.id}`, { cookie: cookies.Hari })).status).toBe(404);
    expect((await call(`/api/fees/enrollments/${sita.enrollmentId}`, { cookie: cookies.Hari })).status).toBe(404);
    expect((await call(`/api/fees/enrollments/${sita.enrollmentId}`, { cookie: cookies.coordinator })).status).toBe(403);
    expect((await call("/api/fees/dues", { cookie: cookies.coordinator })).status).toBe(403);
  });

  it("the dues list and CSV agree with the account; both chains are unbroken", async () => {
    const sita = (await (await call("/api/fees/me", { cookie: cookies.Sita })).json()) as { enrollmentId: string; duePaisa: number };
    const dues = (await (await call(`/api/fees/dues?classId=${state.classId}`, { cookie: cookies.accountant })).json()) as { students: { enrollmentId: string; duePaisa: number }[] };
    expect(dues.students.find((s) => s.enrollmentId === sita.enrollmentId)!.duePaisa).toBe(sita.duePaisa);
    const csv = await (await call(`/api/fees/dues.csv?classId=${state.classId}`, { cookie: cookies.admin })).text();
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3); // the header and two students
    expect((await verifyLedgerChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
    expect((await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
  });
});
