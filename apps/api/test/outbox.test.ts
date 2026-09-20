import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { drainOutbox, enqueue, enqueueIf, MAX_ATTEMPTS, type Handler } from "../src/core/jobs";

const db = env.DB;
const key = env.DATA_KEY;
const T0 = new Date("2026-09-21T10:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const row = (type: string) =>
  db.prepare("SELECT * FROM outbox_events WHERE type = ?1 ORDER BY id DESC LIMIT 1").bind(type).first<Record<string, string | null>>();
const count = async (sql: string, ...params: unknown[]) => (await db.prepare(sql).bind(...params).first<{ n: number }>())!.n;

/** Clears the outbox between tests so each starts with only its own events. */
async function reset() {
  await db.prepare("DELETE FROM outbox_events").run();
}

describe("enqueue", () => {
  it("rides in the same batch as the change that needs it: both happen, or neither", async () => {
    await reset();
    await db.batch([db.prepare("INSERT INTO sections (key, name) VALUES ('outbox-ok', 'x')"), await enqueue(db, { type: "t.atomic", payload: { a: 1 }, at: T0 })]);
    expect(await count("SELECT COUNT(*) AS n FROM outbox_events WHERE type = 't.atomic'")).toBe(1);

    await expect(
      db.batch([db.prepare("INSERT INTO sections (key, name) VALUES (NULL, 'invalid')"), await enqueue(db, { type: "t.atomic2", payload: {}, at: T0 })]),
    ).rejects.toThrow();
    expect(await count("SELECT COUNT(*) AS n FROM outbox_events WHERE type = 't.atomic2'")).toBe(0);
  });

  it("stores the payload, and is due straight away", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.plain", payload: { hello: "world" }, at: T0 })]);
    const stored = await row("t.plain");
    expect(JSON.parse(stored!.payload_json!)).toEqual({ hello: "world" });
    expect(stored!.next_attempt_at).toBe(T0.toISOString());
    expect(stored!.processed_at).toBeNull();
  });

  it("the same key can never be queued twice", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.dup", payload: {}, dedupeKey: "dup:1", at: T0 })]);
    await expect(db.batch([await enqueue(db, { type: "t.dup", payload: {}, dedupeKey: "dup:1", at: T0 })])).rejects.toThrow(/UNIQUE/);
    expect(await count("SELECT COUNT(*) AS n FROM outbox_events WHERE dedupe_key = 'dup:1'")).toBe(1);
  });

  it("a sealed payload cannot be read from the database, but reaches the handler intact", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.sealed", payload: { token: "SUPER-SECRET-TOKEN-123" }, sealKey: key, at: T0 })]);
    expect((await row("t.sealed"))!.payload_json!).not.toContain("SUPER-SECRET-TOKEN-123");

    const seen = vi.fn();
    await drainOutbox(db, { "t.sealed": async (payload) => void seen(payload) }, { sealKey: key, now: T0 });
    expect(seen).toHaveBeenCalledWith({ token: "SUPER-SECRET-TOKEN-123" });
  });

  it("enqueueIf queues only when the condition holds", async () => {
    await reset();
    await db.batch([
      await enqueueIf(db, { type: "t.if", payload: {}, dedupeKey: "if:yes", at: T0 }, "SELECT 1 FROM sections WHERE key = ?5", "outbox-ok"),
      await enqueueIf(db, { type: "t.if", payload: {}, dedupeKey: "if:no", at: T0 }, "SELECT 1 FROM sections WHERE key = ?5", "no-such-section"),
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM outbox_events WHERE dedupe_key IN ('if:yes', 'if:no')")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM outbox_events WHERE dedupe_key = 'if:yes'")).toBe(1);
  });
});

describe("drainOutbox", () => {
  it("runs the handler once, marks the event done and wipes its payload", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.ok", payload: { n: 7 }, at: T0 })]);
    const handler = vi.fn<Handler>(async () => {});

    const result = await drainOutbox(db, { "t.ok": handler }, { sealKey: key, now: T0 });
    await drainOutbox(db, { "t.ok": handler }, { sealKey: key, now: minutes(10) }); // nothing left to do

    expect(result).toMatchObject({ processed: 1, failed: 0, dead: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
    const done = await row("t.ok");
    expect(done!.processed_at).toBe(T0.toISOString());
    expect(done!.payload_json).toBe("{}");
    expect(done!.attempts).toBe(1);
  });

  it("a failure is recorded and retried later with growing delays, not straight away", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.flaky", payload: {}, at: T0 })]);
    let calls = 0;
    const flaky: Handler = async () => {
      if (++calls < 3) throw new Error("provider down");
    };
    const handlers = { "t.flaky": flaky };

    expect(await drainOutbox(db, handlers, { sealKey: key, now: T0 })).toMatchObject({ processed: 0, failed: 1 });
    const first = await row("t.flaky");
    expect(first!.last_error).toContain("provider down");
    expect(first!.next_attempt_at).toBe(minutes(1).toISOString());
    expect(first!.processed_at).toBeNull();

    // Too early: nothing happens.
    expect(await drainOutbox(db, handlers, { sealKey: key, now: minutes(0.5) })).toMatchObject({ processed: 0, failed: 0 });
    expect(calls).toBe(1);

    // Second try fails, and waits longer.
    expect(await drainOutbox(db, handlers, { sealKey: key, now: minutes(1) })).toMatchObject({ failed: 1 });
    expect((await row("t.flaky"))!.next_attempt_at).toBe(minutes(6).toISOString()); // 1 + 5 minutes

    // Third try succeeds.
    expect(await drainOutbox(db, handlers, { sealKey: key, now: minutes(6) })).toMatchObject({ processed: 1 });
    expect((await row("t.flaky"))!.processed_at).not.toBeNull();
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt, wipes the payload, and never retries", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.doomed", payload: { secret: "x" }, at: T0 })]);
    const handler = vi.fn<Handler>(async () => {
      throw new Error("always fails");
    });

    let now = T0;
    let last;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = await drainOutbox(db, { "t.doomed": handler }, { sealKey: key, now });
      now = new Date(now.getTime() + 24 * 60 * 60_000); // a day later: always due
    }
    expect(last).toMatchObject({ dead: 1 });
    expect(handler).toHaveBeenCalledTimes(MAX_ATTEMPTS);

    const dead = await row("t.doomed");
    expect(dead!.dead_at).not.toBeNull();
    expect(dead!.payload_json).toBe("{}");
    expect(dead!.last_error).toContain("always fails");

    await drainOutbox(db, { "t.doomed": handler }, { sealKey: key, now });
    expect(handler).toHaveBeenCalledTimes(MAX_ATTEMPTS); // untouched
  });

  it("an event nobody handles fails visibly instead of vanishing", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.orphan", payload: {}, at: T0 })]);
    expect(await drainOutbox(db, {}, { sealKey: key, now: T0 })).toMatchObject({ failed: 1 });
    expect((await row("t.orphan"))!.last_error).toMatch(/no handler/i);
  });

  it("a payload that cannot be opened fails, and the handler never sees garbage", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.badseal", payload: { a: 1 }, sealKey: "another-key-0123456789abcdef0123456789abcdef", at: T0 })]);
    const handler = vi.fn<Handler>(async () => {});
    expect(await drainOutbox(db, { "t.badseal": handler }, { sealKey: key, now: T0 })).toMatchObject({ failed: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("two runners at once handle each event exactly once", async () => {
    await reset();
    await db.batch(await Promise.all(Array.from({ length: 8 }, (_, i) => enqueue(db, { type: "t.race", payload: { i }, at: T0 }))));
    const seen: number[] = [];
    const handler: Handler = async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push((payload as { i: number }).i);
    };

    const [a, b] = await Promise.all([
      drainOutbox(db, { "t.race": handler }, { sealKey: key, now: T0 }),
      drainOutbox(db, { "t.race": handler }, { sealKey: key, now: T0 }),
    ]);

    expect(a.processed + b.processed).toBe(8);
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // each exactly once
  });

  it("an event a crashed runner was holding is left alone until its lease runs out, then retried", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.lease", payload: {}, at: T0 })]);
    await db.prepare("UPDATE outbox_events SET claimed_until = ?1, attempts = 1 WHERE type = 't.lease'").bind(minutes(2).toISOString()).run();
    const handler = vi.fn<Handler>(async () => {});

    await drainOutbox(db, { "t.lease": handler }, { sealKey: key, now: minutes(1) });
    expect(handler).not.toHaveBeenCalled(); // still leased

    await drainOutbox(db, { "t.lease": handler }, { sealKey: key, now: minutes(3) });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handles a limited number per run, oldest first", async () => {
    await reset();
    await db.batch(await Promise.all(Array.from({ length: 5 }, (_, i) => enqueue(db, { type: "t.limit", payload: { i }, at: T0 }))));
    const seen: number[] = [];
    const result = await drainOutbox(db, { "t.limit": async (p) => void seen.push((p as { i: number }).i) }, { sealKey: key, now: T0, limit: 2 });
    expect(result.processed).toBe(2);
    expect(seen).toEqual([0, 1]);
  });

  it("truncates a huge error message so the log cannot be flooded", async () => {
    await reset();
    await db.batch([await enqueue(db, { type: "t.loud", payload: {}, at: T0 })]);
    await drainOutbox(db, { "t.loud": async () => { throw new Error("x".repeat(5000)); } }, { sealKey: key, now: T0 });
    expect((await row("t.loud"))!.last_error!.length).toBeLessThanOrEqual(500);
  });
});
