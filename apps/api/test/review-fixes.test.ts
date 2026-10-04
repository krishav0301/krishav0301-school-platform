import { beforeAll, describe, expect, it } from "vitest";

import { call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { assign, classWith, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * The code review's fixes (D-108): each test is a case the review found open. Two Admins approving two discounts at
 * once never give more than was charged; a reversal draft left behind is sent, not left to block its payment; two
 * Accountants verifying one voucher at once make one payment; a class of more than one write chunk gets every
 * charge; the audit trail's and sign-ins' totals are the true counts; and the year's teaching is one request that
 * keeps to the person's sections.
 */

let fixture: ClassFixture;
let accountant: Person, admin: Person, secondAdmin: Person;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const key = () => crypto.randomUUID().replace(/-/g, "");
const requestOf = async (subjectId: string) =>
  (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(subjectId).first<{ public_id: string }>())!.public_id;
const approve = (requestId: string, who: Person = admin) => post(`/api/approvals/${requestId}/approve`, undefined, who);
const account = async (enrollmentId: string) =>
  (await (await call(`/api/fees/enrollments/${enrollmentId}`, { cookie: accountant.cookie })).json()) as { chargedPaisa: number; discountPaisa: number; paidPaisa: number };

/** A live structure for the fixture's level with one item, its charges generated for `classId`. */
async function liveStructure(levelId: string, classId: string, item: { amountPaisa: number; frequency: string }): Promise<Response> {
  const structure = ((await (await post("/api/fees/structures", { levelId }, accountant)).json()) as { id: string }).id;
  await post(`/api/fees/structures/${structure}/items`, { name: "Tuition", ...item }, accountant);
  await post(`/api/fees/structures/${structure}/send`, {}, accountant);
  expect((await approve(await requestOf(structure))).status).toBe(200);
  return post(`/api/fees/structures/${structure}/charges`, { classId }, accountant);
}

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  admin = await person("admin", "institution");
  secondAdmin = await person("admin", "institution");
  fixture = await classWith("plus2", 3);
  expect((await liveStructure(fixture.levelId, fixture.classId, { amountPaisa: 400_000, frequency: "yearly" })).status).toBe(200);
});

describe("money and approvals", () => {
  it("two discounts approved at the same moment by two Admins: one applies, the other is refused, never more than was charged", async () => {
    const pupil = fixture.pupils[0]!.enrollmentId;
    const propose = async () => {
      const response = await post(`/api/fees/enrollments/${pupil}/discounts`, { amountPaisa: 300_000, reason: "scholarship" }, accountant);
      expect(response.status).toBe(201);
      return requestOf(((await response.json()) as { id: string }).id);
    };
    const [first, second] = [await propose(), await propose()];
    const statuses = (await Promise.all([approve(first, admin), approve(second, secondAdmin)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const after = await account(pupil);
    expect(after.discountPaisa).toBe(300_000);
    expect(after.discountPaisa).toBeLessThanOrEqual(after.chargedPaisa);
  });

  it("a reversal draft left by a request that stopped half-way is sent, not left to block its payment", async () => {
    const pupil = fixture.pupils[1]!.enrollmentId;
    const payment = ((await (await post("/api/fees/payments/cash", { enrollmentId: pupil, amountPaisa: 5_000, idempotencyKey: key() }, accountant)).json()) as { paymentId: string }).paymentId;
    // What the first of the two writes leaves when the second never runs: a draft holding the payment's one open reversal.
    const draft = key();
    await db
      .prepare(
        `INSERT INTO fee_adjustments (public_id, kind, enrollment_id, amount_paisa, note, payment_entry_id, created_by_user_id, created_at)
         SELECT ?1, 'reversal', le.enrollment_id, -le.amount_paisa, 'Wrong student', le.id, u.id, ?3 FROM ledger_entries le, users u WHERE le.public_id = ?2 AND u.public_id = ?4`,
      )
      .bind(draft, payment, new Date().toISOString(), accountant.publicId)
      .run();
    const again = await post(`/api/fees/payments/${payment}/reversal`, { reason: "Wrong student" }, accountant);
    expect(again.status).toBe(201);
    expect(((await again.json()) as { id: string }).id).toBe(draft);
    expect(await count(`SELECT COUNT(*) AS n FROM fee_adjustments WHERE public_id = '${draft}' AND status = 'pending'`)).toBe(1);
    expect((await approve(await requestOf(draft))).status).toBe(200);
    expect((await account(pupil)).paidPaisa).toBe(0);
  });

  it("one voucher verified by two Accountants at the same moment makes one payment", async () => {
    const pupil = fixture.pupils[2]!;
    const sent = await post("/api/fees/me/vouchers", { amountPaisa: 25_000, bank: "Nabil Bank", reference: `TXN-${key().slice(0, 8)}`, paidOn: "2026-09-20" }, pupil.person);
    expect(sent.status).toBe(201);
    const id = ((await sent.json()) as { id: string }).id;
    const other = await person("accountant", "institution");
    const statuses = (await Promise.all([post(`/api/fees/vouchers/${id}/verify`, {}, accountant), post(`/api/fees/vouchers/${id}/verify`, {}, other)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect((await account(pupil.enrollmentId)).paidPaisa).toBe(25_000);
  });

  it("a class needing more charges than one write chunk gets every one of them", async () => {
    // Monthly charges start from the month a student was enrolled, so 16 students give over 100 charges, past one chunk.
    const big = await classWith("plus2", 16);
    expect((await liveStructure(big.levelId, big.classId, { amountPaisa: 1_000, frequency: "monthly" })).status).toBe(200);
    const { results } = await db
      .prepare(
        `SELECT en.public_id, COUNT(le.id) AS n FROM enrollments en JOIN classes cl ON cl.id = en.class_id
           LEFT JOIN ledger_entries le ON le.enrollment_id = en.id AND le.kind = 'charge' WHERE cl.public_id = ?1 GROUP BY en.id`,
      )
      .bind(big.classId)
      .all<{ n: number }>();
    expect(results).toHaveLength(16);
    expect(new Set(results.map((r) => r.n)).size).toBe(1); // every student the same full run
    expect(results.reduce((sum, r) => sum + r.n, 0)).toBeGreaterThan(100);
  });
});

describe("audit totals", () => {
  type Totals = { total: number };
  it("the trail's and the sign-ins' totals are the true counts, filtered or not", async () => {
    await db.prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, NULL, 'x@school.example', 0, 'bad_password', '203.0.113.9', 'test')").bind(new Date().toISOString()).run();
    const get = async (path: string) => ((await (await call(path, { cookie: admin.cookie })).json()) as Totals).total;
    expect(await get("/api/audit/events")).toBe(await count("SELECT COUNT(*) AS n FROM audit_events"));
    expect(await get("/api/audit/events?area=fees")).toBe(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action LIKE 'fees.%'"));
    expect(await get("/api/audit/sign-ins")).toBe(await count("SELECT COUNT(*) AS n FROM sign_in_events"));
    expect(await get("/api/audit/sign-ins?failed=1")).toBe(await count("SELECT COUNT(*) AS n FROM sign_in_events WHERE success = 0"));
  });
});

describe("the year's teaching in one request", () => {
  type YearTeaching = { classes: { classId: string; classTeacher: { name: string } | null; assignments: { offeringId: string; teacher: { name: string } | null }[] }[] };
  it("lists each class with its subjects and teachers, only in the person's sections, and only for those who may see assignments", async () => {
    const plus2 = await classWith("plus2", 1);
    const bachelors = await classWith("bachelors", 1);
    await assign(await teacherIn("plus2"), plus2.classId, plus2.offeringId);
    const read = async (who: Person) => call("/api/academics/teaching", { cookie: who.cookie });

    const all = (await (await read(await person("coordinator", "institution"))).json()) as YearTeaching;
    const mine = all.classes.find((c) => c.classId === plus2.classId)!;
    expect(mine.classTeacher).not.toBeNull();
    expect(mine.assignments.find((a) => a.offeringId === plus2.offeringId)?.teacher).not.toBeNull();
    expect(all.classes.map((c) => c.classId)).toContain(bachelors.classId);

    const scoped = (await (await read(await person("coordinator", "section", "plus2"))).json()) as YearTeaching;
    expect(scoped.classes.map((c) => c.classId)).toContain(plus2.classId);
    expect(scoped.classes.map((c) => c.classId)).not.toContain(bachelors.classId);

    expect((await read(fixture.pupils[0]!.person)).status).toBe(403);
    expect((await call("/api/academics/teaching")).status).toBe(401);
  });
});
