import { beforeAll, describe, expect, it } from "vitest";

import { auditKey, call, db, person, seedSections, type Person } from "./academics-helpers";
import { approvalOf, idOf, liveFees } from "./fees-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * The reading side of the fees redesign (D-172, slice 6), written before the code: the Principal's Discounts report, the
 * Accountant's list of students affected by a price change, and the closed state of an account in the statement and the
 * dues list. Reach is tested too: nobody else reads the Discounts report; the other wing's Accountant reads no price change.
 */

let fixture: ClassFixture, bachelorsFixture: ClassFixture;
let accountant: Person, otherAccountant: Person, admin: Person, coordinator: Person, student: Person;
let structureId: string;

const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const patch = (path: string, body: unknown, who: Person) => call(path, { method: "PATCH", body, cookie: who.cookie });
const key = () => crypto.randomUUID().replace(/-/g, "");
const get = async <T>(path: string, who: Person) => (await (await call(path, { cookie: who.cookie })).json()) as T;

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  otherAccountant = await person("accountant", "section", "bachelors");
  admin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  fixture = await classWith("plus2", 3);
  bachelorsFixture = await classWith("bachelors", 1);
  student = fixture.pupils[0]!.person;
  structureId = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [fixture.levelId], items: [{ name: "Tuition", amountPaisa: 800_000 }, { name: "Exam", amountPaisa: 200_000 }] });
  // Pupil 0 pays everything; the others pay nothing.
  expect((await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: 1_000_000, idempotencyKey: key() }, accountant)).status).toBe(201);
});

describe("the Principal's Discounts report", () => {
  it("lists every discount given: who, how much, why, when and by whom, with the active total", async () => {
    const a = await post(`/api/fees/enrollments/${fixture.pupils[1]!.enrollmentId}/discounts`, { amountPaisa: 50_000, reason: "scholarship" }, admin);
    const b = await post(`/api/fees/enrollments/${fixture.pupils[2]!.enrollmentId}/discounts`, { percent: 10, reason: "other", note: "Flood relief" }, admin);
    expect([a.status, b.status]).toEqual([201, 201]);
    const removed = await idOf(await post(`/api/fees/enrollments/${fixture.pupils[2]!.enrollmentId}/discounts`, { amountPaisa: 1_000, reason: "sibling" }, admin));
    expect((await call(`/api/fees/discounts/${removed}`, { method: "DELETE", cookie: admin.cookie })).status).toBe(200);

    const report = await get<{ discounts: { id: string; studentName: string; sid: string; className: string; amountPaisa: number; reason: string; note: string | null; status: string; givenOnBs: string | null }[]; activePaisa: number; activeCount: number }>("/api/fees/discounts", admin);
    expect(report.discounts.map((d) => d.amountPaisa).sort((x, y) => x - y)).toEqual([1_000, 50_000, 100_000]);
    expect(report.discounts.find((d) => d.amountPaisa === 100_000)).toMatchObject({ reason: "other", note: "Flood relief", status: "active" });
    expect(report.discounts.find((d) => d.amountPaisa === 1_000)?.status).toBe("removed");
    expect(report.discounts[0]!.studentName).toEqual(expect.any(String));
    expect(report.discounts[0]!.givenOnBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report).toMatchObject({ activePaisa: 150_000, activeCount: 2 });
  });

  it("only the Principal reads it: not the Accountant, the Co-ordinator or a student", async () => {
    for (const who of [accountant, otherAccountant, coordinator, student]) expect((await call("/api/fees/discounts", { cookie: who.cookie })).status).toBe(403);
  });
});

describe("price changes after an approved edit", () => {
  let draftId: string;
  it("an edit that lowers one price and raises another lists each student affected, with the net change and what is owed now", async () => {
    const asked = await post(`/api/fees/structures/${structureId}/edit-request`, { reason: "New session prices" }, accountant);
    expect(asked.status).toBe(201);
    expect((await post(`/api/approvals/${await idOf(asked)}/approve`, undefined, admin)).status).toBe(200);
    const draft = await get<{ id: string; items: { id: string; name: string }[] }>(`/api/fees/structures/${structureId}`, accountant);
    draftId = draft.id;
    for (const [name, amountPaisa] of [["Tuition", 700_000], ["Exam", 250_000]] as const) {
      expect((await patch(`/api/fees/items/${draft.items.find((i) => i.name === name)!.id}`, { amountPaisa }, accountant)).status).toBe(200);
    }
    expect((await post(`/api/fees/structures/${draftId}/send`, {}, accountant)).status).toBe(201);
    expect((await post(`/api/approvals/${(await approvalOf(draftId))!}/approve`, undefined, admin)).status).toBe(200);

    const list = await get<{ students: { enrollmentId: string; studentName: string; sid: string; changePaisa: number; balancePaisa: number }[] }>(`/api/fees/structures/${draftId}/price-changes`, accountant);
    expect(list.students).toHaveLength(3);
    // Tuition 100 less, Exam 50 more: a net 50 less for everyone, so the one who paid in full is owed 50 back.
    expect(list.students.map((s) => s.changePaisa)).toEqual([-50_000, -50_000, -50_000]);
    expect(list.students.find((s) => s.enrollmentId === fixture.pupils[0]!.enrollmentId)).toMatchObject({ balancePaisa: -50_000 });
    expect(list.students.find((s) => s.enrollmentId === fixture.pupils[1]!.enrollmentId)!.balancePaisa).toBeGreaterThan(0);
  });

  it("a structure that was never edited has none; the other wing's Accountant and the Co-ordinator read none", async () => {
    const plain = await liveFees({ accountant, admin, sectionKey: "bachelors", levelIds: [bachelorsFixture.levelId], items: [{ name: "Plain", amountPaisa: 1_000 }] });
    expect((await get<{ students: unknown[] }>(`/api/fees/structures/${plain}/price-changes`, accountant)).students).toEqual([]);
    expect((await call(`/api/fees/structures/${plain}/price-changes`, { cookie: otherAccountant.cookie })).status).toBe(200); // that wing's own Accountant
    expect((await call(`/api/fees/structures/${draftId}/price-changes`, { cookie: otherAccountant.cookie })).status).toBe(404);
    expect((await call(`/api/fees/structures/${draftId}/price-changes`, { cookie: coordinator.cookie })).status).toBe(403);
    expect((await call(`/api/fees/structures/${draftId}/price-changes`, { cookie: student.cookie })).status).toBe(403);
  });
});

describe("a closed account in the statement and the dues list", () => {
  it("the statement says it is closed and when; the dues list no longer has it (archived)", async () => {
    const pupil = fixture.pupils[2]!;
    const before = await get<{ closed: unknown; balancePaisa: number }>(`/api/fees/enrollments/${pupil.enrollmentId}`, accountant);
    expect(before.closed).toBeNull();
    // Settled first: a student leaves only with nothing owed and no credit.
    expect((await post(`/api/fees/enrollments/${pupil.enrollmentId}/discounts`, { amountPaisa: before.balancePaisa, reason: "other", note: "Left" }, admin)).status).toBe(201);
    const asked = await post("/api/students/leave-requests", { enrollmentId: pupil.enrollmentId, reason: "Moving away" }, coordinator);
    const request = (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1").bind(await idOf(asked)).first<{ public_id: string }>())!.public_id;
    expect((await post(`/api/approvals/${request}/approve`, undefined, admin)).status).toBe(200);

    const after = await get<{ closed: { closedOnBs: string | null; owedPaisa: number } | null; balancePaisa: number }>(`/api/fees/enrollments/${pupil.enrollmentId}`, accountant);
    expect(after.closed).toMatchObject({ owedPaisa: 0 });
    expect(after.closed!.closedOnBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(after.balancePaisa).toBe(0);

    const dues = await get<{ students: { enrollmentId: string; closed: boolean; duePaisa: number }[]; totals: { duePaisa: number } }>("/api/fees/dues", accountant);
    expect(dues.students.find((s) => s.enrollmentId === pupil.enrollmentId)).toBeUndefined(); // archived
    expect(dues.students.find((s) => s.enrollmentId === fixture.pupils[1]!.enrollmentId)!.closed).toBe(false);
    void auditKey;
  });

  it("a student whose account is closed sees it closed on their own page", async () => {
    const own = await get<{ closed: { owedPaisa: number } | null }>("/api/fees/me", fixture.pupils[2]!.person);
    expect(own.closed).toMatchObject({ owedPaisa: expect.any(Number) });
  });
});
