import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { GENESIS_HASH, hashEvent, recordAudit, verifyAuditChain } from "../src/core/audit";

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;

const event = (n: number) => ({
  action: "test.happened",
  entityType: "thing",
  entityPublicId: `thing-${n}`,
  summary: `Thing ${n} happened`,
});

describe("audit chain: appending", () => {
  it("an empty log verifies", async () => {
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true });
  });

  it("each entry links to the previous one, starting from the genesis hash", async () => {
    await recordAudit(db, key, event(1));
    await recordAudit(db, key, event(2));
    await recordAudit(db, key, event(3));

    const { results } = await db
      .prepare("SELECT prev_hash, hash FROM audit_events ORDER BY id")
      .all<{ prev_hash: string; hash: string }>();

    expect(results[0]!.prev_hash).toBe(GENESIS_HASH);
    results.slice(1).forEach((row, i) => expect(row.prev_hash).toBe(results[i]!.hash));
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true, count: results.length });
  });

  it("stores who did what, with before, after and the reason", async () => {
    const before = await db.prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES ('p-audit', 'audit@example.test', 'x', 'A')").run();
    await recordAudit(db, key, {
      action: "fees.discount.approved",
      entityType: "discount",
      entityPublicId: "d-1",
      summary: "Discount approved",
      actorUserId: before.meta.last_row_id,
      before: { status: "pending" },
      after: { status: "approved" },
      reason: "Sibling",
      requestId: "req-1",
    });

    const row = await db
      .prepare("SELECT * FROM audit_events WHERE entity_public_id = 'd-1'")
      .first<Record<string, unknown>>();

    expect(row).toMatchObject({
      action: "fees.discount.approved",
      actor_user_id: before.meta.last_row_id,
      before_json: '{"status":"pending"}',
      after_json: '{"status":"approved"}',
      reason: "Sibling",
      request_id: "req-1",
    });
    expect(row!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses an actor that does not exist", async () => {
    await expect(recordAudit(db, key, { ...event(9), actorUserId: 999_999_999 })).rejects.toThrow();
  });

  it("can name the actor by public id, resolved in the same round trip as the chain head", async () => {
    await db.prepare("INSERT INTO users (id, public_id, email, password_hash, full_name) VALUES (777, 'pub-actor-777', 'actor777@example.test', 'x', 'A')").run();
    await recordAudit(db, key, { ...event(70), actorPublicId: "pub-actor-777" });

    const row = await db.prepare("SELECT actor_user_id FROM audit_events WHERE entity_public_id = 'thing-70'").first<{ actor_user_id: number }>();
    expect(row!.actor_user_id).toBe(777);
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true });
  });

  it("refuses an actor public id that does not exist, and saves neither the entry nor the change", async () => {
    const before = await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>();
    await expect(
      recordAudit(db, key, { ...event(71), actorPublicId: "nobody" }, [db.prepare("INSERT INTO sections (key, name) VALUES ('ghost-actor', 'x')")]),
    ).rejects.toThrow(/actor that does not exist/);

    const after = await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>();
    const section = await db.prepare("SELECT COUNT(*) AS n FROM sections WHERE key = 'ghost-actor'").first<{ n: number }>();
    expect([after!.n, section!.n]).toEqual([before!.n, 0]);
  });

  it("the chain head always points at the newest entry", async () => {
    const { hash } = await recordAudit(db, key, event(4));
    const head = await db.prepare("SELECT last_hash FROM audit_chain_head").first<{ last_hash: string }>();
    expect(head!.last_hash).toBe(hash);
  });
});

describe("audit chain: the hash covers everything and needs the secret", () => {
  const base = { at: "2026-09-20T10:00:00.000Z", ...event(1) };

  it("is the same for the same input", async () => {
    expect(await hashEvent(key, GENESIS_HASH, base)).toBe(await hashEvent(key, GENESIS_HASH, base));
  });

  it.each([
    ["action", { action: "other.action" }],
    ["entityType", { entityType: "other" }],
    ["entityPublicId", { entityPublicId: "other" }],
    ["summary", { summary: "other" }],
    ["actorUserId", { actorUserId: 7 }],
    ["before", { before: { a: 1 } }],
    ["after", { after: { a: 1 } }],
    ["reason", { reason: "other" }],
    ["requestId", { requestId: "other" }],
    ["at", { at: "2026-09-20T10:00:00.001Z" }],
  ])("changes when %s changes", async (_field, change) => {
    expect(await hashEvent(key, GENESIS_HASH, { ...base, ...change })).not.toBe(await hashEvent(key, GENESIS_HASH, base));
  });

  it("changes when the previous hash changes", async () => {
    expect(await hashEvent(key, "1".repeat(64), base)).not.toBe(await hashEvent(key, GENESIS_HASH, base));
  });

  it("cannot be reproduced without the secret key", async () => {
    expect(await hashEvent("a-different-secret", GENESIS_HASH, base)).not.toBe(await hashEvent(key, GENESIS_HASH, base));
  });
});

describe("audit chain: guards in the database", () => {
  it("refuses to edit an entry", async () => {
    await recordAudit(db, key, event(5));
    await expect(db.prepare("UPDATE audit_events SET summary = 'changed' WHERE id = 1").run()).rejects.toThrow(/append-only/);
  });

  it("refuses to delete an entry", async () => {
    await expect(db.prepare("DELETE FROM audit_events WHERE id = 1").run()).rejects.toThrow(/append-only/);
  });

  it("refuses an entry that does not link to the current head, and rolls back what rode with it", async () => {
    const wrongLink = db
      .prepare(
        "INSERT INTO audit_events (at, action, entity_type, summary, prev_hash, hash) VALUES ('2026-01-01T00:00:00Z', 'x', 'x', 'x', ?1, ?2)",
      )
      .bind("f".repeat(64), "e".repeat(64));
    const businessChange = db.prepare("INSERT INTO sections (key, name) VALUES ('rolled-back', 'Should not exist')");

    await expect(db.batch([businessChange, wrongLink])).rejects.toThrow(/audit chain moved/);

    const leftover = await db.prepare("SELECT COUNT(*) AS n FROM sections WHERE key = 'rolled-back'").first<{ n: number }>();
    expect(leftover!.n).toBe(0);
  });
});

describe("audit chain: business change and audit entry are one atomic batch", () => {
  it("both are saved together", async () => {
    await recordAudit(db, key, event(6), [db.prepare("INSERT INTO sections (key, name) VALUES ('with-audit', 'Saved together')")]);

    const section = await db.prepare("SELECT COUNT(*) AS n FROM sections WHERE key = 'with-audit'").first<{ n: number }>();
    const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_public_id = 'thing-6'").first<{ n: number }>();
    expect([section!.n, audit!.n]).toEqual([1, 1]);
  });

  it("neither is saved if the business change fails", async () => {
    const before = await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>();

    await expect(
      recordAudit(db, key, event(7), [db.prepare("INSERT INTO sections (key, name) VALUES (NULL, 'invalid')")]),
    ).rejects.toThrow();

    const after = await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});

describe("audit chain: many writers at once", () => {
  it("25 simultaneous entries all succeed, and the chain has no fork or gap", async () => {
    const before = await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>();

    await Promise.all(Array.from({ length: 25 }, (_, i) => recordAudit(db, key, event(100 + i))));

    const after = await db.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>();
    expect(after!.n - before!.n).toBe(25);
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true, count: after!.n });
  });
});
