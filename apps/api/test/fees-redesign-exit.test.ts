/**
 * The exit check of the fees redesign (D-172, `docs/superpowers/specs/2026-10-17-fee-structures-design.md`): the whole
 * flow for BOTH schools, through the real HTTP API, from each school's own pack, with real first sign-ins.
 *
 *  - the Accountant drafts a structure of priced lines; the Principal approves it; linking it to a level needs no approval
 *    and every student of the level is charged at once
 *  - the Accountant takes payments; asks to edit the approved structure; the Principal approves the request; the draft copy
 *    is edited and approved again; the lower price becomes a discount entry, the approved prices stay in force until then
 *  - the Principal alone gives a discount (never above the fees), changes it inside its window; the Accountant refunds a
 *    credit on their own, never above it
 *  - the Co-ordinator asks for a student to be marked Left, the Principal approves, and the fee account closes: what is
 *    unpaid stays owed and nothing can be added to it
 *  - each student sees only their own account; the Co-ordinator has no fees access; the ledger and audit chains are whole
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, type Pack } from "../src/core/config";
import { bsToAd, daysInMonth, todayBs } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { seedProgrammes, testPack } from "./programme-fixtures";

const app = createApp();

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("Fees redesign exit check: $label", ({ json, database }) => {
  const pack: Pack = testPack(json);
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
  const patch = (path: string, body: unknown, cookie: string | undefined) => call(path, { method: "PATCH", body, cookie });
  const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");
  const key = () => crypto.randomUUID().replace(/-/g, "");
  type Account = { enrollmentId: string; chargedPaisa: number; discountPaisa: number; paidPaisa: number; balancePaisa: number; creditPaisa: number; refundedPaisa: number; closed: { owedPaisa: number } | null };
  const accountOf = async (cookie: string) => (await (await call("/api/fees/me", { cookie })).json()) as Account;

  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"]) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-redesign-${crypto.randomUUID().slice(0, 6)}@school.example`,
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
  const requestFor = async (subjectId: string) => (await db().prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(subjectId).first<{ public_id: string }>())!.public_id;
  const approve = async (subjectId: string, cookie: string | undefined) => post(`/api/approvals/${await requestFor(subjectId)}/approve`, undefined, cookie);

  const cookies: Record<string, string> = {};
  const state: { levelId?: string; classId?: string; structureId?: string; draftId?: string; sita?: Account; hari?: Account; gita?: Account; discountId?: string } = {};

  it("setup: a class of three admitted students with their own sign-ins", async () => {
    await applyPack(db(), pack);
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, pack);
    cookies.coordinator = await signedIn("coordinator", "institution");
    cookies.accountant = await signedIn("accountant", "institution");
    cookies.admin = await signedIn("admin", "institution");
    const programmes = (await (await call("/api/academics/programmes", { cookie: cookies.coordinator })).json()) as { programmes: { levels: { id: string }[] }[] };
    state.levelId = programmes.programmes[0]!.levels[0]!.id;
    const b = todayBs().year;
    const yearId = await idOf(await post("/api/academics/years", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }), levelIds: [state.levelId!] }, cookies.admin));
    expect((await post(`/api/academics/years/${yearId}/activate`, undefined, cookies.admin)).status).toBe(200);
    state.classId = await idOf(await post("/api/academics/classes", { yearId, levelId: state.levelId, label: "" }, cookies.coordinator));
    for (const first of ["Sita", "Hari", "Gita"]) {
      const email = `${first.toLowerCase()}-redesign-${crypto.randomUUID().slice(0, 6)}@example.com`;
      const admitted = await post(
        "/api/admissions/walk-ins",
        { firstName: first, lastName: "Redesign", dob: "2009-11-02", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email, guardianName: "Guardian", guardianPhone: "9800000021", levelId: state.levelId, classId: state.classId },
        cookies.coordinator,
      );
      expect(admitted.status).toBe(201);
      cookies[first] = await firstSignIn(email, ((await admitted.json()) as { temporaryPassword: string }).temporaryPassword);
    }
  });

  it("a structure of lines: the Accountant drafts it, the Principal approves it, linking needs no approval and charges everyone", async () => {
    const b = todayBs().year;
    const shape = { name: "Redesign fees", sectionKey: pack.sections[0]!.key, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }) };
    expect((await post("/api/fees/structures", shape, cookies.coordinator)).status).toBe(403);
    state.structureId = await idOf(await post("/api/fees/structures", shape, cookies.accountant));
    expect((await post(`/api/fees/structures/${state.structureId}/items`, { name: "Tuition", amountPaisa: 800_000 }, cookies.accountant)).status).toBe(201);
    expect((await post(`/api/fees/structures/${state.structureId}/items`, { name: "Exam", amountPaisa: 200_000 }, cookies.accountant)).status).toBe(201);
    // Not linkable until approved; only the Principal approves.
    const early = (await (await post(`/api/fees/structures/${state.structureId}/levels`, { levelIds: [state.levelId] }, cookies.accountant)).json()) as { levels: { ok: boolean }[]; charged: number };
    expect(early.levels[0]!.ok).toBe(false);
    expect(early.charged).toBe(0);
    expect((await post(`/api/fees/structures/${state.structureId}/send`, {}, cookies.accountant)).status).toBe(201);
    expect((await approve(state.structureId!, cookies.accountant)).status).toBe(403);
    expect((await approve(state.structureId!, cookies.admin)).status).toBe(200);
    const made = await post(`/api/fees/structures/${state.structureId}/levels`, { levelIds: [state.levelId] }, cookies.accountant);
    expect(((await made.json()) as { charged: number }).charged).toBeGreaterThanOrEqual(6);
    for (const name of ["Sita", "Hari", "Gita"] as const) expect(await accountOf(cookies[name]!)).toMatchObject({ chargedPaisa: 1_000_000, balancePaisa: 1_000_000 });
  });

  it("payments are taken by the Accountant; the Principal cannot take one", async () => {
    const sita = await accountOf(cookies.Sita!);
    expect((await post("/api/fees/payments/cash", { enrollmentId: sita.enrollmentId, amountPaisa: 400_000, idempotencyKey: key() }, cookies.admin)).status).toBe(403);
    expect((await post("/api/fees/payments/cash", { enrollmentId: sita.enrollmentId, amountPaisa: 400_000, idempotencyKey: key() }, cookies.accountant)).status).toBe(201);
  });

  it("editing an approved structure: ask, approve, edit the copy, approve again; the lower price is a discount entry", async () => {
    const asked = await post(`/api/fees/structures/${state.structureId}/edit-request`, { reason: "New session prices" }, cookies.accountant);
    expect(asked.status).toBe(201);
    expect((await post(`/api/approvals/${await idOf(asked)}/approve`, undefined, cookies.admin)).status).toBe(200);
    const copy = (await (await call(`/api/fees/structures/${state.structureId}`, { cookie: cookies.accountant })).json()) as { id: string; items: { id: string; name: string }[] };
    state.draftId = copy.id;
    // The approved prices are still what students owe.
    expect((await accountOf(cookies.Hari!)).chargedPaisa).toBe(1_000_000);
    expect((await patch(`/api/fees/items/${copy.items.find((i) => i.name === "Tuition")!.id}`, { amountPaisa: 700_000 }, cookies.accountant)).status).toBe(200);
    expect((await post(`/api/fees/structures/${state.draftId}/send`, {}, cookies.accountant)).status).toBe(201);
    expect((await approve(state.draftId!, cookies.admin)).status).toBe(200);
    for (const name of ["Sita", "Hari", "Gita"] as const) expect(await accountOf(cookies[name]!)).toMatchObject({ chargedPaisa: 1_000_000, discountPaisa: 100_000 });
    const changed = (await (await call(`/api/fees/structures/${state.draftId}/price-changes`, { cookie: cookies.accountant })).json()) as { students: { changePaisa: number }[] };
    expect(changed.students).toHaveLength(3);
    expect(changed.students.every((s) => s.changePaisa === -100_000)).toBe(true);
  });

  it("discounts are the Principal's: given at once, never above the fees, changed inside the window; the Accountant refunds a credit, never above it", async () => {
    const hari = await accountOf(cookies.Hari!);
    expect((await post(`/api/fees/enrollments/${hari.enrollmentId}/discounts`, { amountPaisa: 50_000, reason: "sibling" }, cookies.accountant)).status).toBe(403);
    expect((await post(`/api/fees/enrollments/${hari.enrollmentId}/discounts`, { amountPaisa: 900_001, reason: "sibling" }, cookies.admin)).status).toBe(422); // above what is left of the fees
    state.discountId = await idOf(await post(`/api/fees/enrollments/${hari.enrollmentId}/discounts`, { amountPaisa: 200_000, reason: "scholarship" }, cookies.admin));
    expect(await accountOf(cookies.Hari!)).toMatchObject({ discountPaisa: 300_000, balancePaisa: 700_000 });
    expect((await patch(`/api/fees/discounts/${state.discountId}`, { amountPaisa: 250_000, reason: "scholarship" }, cookies.admin)).status).toBe(200);
    expect(await accountOf(cookies.Hari!)).toMatchObject({ discountPaisa: 350_000, balancePaisa: 650_000 });

    // Sita has paid 400, owes 500 more; she pays 600 and is 100 over: credit, which only the Accountant pays back.
    const sita = await accountOf(cookies.Sita!);
    expect(sita.balancePaisa).toBe(500_000);
    expect((await post("/api/fees/payments/cash", { enrollmentId: sita.enrollmentId, amountPaisa: 600_000, idempotencyKey: key() }, cookies.accountant)).status).toBe(201);
    expect((await accountOf(cookies.Sita!)).creditPaisa).toBe(100_000);
    expect((await post(`/api/fees/enrollments/${sita.enrollmentId}/refunds`, { amountPaisa: 100_000, method: "cash" }, cookies.admin)).status).toBe(403);
    expect((await post(`/api/fees/enrollments/${sita.enrollmentId}/refunds`, { amountPaisa: 100_001, method: "cash" }, cookies.accountant)).status).toBe(422);
    expect((await post(`/api/fees/enrollments/${sita.enrollmentId}/refunds`, { amountPaisa: 100_000, method: "bank_transfer", reference: "NB-1" }, cookies.accountant)).status).toBe(201);
    expect(await accountOf(cookies.Sita!)).toMatchObject({ creditPaisa: 0, balancePaisa: 0, refundedPaisa: 100_000 });
  });

  it("a student leaves: the Co-ordinator asks, the Principal approves, the account closes with what is unpaid still owed", async () => {
    const hari = await accountOf(cookies.Hari!);
    expect((await post("/api/students/leave-requests", { enrollmentId: hari.enrollmentId, reason: "Family is moving" }, cookies.accountant)).status).toBe(403);
    const asked = await post("/api/students/leave-requests", { enrollmentId: hari.enrollmentId, reason: "Family is moving" }, cookies.coordinator);
    expect(asked.status).toBe(201);
    const leaveId = await idOf(asked);
    expect((await approve(leaveId, cookies.coordinator)).status).toBe(403);
    expect((await approve(leaveId, cookies.admin)).status).toBe(200);
    expect(await accountOf(cookies.Hari!)).toMatchObject({ balancePaisa: 650_000, closed: { owedPaisa: 650_000 } });
    // Closed for everyone.
    expect((await post("/api/fees/payments/cash", { enrollmentId: hari.enrollmentId, amountPaisa: 1_000, idempotencyKey: key() }, cookies.accountant)).status).toBe(409);
    expect((await post(`/api/fees/enrollments/${hari.enrollmentId}/discounts`, { amountPaisa: 1_000, reason: "sibling" }, cookies.admin)).status).toBe(409);
    expect((await call(`/api/fees/discounts/${state.discountId}`, { method: "DELETE", cookie: cookies.admin })).status).toBeGreaterThanOrEqual(409);
    // The others of the class are untouched and can still pay.
    const gita = await accountOf(cookies.Gita!);
    expect((await post("/api/fees/payments/cash", { enrollmentId: gita.enrollmentId, amountPaisa: 1_000, idempotencyKey: key() }, cookies.accountant)).status).toBe(201);
  });

  it("reach: each student sees only their own; the Co-ordinator has no fees access; the Principal reads the Discounts report, the Accountant does not", async () => {
    const hari = await accountOf(cookies.Hari!);
    expect((await call(`/api/fees/enrollments/${hari.enrollmentId}`, { cookie: cookies.Sita })).status).toBe(404);
    expect((await call(`/api/fees/enrollments/${hari.enrollmentId}`, { cookie: cookies.coordinator })).status).toBe(403);
    expect((await call("/api/fees/dues", { cookie: cookies.coordinator })).status).toBe(403);
    expect((await call("/api/fees/discounts", { cookie: cookies.accountant })).status).toBe(403);
    const report = (await (await call("/api/fees/discounts", { cookie: cookies.admin })).json()) as { activeCount: number; activePaisa: number };
    expect(report).toMatchObject({ activeCount: 1, activePaisa: 250_000 });
  });

  it("the dues list shows the closed account and agrees with the accounts; both chains are unbroken", async () => {
    const dues = (await (await call("/api/fees/dues", { cookie: cookies.accountant })).json()) as { students: { enrollmentId: string; closed: boolean; balancePaisa: number }[] };
    const hari = await accountOf(cookies.Hari!);
    expect(dues.students.find((s) => s.enrollmentId === hari.enrollmentId)).toMatchObject({ closed: true, balancePaisa: 650_000 });
    expect(dues.students.filter((s) => s.closed)).toHaveLength(1);
    expect((await verifyLedgerChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
    expect((await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
  });
});
