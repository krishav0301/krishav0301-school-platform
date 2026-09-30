import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { createContent, updateContent } from "../src/modules/content/service";
import { decideRequest, requestApproval, withdrawRequest } from "../src/modules/approvals/service";
import { auditActions, auditKey, count, db, person, type Person } from "./approvals-helpers";

let coordinator: Person, coordinator2: Person, admin: Person, admin2: Person, superAdmin: Person, accountant: Person, teacher: Person, student: Person;
beforeAll(async () => {
  coordinator = await person("coordinator", "institution");
  coordinator2 = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  admin2 = await person("admin", "institution");
  superAdmin = await person("super_admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
});

const notice = (title: string) => ({ kind: "notice" as const, title, body: "Body", contact: null, urgent: false, publishOn: "2026-09-22", hideAfter: null });
async function draft(title = "Winter break", actor = coordinator.publicId): Promise<string> {
  const result = await createContent(db, auditKey, actor, notice(title));
  if (!result.ok) throw new Error(`draft setup failed: ${JSON.stringify(result)}`);
  return result.publicId;
}
const statusOf = async (publicId: string) => (await db.prepare("SELECT status FROM content_items WHERE public_id = ?1").bind(publicId).first<{ status: string }>())?.status;
const requestStatus = async (publicId: string) => (await db.prepare("SELECT status FROM approval_requests WHERE public_id = ?1").bind(publicId).first<{ status: string }>())?.status;
const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");

// ---------------------------------------------------------------------------------------------
describe("requestApproval", () => {
  it("moves the item to waiting and creates a pending request, audited once", async () => {
    const id = await draft("Fee reminder");
    const before = await audits();
    const result = await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id });
    expect(result.ok).toBe(true);
    expect(await statusOf(id)).toBe("waiting");
    if (result.ok) {
      expect(await requestStatus(result.publicId)).toBe("pending");
      expect(await auditActions(result.publicId)).toEqual(["approvals.request.created"]);
    }
    expect(await audits()).toBe(before + 1);
  });

  it("a second request while one is pending changes nothing: the item is no longer a draft", async () => {
    const id = await draft();
    await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id });
    const before = await count("SELECT COUNT(*) AS n FROM approval_requests");
    expect(await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id })).toEqual({ ok: false, reason: "not_found" });
    expect(await count("SELECT COUNT(*) AS n FROM approval_requests")).toBe(before);
  });

  it("a non-draft item (already waiting, or live) cannot be sent again", async () => {
    const id = await draft();
    await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id });
    // it is now waiting, not draft; withdraw it back to draft, approve it live, then try again on the live one
    const req = await db.prepare("SELECT public_id FROM approval_requests WHERE subject_id = (SELECT id FROM content_items WHERE public_id = ?1)").bind(id).first<{ public_id: string }>();
    await decideRequest(db, auditKey, admin.publicId, req!.public_id, { approve: true });
    expect(await statusOf(id)).toBe("live");
    expect(await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id })).toEqual({ ok: false, reason: "not_found" });
  });

  it("an Accountant, Teacher and Student may not request", async () => {
    const id = await draft();
    for (const who of [accountant, teacher, student]) {
      expect(await requestApproval(db, auditKey, who.publicId, { kind: "website_content", subjectId: id })).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await statusOf(id)).toBe("draft");
  });

  it("a missing subject is not_found; a fees kind is not the Co-ordinator's to send (every kind is wired now, D-075)", async () => {
    expect(await requestApproval(db, auditKey, coordinator.publicId, { kind: "fee_structure", subjectId: "0".repeat(32) })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: "0".repeat(32) })).toEqual({ ok: false, reason: "not_found" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("decideRequest", () => {
  async function pending(title = "Notice", actor = coordinator.publicId) {
    const id = await draft(title, actor);
    const result = await requestApproval(db, auditKey, actor, { kind: "website_content", subjectId: id });
    if (!result.ok) throw new Error("pending setup failed");
    return { contentId: id, requestId: result.publicId };
  }

  it("approve moves the request to approved and the content to live, audited once", async () => {
    const { contentId, requestId } = await pending();
    const before = await audits();
    expect(await decideRequest(db, auditKey, admin.publicId, requestId, { approve: true })).toEqual({ ok: true });
    expect(await statusOf(contentId)).toBe("live");
    expect(await requestStatus(requestId)).toBe("approved");
    expect(await auditActions(requestId)).toEqual(["approvals.request.created", "approvals.request.approved"]);
    expect(await audits()).toBe(before + 1);
  });

  it("decline (with a reason) moves the request to declined and the content back to draft", async () => {
    const { contentId, requestId } = await pending();
    expect(await decideRequest(db, auditKey, admin.publicId, requestId, { approve: false, reason: "Not ready yet" })).toEqual({ ok: true });
    expect(await statusOf(contentId)).toBe("draft");
    expect(await requestStatus(requestId)).toBe("declined");
    const row = await db.prepare("SELECT decision_reason FROM approval_requests WHERE public_id = ?1").bind(requestId).first<{ decision_reason: string }>();
    expect(row!.decision_reason).toBe("Not ready yet");
  });

  it("a decline needs a non-empty reason", async () => {
    const { requestId } = await pending();
    expect(await decideRequest(db, auditKey, admin.publicId, requestId, { approve: false, reason: "  " })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("the requester may not decide their own request, and the content is untouched", async () => {
    const { contentId, requestId } = await pending();
    expect(await decideRequest(db, auditKey, coordinator.publicId, requestId, { approve: true })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await statusOf(contentId)).toBe("waiting");
  });

  it("a Co-ordinator, Accountant, Teacher and Student may not decide, and the content is untouched", async () => {
    for (const who of [coordinator2, accountant, teacher, student]) {
      const { contentId, requestId } = await pending();
      expect(await decideRequest(db, auditKey, who.publicId, requestId, { approve: true })).toEqual({ ok: false, reason: "not_allowed" });
      expect(await statusOf(contentId)).toBe("waiting"); // not flipped to live by a disallowed decide attempt
    }
  });

  it("a second decide on an already-resolved request changes nothing", async () => {
    const { requestId } = await pending();
    expect(await decideRequest(db, auditKey, admin.publicId, requestId, { approve: true })).toEqual({ ok: true });
    expect(await decideRequest(db, auditKey, admin2.publicId, requestId, { approve: true })).toEqual({ ok: false, reason: "conflict" });
    expect(await decideRequest(db, auditKey, admin2.publicId, requestId, { approve: false, reason: "too late" })).toEqual({ ok: false, reason: "conflict" });
  });

  it("a changed subject goes stale, and the content is untouched", async () => {
    const { contentId, requestId } = await pending();
    await updateContent(db, auditKey, admin.publicId, contentId, { title: "Edited while pending" });
    expect(await decideRequest(db, auditKey, admin.publicId, requestId, { approve: true })).toEqual({ ok: false, reason: "stale" });
    expect(await requestStatus(requestId)).toBe("stale");
    expect(await statusOf(contentId)).toBe("waiting"); // untouched: still waiting, not live
  });

  it("a stale request cannot later be approved", async () => {
    const { contentId, requestId } = await pending();
    await updateContent(db, auditKey, admin.publicId, contentId, { title: "Edited" });
    await decideRequest(db, auditKey, admin.publicId, requestId, { approve: true }); // marks it stale
    expect(await decideRequest(db, auditKey, admin2.publicId, requestId, { approve: true })).toEqual({ ok: false, reason: "conflict" });
  });

  it("the Super Admin may also decide", async () => {
    const { contentId, requestId } = await pending();
    expect(await decideRequest(db, auditKey, superAdmin.publicId, requestId, { approve: true })).toEqual({ ok: true });
    expect(await statusOf(contentId)).toBe("live");
  });
});

// ---------------------------------------------------------------------------------------------
describe("withdrawRequest", () => {
  it("the requester takes back their own pending request; the item returns to draft", async () => {
    const id = await draft();
    const sent = await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id });
    if (!sent.ok) throw new Error("setup failed");
    expect(await withdrawRequest(db, auditKey, coordinator.publicId, sent.publicId)).toEqual({ ok: true });
    expect(await statusOf(id)).toBe("draft");
    expect(await requestStatus(sent.publicId)).toBe("withdrawn");
  });

  it("someone else, even an Admin, may not withdraw another person's request", async () => {
    const id = await draft();
    const sent = await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id });
    if (!sent.ok) throw new Error("setup failed");
    expect(await withdrawRequest(db, auditKey, admin.publicId, sent.publicId)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await requestStatus(sent.publicId)).toBe("pending");
  });

  it("withdrawing an already-resolved request is a no-op", async () => {
    const id = await draft();
    const sent = await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: id });
    if (!sent.ok) throw new Error("setup failed");
    await decideRequest(db, auditKey, admin.publicId, sent.publicId, { approve: true });
    expect(await withdrawRequest(db, auditKey, coordinator.publicId, sent.publicId)).toEqual({ ok: true });
    expect(await requestStatus(sent.publicId)).toBe("approved"); // unchanged
  });
});

it("the audit chain verifies after the whole run", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
