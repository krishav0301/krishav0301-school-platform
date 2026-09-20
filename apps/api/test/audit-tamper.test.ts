import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GENESIS_HASH,
  auditChainSummary,
  checkAgainstExport,
  hashEvent,
  recordAudit,
  verifyAuditChain,
} from "../src/core/audit";

// A separate database, because these tests deliberately break the audit log's guards.
const db = env.SCRATCH_DB;
const key = env.AUDIT_HMAC_KEY;

type Trigger = { name: string; sql: string };
let migratedTriggers: Trigger[] | null = null;

/**
 * Wipes the scratch audit log, including its guards, then puts the guards back exactly as
 * migrated. The guard definitions are captured once, on the first call, before any test has
 * removed them: reading them again later would find nothing to restore.
 */
async function resetLog(): Promise<void> {
  const triggers: Trigger[] = (migratedTriggers ??= (
    await db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_events' ORDER BY name")
      .all<Trigger>()
  ).results);
  expect(triggers.length, "the migration should define the audit guards").toBe(4);

  // Drop whichever guards currently exist (a previous test may have removed some or all).
  const { results: present } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_events'")
    .all<{ name: string }>();
  await db.batch([
    ...present.map((t) => db.prepare(`DROP TRIGGER ${t.name}`)),
    db.prepare("DELETE FROM audit_events"),
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'audit_events'"),
    db.prepare("UPDATE audit_chain_head SET last_id = 0, last_hash = ?1 WHERE id = 1").bind(GENESIS_HASH),
    ...triggers.map((t) => db.prepare(t.sql)),
  ]);
}

async function writeFiveEvents(): Promise<void> {
  for (let i = 1; i <= 5; i++) {
    await recordAudit(db, key, { action: "test.event", entityType: "thing", summary: `Event ${i}` });
  }
}

/** What a careless or malicious insider with database access could do: remove the guards. */
async function removeGuards(): Promise<void> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_events'")
    .all<{ name: string }>();
  await db.batch(results.map((t) => db.prepare(`DROP TRIGGER ${t.name}`)));
}

beforeEach(resetLog);

describe("tampering is detected even after the guards are removed", () => {
  it("baseline: five entries verify", async () => {
    await writeFiveEvents();
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true, count: 5 });
  });

  it("an edited entry is found, and the report names it", async () => {
    await writeFiveEvents();
    await removeGuards();
    await db.prepare("UPDATE audit_events SET summary = 'Event 3 (edited)' WHERE id = 3").run();

    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: false, brokenAtId: 3, reason: "hash mismatch" });
  });

  it("a deleted entry in the middle is found", async () => {
    await writeFiveEvents();
    await removeGuards();
    await db.prepare("DELETE FROM audit_events WHERE id = 3").run();

    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: false, brokenAtId: 4, reason: "link broken" });
  });

  it("an inserted entry in the middle is found", async () => {
    await writeFiveEvents();
    await removeGuards();
    await db
      .prepare(
        "INSERT INTO audit_events (id, at, action, entity_type, summary, prev_hash, hash) VALUES (99, '2026-01-01T00:00:00Z', 'forged', 'x', 'forged', ?1, ?2)",
      )
      .bind("a".repeat(64), "b".repeat(64))
      .run();

    expect((await verifyAuditChain(db, key)).ok).toBe(false);
  });

  it("an entry whose head pointer was tampered with is found", async () => {
    await writeFiveEvents();
    await removeGuards();
    await db.prepare("UPDATE audit_chain_head SET last_hash = ?1").bind("c".repeat(64)).run();

    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: false, reason: "head does not match the last entry" });
  });

  it("rewriting the whole chain WITHOUT the secret key is found", async () => {
    await writeFiveEvents();
    await removeGuards();
    // The attacker edits entry 3 and recomputes every later hash, but does not have the key.
    await db.prepare("UPDATE audit_events SET summary = 'Event 3 (edited)' WHERE id = 3").run();
    const { results } = await db
      .prepare("SELECT * FROM audit_events ORDER BY id")
      .all<{ id: number; at: string; action: string; entity_type: string; summary: string; prev_hash: string }>();
    let prev = GENESIS_HASH;
    for (const row of results) {
      const forged = await hashEvent("attacker-guess", prev, {
        at: row.at,
        action: row.action,
        entityType: row.entity_type,
        summary: row.summary,
      });
      await db.prepare("UPDATE audit_events SET prev_hash = ?1, hash = ?2 WHERE id = ?3").bind(prev, forged, row.id).run();
      prev = forged;
    }
    await db.prepare("UPDATE audit_chain_head SET last_id = 5, last_hash = ?1").bind(prev).run();

    expect((await verifyAuditChain(db, key)).ok).toBe(false);
  });
});

describe("known limit: deleting the newest entries", () => {
  it("cannot be seen inside the database once the head is rewritten, but the daily export catches it", async () => {
    await writeFiveEvents();
    const exported = await auditChainSummary(db); // what the daily export stored elsewhere

    await removeGuards();
    await db.prepare("DELETE FROM audit_events WHERE id IN (4, 5)").run();
    const survivor = await db.prepare("SELECT id, hash FROM audit_events ORDER BY id DESC LIMIT 1").first<{ id: number; hash: string }>();
    await db.prepare("UPDATE audit_chain_head SET last_id = ?1, last_hash = ?2").bind(survivor!.id, survivor!.hash).run();

    // Inside the database everything looks consistent...
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true, count: 3 });
    // ...but the exported record proves entries were removed.
    expect(await checkAgainstExport(db, key, exported)).toMatchObject({ ok: false, reason: "entries were removed since the export" });
  });

  it("an untouched log passes the export check, and stays valid as it grows", async () => {
    await writeFiveEvents();
    const exported = await auditChainSummary(db);
    await recordAudit(db, key, { action: "test.event", entityType: "thing", summary: "Event 6" });

    expect(await checkAgainstExport(db, key, exported)).toMatchObject({ ok: true });
  });

  it("an edited entry that the export already recorded is found", async () => {
    await writeFiveEvents();
    const exported = await auditChainSummary(db);
    await removeGuards();
    await db.prepare("UPDATE audit_events SET summary = 'edited' WHERE id = 5").run();

    expect((await checkAgainstExport(db, key, exported)).ok).toBe(false);
  });
});
