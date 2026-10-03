import { beforeAll, describe, expect, it } from "vitest";

import { createContent, updateContent } from "../src/modules/content/service";
import { auditKey, call, db, person, seedSections, type Person } from "./academics-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * The Principal's review panel (D-102): one request with everything needed to decide it, for each of the five kinds,
 * read from the subject now; the inbox marks the reader's own requests (admin FUT F-13), which they may withdraw; a
 * changed subject shows as stale before anyone presses Approve; a decision someone else already made says so (F-07);
 * a discount shows its reason and note (F-06).
 */

let fixture: ClassFixture;
let accountant: Person, coordinator: Person, admin: Person, secondAdmin: Person;
const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const get = (path: string, who: Person) => call(path, { cookie: who.cookie });
const key = () => crypto.randomUUID().replace(/-/g, "");
const requestOf = async (subjectId: string) =>
  (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 ORDER BY id DESC LIMIT 1").bind(subjectId).first<{ public_id: string }>())!.public_id;

interface Review {
  request: { id: string; kind: string; requestedBy: string; requesterRole: string | null; mine: boolean; createdOnBs: string | null };
  status: string;
  decisionReason: string | null;
  detail: Record<string, unknown> | null;
}
const review = async (requestId: string, who: Person = admin) => (await (await get(`/api/approvals/${requestId}`, who)).json()) as Review;

let structureRequest: string, structureId: string;
beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  secondAdmin = await person("admin", "institution");
  fixture = await classWith("plus2", 2);
  const structure = ((await (await post("/api/fees/structures", { levelId: fixture.levelId }, accountant)).json()) as { id: string }).id;
  structureId = structure;
  await post(`/api/fees/structures/${structure}/items`, { name: "Tuition", amountPaisa: 350_000, frequency: "monthly" }, accountant);
  await post(`/api/fees/structures/${structure}/items`, { name: "Admission", amountPaisa: 1_500_000, frequency: "one_time" }, accountant);
  await post(`/api/fees/structures/${structure}/send`, {}, accountant);
  structureRequest = await requestOf(structure);
});

describe("a fee structure", () => {
  it("shows every item and the yearly total, who sent it with their role, and the BS day", async () => {
    const r = await review(structureRequest);
    expect(r.status).toBe("pending");
    expect(r.request).toMatchObject({ kind: "fee_structure", requesterRole: "accountant", mine: false });
    expect(r.request.createdOnBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.detail).toMatchObject({
      kind: "fee_structure",
      items: [
        { name: "Tuition", amountPaisa: 350_000, frequency: "monthly" },
        { name: "Admission", amountPaisa: 1_500_000, frequency: "one_time" },
      ],
      yearlyTotalPaisa: 12 * 350_000 + 1_500_000,
    });
    // Approved, it is charged, and the money kinds below have something to work on.
    expect((await post(`/api/approvals/${structureRequest}/approve`, undefined, admin)).status).toBe(200);
    expect((await review(structureRequest)).status).toBe("approved");
    expect((await post(`/api/fees/structures/${structureId}/charges`, { classId: fixture.classId }, accountant)).status).toBe(200);
  });

  it("a second Admin approving afterwards is told it was already decided, not that it changed (F-07)", async () => {
    const response = await post(`/api/approvals/${structureRequest}/approve`, undefined, secondAdmin);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already_decided" });
  });
});

describe("money requests", () => {
  it("a discount shows the student, class, amount, percentage, reason and note (F-06)", async () => {
    const { id } = (await (await post(`/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}/discounts`, { percent: 10, reason: "other", note: "Flood relief" }, accountant)).json()) as { id: string };
    const r = await review(await requestOf(id));
    expect(r.detail).toMatchObject({ kind: "discount", percent: 10, reason: "other", note: "Flood relief" });
    expect(typeof r.detail!.sid).toBe("string");
    expect(r.detail!.amountPaisa).toBeGreaterThan(0);
    expect(r.detail!.className).toEqual(expect.stringContaining(" · "));
  });

  it("a reversal shows the original payment: its amount, day and receipt", async () => {
    const paid = (await (await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[1]!.enrollmentId, amountPaisa: 25_000, idempotencyKey: key() }, accountant)).json()) as { paymentId: string; receipt: { number: string } };
    const { id } = (await (await post(`/api/fees/payments/${paid.paymentId}/reversal`, { reason: "Payment recorded twice" }, accountant)).json()) as { id: string };
    const r = await review(await requestOf(id));
    expect(r.detail).toMatchObject({ kind: "reversal", amountPaisa: 25_000, reason: "Payment recorded twice", payment: { amountPaisa: 25_000, receiptNumber: paid.receipt.number, method: "cash" } });
    expect((r.detail!.payment as { paidOnBs: string }).paidOnBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a refund shows the student's credit now; how it is paid back is left to the Accountant", async () => {
    const owed = ((await (await call(`/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}`, { cookie: accountant.cookie })).json()) as { balancePaisa: number }).balancePaisa;
    await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: owed + 18_000, idempotencyKey: key() }, accountant);
    const { id } = (await (await post(`/api/fees/enrollments/${fixture.pupils[0]!.enrollmentId}/refunds`, { amountPaisa: 18_000, reason: "Excess payment" }, accountant)).json()) as { id: string };
    const r = await review(await requestOf(id));
    expect(r.detail).toMatchObject({ kind: "refund", amountPaisa: 18_000, availableCreditPaisa: 18_000 });
    expect(r.detail).not.toHaveProperty("method");
  });
});

describe("website content, and the reader's own requests", () => {
  const draft = async (who: Person, title: string) => {
    const made = await createContent(db, auditKey, who.publicId, { kind: "notice", title, body: "Grade 11 first terminal results are out. Students can check them on the portal.", contact: null, urgent: false, publishOn: "2026-10-01", hideAfter: null });
    if (!made.ok) throw new Error(JSON.stringify(made));
    expect((await post("/api/approvals", { kind: "website_content", subjectId: made.publicId }, who)).status).toBe(201);
    return { contentId: made.publicId, requestId: await requestOf(made.publicId) };
  };

  it("shows the kind, title and the start of the text, as it will be published", async () => {
    const { requestId } = await draft(coordinator, "Results are out");
    const r = await review(requestId);
    expect(r.request).toMatchObject({ requesterRole: "coordinator" });
    expect(r.detail).toMatchObject({ kind: "website_content", contentKind: "notice", title: "Results are out", bodyTruncated: false });
    expect(r.detail!.bodyPreview).toContain("Grade 11 first terminal results are out.");
  });

  it("shows stale as soon as the subject changes, before anyone presses Approve; Approve then says stale", async () => {
    const { contentId, requestId } = await draft(coordinator, "Will change");
    await updateContent(db, auditKey, admin.publicId, contentId, { title: "Changed while waiting" });
    expect((await review(requestId)).status).toBe("stale");
    const response = await post(`/api/approvals/${requestId}/approve`, undefined, admin);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale" });
  });

  it("the Principal's own request is marked theirs, refused as their own, and they may take it back (F-13)", async () => {
    const { contentId, requestId } = await draft(admin, "Principal's own notice");
    const inbox = (await (await get("/api/approvals", admin)).json()) as { requests: { id: string; mine: boolean }[] };
    expect(inbox.requests.find((r) => r.id === requestId)).toMatchObject({ mine: true });
    const otherView = (await (await get("/api/approvals", secondAdmin)).json()) as { requests: { id: string; mine: boolean }[] };
    expect(otherView.requests.find((r) => r.id === requestId)).toMatchObject({ mine: false });

    const refused = await post(`/api/approvals/${requestId}/approve`, undefined, admin);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "own_request" });

    expect((await post(`/api/approvals/${requestId}/withdraw`, undefined, admin)).status).toBe(200);
    expect((await review(requestId, secondAdmin)).status).toBe("withdrawn");
    const back = await db.prepare("SELECT status FROM content_items WHERE public_id = ?1").bind(contentId).first<{ status: string }>();
    expect(back!.status).toBe("draft");
    // Another Admin still cannot take it back for them.
    const { requestId: again } = await draft(admin, "Second own notice");
    expect((await post(`/api/approvals/${again}/withdraw`, undefined, secondAdmin)).status).toBe(403);
  });

  it("is the deciders' only: the Co-ordinator and the Accountant cannot open a request", async () => {
    for (const who of [coordinator, accountant]) expect((await get(`/api/approvals/${structureRequest}`, who)).status).toBe(403);
    expect((await get(`/api/approvals/${"0".repeat(32)}`, admin)).status).toBe(404);
  });
});
