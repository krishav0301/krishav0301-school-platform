import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { drainOutbox } from "../src/core/jobs";
import { queueEmail, notificationHandlers, renderEmail, runOutbox } from "../src/core/notifications";
import { applyPack, parsePack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";

const db = env.DB;
const base = { schoolName: "Royal Softech College", siteOrigin: "https://royal.example" };
const mailbox = async (key: string) => (await db.prepare("SELECT * FROM dev_mailbox WHERE idempotency_key = ?1").bind(key).first<Record<string, string>>()) ?? null;

describe("renderEmail", () => {
  const rendered = renderEmail({ template: "password_reset", to: "sita@school.example", data: { token: "TOKEN123" } }, base);

  it("names the school in the subject, and gives a link that works once", () => {
    expect(rendered.subject).toBe("Reset your password for Royal Softech College");
    expect(rendered.body).toContain("https://royal.example/reset-password#token=TOKEN123");
    expect(rendered.body).toContain("works once");
    expect(rendered.body).toContain("expires in 1 hour");
  });

  it("puts the token after a #, so it is never sent to a server or written to a request log", () => {
    expect(rendered.body).not.toMatch(/reset-password\?/);
    expect(rendered.body).toMatch(/reset-password#token=/);
  });

  it("tells someone who did not ask that nothing will change, and is short and plain", () => {
    expect(rendered.body).toContain("If you did not ask for this");
    expect(rendered.body).toContain("Your password will not change");
    expect(rendered.body.length).toBeLessThan(600);
  });

  it("a site address with a trailing slash does not produce a double slash", () => {
    expect(renderEmail({ template: "password_reset", to: "a@b.c", data: { token: "T" } }, { ...base, siteOrigin: "https://royal.example/" }).body).toContain("https://royal.example/reset-password#token=T");
  });

  it("refuses a token that could break out of the link, or an unknown template", () => {
    expect(() => renderEmail({ template: "password_reset", to: "a@b.c", data: { token: "bad token\nhttps://evil.example" } }, base)).toThrow(/token/i);
    expect(() => renderEmail({ template: "nonsense" as never, to: "a@b.c", data: {} }, base)).toThrow(/template/i);
  });
});

describe("renderEmail: admission_verify (D-063)", () => {
  it("links to /apply, the real page, with the token after a #", () => {
    const rendered = renderEmail({ template: "admission_verify", to: "sita@school.example", data: { token: "TOKEN123" } }, base);
    expect(rendered.subject).toBe("Confirm your application to Royal Softech College");
    expect(rendered.body).toContain("https://royal.example/apply#token=TOKEN123");
    expect(rendered.body).not.toMatch(/apply\/verify/); // the page is /apply itself, not a separate route
  });
});

describe("renderEmail: admission_decision (D-063)", () => {
  it("tells an approved applicant their SID", () => {
    const rendered = renderEmail({ template: "admission_decision", to: "sita@school.example", data: { decision: "approved", reason: "", sid: "2083-00001" } }, base);
    expect(rendered.subject).toContain("admitted");
    expect(rendered.body).toContain("2083-00001");
  });

  it("gives the reason for needing changes, and for a rejection", () => {
    const changes = renderEmail({ template: "admission_decision", to: "a@b.c", data: { decision: "needs_changes", reason: "The phone number looks incomplete." } }, base);
    expect(changes.body).toContain("The phone number looks incomplete.");
    const rejected = renderEmail({ template: "admission_decision", to: "a@b.c", data: { decision: "rejected", reason: "Missing documents" } }, base);
    expect(rejected.body).toContain("Missing documents");
  });
});

describe("sending through the outbox", () => {
  it("delivers a queued email through the adapter, with the event's key as its idempotency key", async () => {
    await applyPack(db, parsePack(royalJson));
    await db.batch([await queueEmail(db, env.DATA_KEY, { template: "password_reset", to: "sita@school.example", data: { token: "SEALEDTOKEN9" }, dedupeKey: "test:notify:1" })]);

    expect(await mailbox("test:notify:1")).toBeNull(); // queued, not yet sent
    const outboxRow = await db.prepare("SELECT payload_json FROM outbox_events WHERE dedupe_key = 'test:notify:1'").first<{ payload_json: string }>();
    expect(outboxRow!.payload_json).not.toContain("SEALEDTOKEN9"); // the token is not readable in the queue
    expect(outboxRow!.payload_json).not.toContain("sita@school.example");

    const result = await runOutbox(env);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const sent = await mailbox("test:notify:1");
    expect(sent).toMatchObject({ to_email: "sita@school.example", subject: "Reset your password for Royal Softech College" });
    expect(sent!.body).toContain("#token=SEALEDTOKEN9");
    expect((await db.prepare("SELECT payload_json FROM outbox_events WHERE dedupe_key = 'test:notify:1'").first<{ payload_json: string }>())!.payload_json).toBe("{}");
  });

  it("running the job again does not send it again", async () => {
    await runOutbox(env);
    await runOutbox(env);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM dev_mailbox WHERE idempotency_key = 'test:notify:1'").first<{ n: number }>())!.n).toBe(1);
  });

  it("if the site address is not configured the send fails loudly and is retried, never sent with a broken link", async () => {
    await db.batch([await queueEmail(db, env.DATA_KEY, { template: "password_reset", to: "a@school.example", data: { token: "T1" }, dedupeKey: "test:notify:nosite" })]);
    const noSite = { ...env, SITE_ORIGIN: undefined };
    const result = await drainOutbox(db, notificationHandlers(noSite), { sealKey: env.DATA_KEY });

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await mailbox("test:notify:nosite")).toBeNull();
    const row = await db.prepare("SELECT last_error, processed_at FROM outbox_events WHERE dedupe_key = 'test:notify:nosite'").first<Record<string, string | null>>();
    expect(row!.last_error).toMatch(/SITE_ORIGIN/);
    expect(row!.processed_at).toBeNull();
  });

  it("a wrong data key stops the send: the token cannot be opened", async () => {
    await db.batch([await queueEmail(db, "a-different-data-key-0123456789abcdef0123456789", { template: "password_reset", to: "b@school.example", data: { token: "T2" }, dedupeKey: "test:notify:wrongkey" })]);
    await runOutbox(env);
    expect(await mailbox("test:notify:wrongkey")).toBeNull();
  });
});
