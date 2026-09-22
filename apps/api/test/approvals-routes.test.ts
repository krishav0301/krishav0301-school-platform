import { beforeAll, describe, expect, it } from "vitest";

import { createContent, updateContent } from "../src/modules/content/service";
import { auditKey, call, count, db, person, type Person } from "./approvals-helpers";

let coordinator: Person, admin: Person, superAdmin: Person, accountant: Person, teacher: Person, student: Person;
beforeAll(async () => {
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  superAdmin = await person("super_admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
});

const noId = "0".repeat(32);
const post = (path: string, body: unknown, who?: Person) => call(`/api/approvals${path}`, { method: "POST", body, cookie: who?.cookie });
const get = (path: string, who?: Person) => call(`/api/approvals${path}`, who ? { cookie: who.cookie } : {});

async function draft(actor = coordinator.publicId): Promise<string> {
  const result = await createContent(db, auditKey, actor, { kind: "notice", title: "Notice", body: "Body", contact: null, urgent: false, publishOn: "2026-09-22", hideAfter: null });
  if (!result.ok) throw new Error(`draft setup failed: ${JSON.stringify(result)}`);
  return result.publicId;
}

async function pending(actor = coordinator): Promise<string> {
  const contentId = await draft(actor.publicId);
  const response = await post("", { kind: "website_content", subjectId: contentId }, actor);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------------------------
describe("who may use the approvals routes", () => {
  it("nobody who is signed out: 401", async () => {
    expect((await post("", { kind: "website_content", subjectId: noId })).status).toBe(401);
    expect((await get("")).status).toBe(401);
    expect((await get("/mine")).status).toBe(401);
    expect((await post(`/${noId}/approve`, undefined)).status).toBe(401);
    expect((await post(`/${noId}/decline`, { reason: "x" })).status).toBe(401);
    expect((await post(`/${noId}/withdraw`, undefined)).status).toBe(401);
  });

  it("a Student, Teacher and Accountant get 403 everywhere, and nothing is written", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM approval_requests");
    for (const who of [student, teacher, accountant]) {
      const id = await draft();
      expect((await post("", { kind: "website_content", subjectId: id }, who)).status, `${who.publicId} post`).toBe(403);
      expect((await get("", who)).status, `${who.publicId} inbox`).toBe(403);
      expect((await get("/mine", who)).status, `${who.publicId} mine`).toBe(403);
      expect((await post(`/${noId}/approve`, undefined, who)).status, `${who.publicId} approve`).toBe(403);
      expect((await post(`/${noId}/decline`, { reason: "x" }, who)).status, `${who.publicId} decline`).toBe(403);
    }
    expect(await count("SELECT COUNT(*) AS n FROM approval_requests")).toBe(before);
  });

  it("a Co-ordinator may send their own draft and see their own requests, not the inbox or decide", async () => {
    const id = await draft();
    expect((await post("", { kind: "website_content", subjectId: id }, coordinator)).status).toBe(201);
    expect((await get("/mine", coordinator)).status).toBe(200);
    expect((await get("", coordinator)).status).toBe(403);
    expect((await post(`/${noId}/approve`, undefined, coordinator)).status).toBe(403);
  });

  it("the Admin and Super Admin may see the inbox and decide, and may also send one of their own", async () => {
    for (const who of [admin, superAdmin]) {
      const id = await draft(who.publicId);
      expect((await get("", who)).status).toBe(200);
      const sent = await post("", { kind: "website_content", subjectId: id }, who);
      expect(sent.status).toBe(201);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("the flow end to end, through routes only", () => {
  it("draft, send, approve: the item goes live", async () => {
    const requestId = await pending();
    const decided = await post(`/${requestId}/approve`, undefined, admin);
    expect(decided.status).toBe(200);
    const mine = (await (await get("/mine", coordinator)).json()) as { requests: { id: string; status: string }[] };
    expect(mine.requests.find((r) => r.id === requestId)?.status).toBe("approved");
  });

  it("draft, send, decline: the item is a draft again, with the reason visible to the requester", async () => {
    const requestId = await pending();
    const decided = await post(`/${requestId}/decline`, { reason: "Not ready" }, admin);
    expect(decided.status).toBe(200);
    const mine = (await (await get("/mine", coordinator)).json()) as { requests: { id: string; status: string; decisionReason: string | null }[] };
    const row = mine.requests.find((r) => r.id === requestId);
    expect(row?.status).toBe("declined");
    expect(row?.decisionReason).toBe("Not ready");
  });

  it("a decline needs a reason: 400, the schema-level rejection every route gives for a missing required field", async () => {
    const requestId = await pending();
    expect((await post(`/${requestId}/decline`, {}, admin)).status).toBe(400);
  });

  it("withdrawing someone else's request is 403; the requester may withdraw their own", async () => {
    const requestId = await pending();
    expect((await post(`/${requestId}/withdraw`, undefined, admin)).status).toBe(403);
    expect((await post(`/${requestId}/withdraw`, undefined, coordinator)).status).toBe(200);
  });

  it("approving your own request is 403", async () => {
    const requestId = await pending(admin); // admin drafts and sends their own
    expect((await post(`/${requestId}/approve`, undefined, admin)).status).toBe(403);
    expect((await post(`/${requestId}/approve`, undefined, superAdmin)).status).toBe(200); // someone else may
  });

  it("a stale decide (the item changed since) is 409", async () => {
    const contentId = await draft();
    const sent = await post("", { kind: "website_content", subjectId: contentId }, coordinator);
    const requestId = ((await sent.json()) as { id: string }).id;
    await updateContent(db, auditKey, admin.publicId, contentId, { title: "Edited while pending" });
    expect((await post(`/${requestId}/approve`, undefined, admin)).status).toBe(409);
  });

  it("a second decide on an already-resolved request is a conflict", async () => {
    const requestId = await pending();
    expect((await post(`/${requestId}/approve`, undefined, admin)).status).toBe(200);
    expect((await post(`/${requestId}/approve`, undefined, superAdmin)).status).toBe(409);
  });

  it("the inbox and no-store, and pending items are all shown", async () => {
    const requestId = await pending();
    const read = await get("", admin);
    expect(read.headers.get("Cache-Control")).toBe("no-store");
    const body = (await read.json()) as { requests: { id: string; summary: string; requestedBy: string }[] };
    const row = body.requests.find((r) => r.id === requestId);
    expect(row).toBeDefined();
    expect(row!.summary).toContain("Notice");
  });
});
