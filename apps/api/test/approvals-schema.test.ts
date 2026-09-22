import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.DB;
let counter = 0;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;
const at = "2026-09-22T00:00:00.000Z";

async function addUser(): Promise<number> {
  const publicId = uniq("u");
  const result = await db.prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, 'hash', 'Person')").bind(publicId, `${publicId}@school.example`).run();
  return result.meta.last_row_id;
}

async function addContentItem(): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO content_items (public_id, kind, title, body, is_urgent, status, publish_on, created_by, created_at, updated_at)
       VALUES (?1, 'notice', 'Title', 'Body', 0, 'draft', '2026-09-22', ?2, ?3, ?3)`,
    )
    .bind(uniq("c"), await addUser(), at)
    .run();
  return result.meta.last_row_id;
}

const addRequest = (
  subjectId: number,
  requestedBy: number,
  over: Partial<{ status: string; decidedBy: number | null; decidedAt: string | null; decisionReason: string | null; version: number }> = {},
) =>
  db
    .prepare(
      `INSERT INTO approval_requests (public_id, kind, status, requested_by, subject_type, subject_id, subject_public_id, summary, subject_version, snapshot, decided_by, decided_at, decision_reason, created_at)
       VALUES (?1, 'website_content', ?2, ?3, 'website_content', ?4, ?1, 'A test subject', ?5, '{}', ?6, ?7, ?8, ?9)`,
    )
    .bind(
      uniq("ar"),
      over.status ?? "pending",
      requestedBy,
      subjectId,
      over.version ?? 1,
      over.decidedBy !== undefined ? over.decidedBy : null,
      over.decidedAt !== undefined ? over.decidedAt : null,
      over.decisionReason !== undefined ? over.decisionReason : null,
      at,
    )
    .run();

// ---------------------------------------------------------------------------------------------
describe("approval_requests", () => {
  it("allows only one pending request per subject, but another after the first is resolved", async () => {
    const subjectId = await addContentItem();
    const requester = await addUser();
    await addRequest(subjectId, requester);
    await expect(addRequest(subjectId, requester)).rejects.toThrow(/UNIQUE/);

    await db.prepare("UPDATE approval_requests SET status = 'withdrawn' WHERE subject_id = ?1").bind(subjectId).run();
    await addRequest(subjectId, requester); // succeeds: no pending row remains
  });

  it("refuses an unknown kind or status", async () => {
    const subjectId = await addContentItem();
    const requester = await addUser();
    await expect(
      db
        .prepare(
          `INSERT INTO approval_requests (public_id, kind, status, requested_by, subject_type, subject_id, subject_public_id, summary, subject_version, snapshot, created_at)
           VALUES (?1, 'nonsense', 'pending', ?2, 'website_content', ?3, ?1, 'Test', 1, '{}', ?4)`,
        )
        .bind(uniq("ar"), requester, subjectId, at)
        .run(),
    ).rejects.toThrow(/CHECK/);
    await expect(
      db
        .prepare(
          `INSERT INTO approval_requests (public_id, kind, status, requested_by, subject_type, subject_id, subject_public_id, summary, subject_version, snapshot, created_at)
           VALUES (?1, 'website_content', 'nonsense', ?2, 'website_content', ?3, ?1, 'Test', 1, '{}', ?4)`,
        )
        .bind(uniq("ar"), requester, subjectId, at)
        .run(),
    ).rejects.toThrow(/CHECK/);
  });

  it("an approved or declined row must have both decided_by and decided_at set together", async () => {
    const subjectId = await addContentItem();
    const requester = await addUser();
    const decider = await addUser();
    await expect(addRequest(subjectId, requester, { status: "approved", decidedBy: null, decidedAt: null })).rejects.toThrow(/CHECK/);
    await expect(addRequest(subjectId, requester, { status: "approved", decidedBy: decider, decidedAt: null })).rejects.toThrow(/CHECK/);
    await addRequest(subjectId, requester, { status: "approved", decidedBy: decider, decidedAt: at });
  });

  it("a declined row needs a reason", async () => {
    const subjectId = await addContentItem();
    const requester = await addUser();
    const decider = await addUser();
    await expect(addRequest(subjectId, requester, { status: "declined", decidedBy: decider, decidedAt: at, decisionReason: null })).rejects.toThrow(/CHECK/);
    await addRequest(subjectId, requester, { status: "declined", decidedBy: decider, decidedAt: at, decisionReason: "Not ready" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("content_items.version", () => {
  it("defaults to 1", async () => {
    const id = await addContentItem();
    expect((await db.prepare("SELECT version FROM content_items WHERE id = ?1").bind(id).first<{ version: number }>())!.version).toBe(1);
  });
});
