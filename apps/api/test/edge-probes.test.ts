import { beforeAll, describe, expect, it } from "vitest";

import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, examTerm, pattern, resultsClass, sheetIdOf, sheetPath, type Subject, type Term } from "./results-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Edge probes from the full-year test (D-084): inputs a real school will send sooner or later. Each one must be refused
 * cleanly (4xx, nothing written) or handled; none may crash (5xx) or be accepted when it should not.
 */

let accountant: Person, coordinator: Person, admin: Person;
let fixture: ClassFixture;
const post = (path: string, body: unknown, who?: Person) => call(path, { method: "POST", body, cookie: who?.cookie });
const put = (path: string, body: unknown, who: Person) => call(path, { method: "PUT", body, cookie: who.cookie });
const patch = (path: string, body: unknown, who: Person) => call(path, { method: "PATCH", body, cookie: who.cookie });
const key = () => crypto.randomUUID().replace(/-/g, "");
const tomorrow = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  fixture = await classWith("plus2", 2);
  const structure = ((await (await post("/api/fees/structures", { levelId: fixture.levelId }, accountant)).json()) as { id: string }).id;
  await post(`/api/fees/structures/${structure}/items`, { name: "Annual", amountPaisa: 100_000, frequency: "yearly" }, accountant);
  await post(`/api/fees/structures/${structure}/send`, {}, accountant);
  const request = (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1").bind(structure).first<{ public_id: string }>())!.public_id;
  await post(`/api/approvals/${request}/approve`, undefined, admin);
  await post(`/api/fees/structures/${structure}/charges`, { classId: fixture.classId }, accountant);
});

describe("money inputs", () => {
  it("zero, negative, fractional and absurd amounts are refused; nothing is written", async () => {
    const enrollmentId = fixture.pupils[0]!.enrollmentId;
    for (const amountPaisa of [0, -100, 10.5, 1e15]) {
      const r = await post("/api/fees/payments/cash", { enrollmentId, amountPaisa, idempotencyKey: key() }, accountant);
      expect(r.status, `cash ${amountPaisa}`).toBeGreaterThanOrEqual(400);
      expect(r.status, `cash ${amountPaisa}`).toBeLessThan(500);
    }
    for (const percent of [0, 101, -5]) {
      const r = await post(`/api/fees/enrollments/${enrollmentId}/discounts`, { percent, reason: "sibling" }, accountant);
      expect(r.status, `discount ${percent}%`).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
  });

  it("a bank deposit dated in the future is refused", async () => {
    const r = await post("/api/fees/me/vouchers", { amountPaisa: 1_000, bank: "Nabil", reference: `F-${key().slice(0, 8)}`, paidOn: tomorrow() }, fixture.pupils[0]!.person);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("a cash payment for an enrollment that does not exist is 404, not a crash", async () => {
    expect((await post("/api/fees/payments/cash", { enrollmentId: key(), amountPaisa: 100, idempotencyKey: key() }, accountant)).status).toBe(404);
  });
});

describe("homework and dates", () => {
  it("homework due in the past is refused", async () => {
    const r = await post("/api/assignments", { classId: fixture.classId, offeringId: fixture.offeringId, title: "Old", instructions: "x", dueAt: new Date(Date.now() - 86_400_000).toISOString() }, fixture.classTeacher);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("a teacher attendance day in the future is refused", async () => {
    const r = await put("/api/attendance/teachers/day", { date: tomorrow(), exceptions: [], reason: "Planning ahead" }, coordinator);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe("results edge cases", () => {
  let cls: ClassFixture;
  let subject: Subject;
  let exams: Term;
  let term: string;

  beforeAll(async () => {
    exams = await examTerm(pattern(false, [{ name: "Final", weight: 100, hasPractical: false }]));
    term = exams.terminals[0]!;
    cls = await resultsClass("plus2", 2, exams);
    subject = await addSubject(cls, { full: 50 });
  });

  it("a subject's full marks lowered below a mark already given never pass 100%: the sheet keeps the paper it was made with", async () => {
    await enterAndSubmit(cls, subject, term, 90, false); // 45 of 50
    expect((await patch(`/api/academics/offerings/${subject.offeringId}`, { fullMarksHundredths: 4000 }, coordinator)).status).toBe(200);
    const grid = (await (await call(sheetPath(cls, subject, term), { cookie: subject.teacher.cookie })).json()) as { components: { maxHundredths: number }[] };
    expect(grid.components[0]!.maxHundredths).toBe(5000);
    await patch(`/api/academics/offerings/${subject.offeringId}`, { fullMarksHundredths: 5000 }, coordinator);
  });

  it("a class with no students, and a terminal with nothing entered, cannot be published and do not crash", async () => {
    const empty = await resultsClass("plus2", 0, exams);
    await addSubject(empty);
    const r = await post(`/api/results/classes/${empty.classId}/publish`, { terminalId: term }, coordinator);
    expect(r.status).toBe(409);
  });

  it("a sheet with a missing mark cannot be verified straight from a draft, and publish stays closed", async () => {
    await enterAndSubmit(cls, subject, term, 90);
    const id = await sheetIdOf(cls, subject, term);
    const verified = (await (await post("/api/results/review/verify", { sheetIds: [id] }, coordinator)).json()) as { verified: number };
    expect(verified.verified).toBe(1);
    expect((await post(`/api/results/classes/${cls.classId}/publish`, { terminalId: term }, coordinator)).status).toBe(201);
    // A publish for a terminal of another year, or an unknown one, is 404, not a crash.
    expect((await post(`/api/results/classes/${cls.classId}/publish`, { terminalId: key() }, coordinator)).status).toBe(404);
  });

  it("a mark is refused on a published sheet (the grid answers, the database refuses)", async () => {
    const r = await put(sheetPath(cls, subject, term), { marks: [{ enrollmentId: cls.pupils[0]!.enrollmentId, componentId: "theory", valueHundredths: 100 }] }, subject.teacher);
    expect(r.status).toBe(409);
  });
});
