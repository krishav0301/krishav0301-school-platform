import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { applyPriceChanges, chargeLinked } from "../src/modules/fees";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { idOf, liveFees } from "./fees-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * A student leaves, and the fee account closes (D-172, slice 5), written before the code. The Co-ordinator asks, with a
 * reason; the Principal approves; in one batch the student is marked Left and their fee account is closed for everyone:
 * what is unpaid stays owed, nothing reopens it, and no payment, discount, refund or charge is taken afterwards. Left no
 * longer needs zero dues (CLAUDE.md section 6, changed here).
 */

let fixture: ClassFixture;
let accountant: Person, admin: Person, secondAdmin: Person, coordinator: Person, otherCoordinator: Person;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const key = () => crypto.randomUUID().replace(/-/g, "");
const ask = (pupil: number, reason = "Moving to another city", who: Person = coordinator) => post("/api/students/leave-requests", { enrollmentId: fixture.pupils[pupil]!.enrollmentId, reason }, who);
type Account = { chargedPaisa: number; paidPaisa: number; balancePaisa: number; duePaisa: number; discountPaisa: number; creditPaisa: number };
const account = async (pupil: number) => (await (await call(`/api/fees/enrollments/${fixture.pupils[pupil]!.enrollmentId}`, { cookie: accountant.cookie })).json()) as Account;
const statusOf = async (pupil: number) =>
  db
    .prepare("SELECT st.status AS student, en.status AS enrollment FROM enrollments en JOIN students st ON st.id = en.student_id WHERE en.public_id = ?1")
    .bind(fixture.pupils[pupil]!.enrollmentId)
    .first<{ student: string; enrollment: string }>();
const closureOf = async (pupil: number) =>
  db.prepare("SELECT c.owed_paisa FROM fee_account_closures c JOIN enrollments en ON en.id = c.enrollment_id WHERE en.public_id = ?1").bind(fixture.pupils[pupil]!.enrollmentId).first<{ owed_paisa: number }>();
const approve = (requestId: string, who: Person = admin) => post(`/api/approvals/${requestId}/approve`, undefined, who);
const requestOf = async (leaveId: string) =>
  (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(leaveId).first<{ public_id: string }>())!.public_id;

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  admin = await person("admin", "institution");
  secondAdmin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  fixture = await classWith("plus2", 6);
  await classWith("bachelors", 1);
  otherCoordinator = await person("coordinator", "section", "bachelors");
  await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [fixture.levelId], items: [{ name: "Tuition", amountPaisa: 800_000 }, { name: "Exam", amountPaisa: 200_000 }] });
  // Pupil 0 has paid in part; the rest owe everything.
  expect((await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: 300_000, idempotencyKey: key() }, accountant)).status).toBe(201);
});

describe("asking for a student to be marked Left", () => {
  it("the Co-ordinator asks with a reason; nothing changes until the Principal decides, and the Principal sees what is owed", async () => {
    const asked = await ask(0);
    expect(asked.status).toBe(201);
    const leaveId = await idOf(asked);
    expect(await statusOf(0)).toEqual({ student: "active", enrollment: "active" });
    expect(await closureOf(0)).toBeNull();
    const review = (await (await call(`/api/approvals/${await requestOf(leaveId)}`, { cookie: admin.cookie })).json()) as {
      request: { kind: string };
      detail: { kind: string; student: string; reason: string; owedPaisa: number; className: string | null };
    };
    expect(review.request.kind).toBe("student_leave");
    expect(review.detail).toMatchObject({ kind: "student_leave", reason: "Moving to another city", owedPaisa: 700_000 });
    expect(review.detail.student).toEqual(expect.any(String));
    // The student's fees are untouched and still take payments.
    expect((await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: 100_000, idempotencyKey: key() }, accountant)).status).toBe(201);
  });

  it("needs a reason; only the Co-ordinator of the section asks; one open request for a student", async () => {
    expect((await ask(1, "x")).status).toBe(400);
    expect((await post("/api/students/leave-requests", { enrollmentId: fixture.pupils[1]!.enrollmentId }, coordinator)).status).toBe(400);
    for (const who of [accountant, admin, fixture.pupils[1]!.person, fixture.classTeacher]) expect((await ask(1, "Moving away", who)).status).toBe(403);
    expect((await ask(1, "Moving away", otherCoordinator)).status).toBe(404);
    expect((await ask(1)).status).toBe(201);
    expect((await ask(1, "Again")).status).toBe(409);
    expect((await post("/api/students/leave-requests", { enrollmentId: key(), reason: "Moving away" }, coordinator)).status).toBe(404);
  });

  it("the Accountant and the Co-ordinator cannot approve it, and the Co-ordinator cannot approve their own", async () => {
    const leaveId = await idOf(await ask(2));
    const requestId = await requestOf(leaveId);
    expect((await approve(requestId, accountant)).status).toBe(403);
    expect((await approve(requestId, coordinator)).status).toBe(403);
    expect(await statusOf(2)).toEqual({ student: "active", enrollment: "active" });
  });

  it("a declined request changes nothing and a new one can be made", async () => {
    const leaveId = await idOf(await ask(3));
    expect((await post(`/api/approvals/${await requestOf(leaveId)}/decline`, { reason: "Talk to the family first" }, admin)).status).toBe(200);
    expect(await statusOf(3)).toEqual({ student: "active", enrollment: "active" });
    expect(await closureOf(3)).toBeNull();
    expect((await ask(3, "They have decided")).status).toBe(201);
  });
});

describe("approved: the student is Left and the fee account is closed", () => {
  const leaveOf = async (pupil: number) =>
    (await db.prepare("SELECT public_id FROM student_leave_requests WHERE enrollment_id = (SELECT id FROM enrollments WHERE public_id = ?1) AND status = 'pending'").bind(fixture.pupils[pupil]!.enrollmentId).first<{ public_id: string }>())!.public_id;
  const settleByDiscount = async (pupil: number) => {
    const { balancePaisa } = await account(pupil);
    expect((await post(`/api/fees/enrollments/${fixture.pupils[pupil]!.enrollmentId}/discounts`, { amountPaisa: balancePaisa, reason: "other", note: "Left before the term ended" }, admin)).status).toBe(201);
  };

  it("blocked while anything is owed: the Principal is told what to do, and nothing changes", async () => {
    const before = await account(1);
    expect(before.balancePaisa).toBe(1_000_000);
    const refused = await approve(await requestOf(await leaveOf(1)));
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toMatch(/must be settled.*10,000\.00 is still owed.*discount/i);
    expect(await statusOf(1)).toEqual({ student: "active", enrollment: "active" });
    expect(await closureOf(1)).toBeNull();
  });

  it("the Principal gives a discount for what is owed, then approves: one batch, Left, the enrollment leaves the class, the account closes at zero", async () => {
    await settleByDiscount(1);
    expect(await account(1)).toMatchObject({ balancePaisa: 0 });
    const requestId = await requestOf(await leaveOf(1));
    expect((await approve(requestId)).status).toBe(200);
    expect(await statusOf(1)).toEqual({ student: "left", enrollment: "left" });
    expect(await closureOf(1)).toEqual({ owed_paisa: 0 });
    // A second click is "already decided" and changes nothing.
    expect((await approve(requestId, secondAdmin)).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM fee_account_closures WHERE enrollment_id = (SELECT id FROM enrollments WHERE public_id = ?1)", fixture.pupils[1]!.enrollmentId)).toBe(1);
  });

  it("credit blocks it too: the Accountant pays it back first", async () => {
    await settleByDiscount(0); // part-paid: 600,000 owed, discounted away
    expect((await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: 50_000, idempotencyKey: key() }, accountant)).status).toBe(201);
    expect(await account(0)).toMatchObject({ creditPaisa: 50_000 });
    const requestId = await requestOf(await leaveOf(0));
    const refused = await approve(requestId);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toMatch(/in credit.*pays it back/i);
    expect((await post(`/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}/refunds`, { amountPaisa: 50_000, method: "cash" }, accountant)).status).toBe(201);
    expect((await approve(requestId)).status).toBe(200);
    expect(await closureOf(0)).toEqual({ owed_paisa: 0 });
  });

  it("nobody can take anything on a closed account: payment, discount, refund, reversal, voucher", async () => {
    const enrollmentId = fixture.pupils[1]!.enrollmentId;
    const entries = () => count("SELECT COUNT(*) AS n FROM ledger_entries WHERE enrollment_id = (SELECT id FROM enrollments WHERE public_id = ?1)", enrollmentId);
    const before = await entries();
    expect((await post("/api/fees/payments/cash", { enrollmentId, amountPaisa: 1_000, idempotencyKey: key() }, accountant)).status).toBe(409);
    expect((await post(`/api/fees/enrollments/${enrollmentId}/discounts`, { amountPaisa: 1_000, reason: "sibling" }, admin)).status).toBeGreaterThanOrEqual(409); // refused: fully discounted, and closed
    expect((await post(`/api/fees/enrollments/${enrollmentId}/refunds`, { amountPaisa: 1, method: "cash" }, accountant)).status).toBe(422); // no credit to give back
    expect(await entries()).toBe(before);
    // The database says the same, whoever asks: a direct entry is refused.
    await expect(
      db
        .prepare(
          `INSERT INTO ledger_entries (public_id, enrollment_id, kind, amount_paisa, created_by_user_id, created_at, prev_hash, hash)
           SELECT ?1, en.id, 'discount', -5, 1, 'now', (SELECT last_hash FROM ledger_chain_head), ?1 FROM enrollments en WHERE en.public_id = ?2`,
        )
        .bind(key(), enrollmentId)
        .run(),
    ).rejects.toThrow(/fee account is closed/);
  });

  it("charging and price changes skip a closed account: the sweep adds nothing to it", async () => {
    const before = await account(1);
    await chargeLinked(db, auditKey);
    await applyPriceChanges(db, auditKey);
    expect(await account(1)).toEqual(before);
  });

  it("a closure is never reopened, changed or removed", async () => {
    await expect(db.prepare("DELETE FROM fee_account_closures").run()).rejects.toThrow(/never reopened/);
    await expect(db.prepare("UPDATE fee_account_closures SET owed_paisa = 0").run()).rejects.toThrow(/never reopened/);
    await expect(db.prepare("DELETE FROM student_leave_requests").run()).rejects.toThrow(/kept/);
  });

  it("two Principals approving at once: one wins; the student is marked Left once", async () => {
    const leaveId = await idOf(await ask(4));
    await settleByDiscount(4);
    const requestId = await requestOf(leaveId);
    const [a, b] = await Promise.all([approve(requestId, admin), approve(requestId, secondAdmin)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await count("SELECT COUNT(*) AS n FROM fee_account_closures WHERE enrollment_id = (SELECT id FROM enrollments WHERE public_id = ?1)", fixture.pupils[4]!.enrollmentId)).toBe(1);
  });

  it("a student already Left cannot be asked for again, and the others of the class are untouched", async () => {
    expect((await ask(1, "Again")).status).toBeGreaterThanOrEqual(404);
    expect(await statusOf(5)).toEqual({ student: "active", enrollment: "active" });
  });

  it("the ledger and audit chains are unbroken", async () => {
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });
});
