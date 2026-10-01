import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack } from "../src/core/config";
import { testPack } from "./programme-fixtures";
import { runOutbox } from "../src/core/notifications";
import { verifyPassword } from "../src/core/passwords";
import { sha256Hex } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { RESET_PER_IP_PER_HOUR, RESET_PER_USER_PER_HOUR, RESET_TTL_MINUTES, confirmPasswordReset, requestPasswordReset } from "../src/modules/auth/password-reset";
import { refreshSession, signIn } from "../src/modules/auth/service";
import royalJson from "../../../packs/royal-softech/pack.json";

const db = env.DB;
const app = createApp();
const oldPassword = "old-blue-river-lamp-2083";
const newPassword = "new-green-mountain-tea-77";
const deps = { db, dataKey: env.DATA_KEY, auditKey: env.AUDIT_HMAC_KEY };
const T0 = new Date("2026-01-05T10:00:00.000Z"); // in the past, so the job runner (which uses the real clock) finds these events due
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

let counter = 0;
const uniqueEmail = () => `reset-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;

async function makeUser(overrides: { active?: boolean; email?: string } = {}) {
  const email = overrides.email ?? uniqueEmail();
  const { publicId } = await createUser(db, env.AUDIT_HMAC_KEY, { email, password: oldPassword, fullName: "Reset Person", roles: [{ role: "student", scope: "own" }] });
  if (overrides.active === false) await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(publicId).run();
  return { email, publicId };
}

const resetsFor = async (email: string) =>
  (await db.prepare("SELECT r.* FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email = ?1 ORDER BY r.id").bind(email).all<Record<string, string | number | null>>()).results;
const outboxCount = async () => (await db.prepare("SELECT COUNT(*) AS n FROM outbox_events WHERE type = 'email'").first<{ n: number }>())!.n;

/** The token from the email that was "sent" to this address, like a person clicking the link. */
async function tokenFromMailbox(email: string): Promise<string> {
  // The runner delivers a few at a time; deliver everything due, then read this person's newest email.
  for (let i = 0; i < 40; i++) if ((await runOutbox(env)).processed === 0) break;
  const mail = await db.prepare("SELECT body FROM dev_mailbox WHERE to_email = ?1 ORDER BY id DESC LIMIT 1").bind(email).first<{ body: string }>();
  const match = mail?.body.match(/reset-password#token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no reset email for ${email}`);
  return match[1]!;
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`https://school.example${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...headers }, body: JSON.stringify(body) }, env);

describe("requesting a reset", () => {
  it("prepares the school so emails can name it", async () => {
    await applyPack(db, testPack(royalJson));
  });

  it("for a real account: one reset, one queued email, and after delivery a link that carries the token", async () => {
    const { email } = await makeUser();
    const before = await outboxCount();

    await requestPasswordReset(deps, { email, ip: "203.0.113.5", now: T0 });

    const [reset] = await resetsFor(email);
    expect(reset).toBeTruthy();
    expect(await outboxCount()).toBe(before + 1);
    expect(reset!.expires_at).toBe(minutes(RESET_TTL_MINUTES).toISOString());

    const token = await tokenFromMailbox(email);
    expect(await sha256Hex(token)).toBe(reset!.token_hash); // the link's token is the one whose hash we stored
    expect(JSON.stringify(reset)).not.toContain(token); // and the token itself is not in the table
  });

  it("does not keep the token or the address readable while the email waits in the queue", async () => {
    const { email } = await makeUser();
    await requestPasswordReset(deps, { email, ip: null, now: T0 });
    const queued = await db.prepare("SELECT payload_json FROM outbox_events WHERE processed_at IS NULL ORDER BY id DESC LIMIT 1").first<{ payload_json: string }>();
    expect(queued!.payload_json).not.toContain(email);
    expect(queued!.payload_json).not.toMatch(/token/i);
  });

  it("for an unknown address: nothing is created, nothing is queued, and the caller cannot tell", async () => {
    const before = await outboxCount();
    const resetsBefore = (await db.prepare("SELECT COUNT(*) AS n FROM password_resets").first<{ n: number }>())!.n;

    const unknown = await post("/api/auth/password-reset/request", { email: "nobody-here@school.example" });
    const { email } = await makeUser();
    const known = await post("/api/auth/password-reset/request", { email });

    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(await unknown.text()).toBe(await known.text()); // identical answers
    expect(await outboxCount()).toBe(before + 1); // only the real account queued anything
    expect((await db.prepare("SELECT COUNT(*) AS n FROM password_resets").first<{ n: number }>())!.n).toBe(resetsBefore + 1);
  });

  it("for a deactivated account: nothing is sent", async () => {
    const { email } = await makeUser({ active: false });
    await requestPasswordReset(deps, { email, ip: null, now: T0 });
    expect(await resetsFor(email)).toHaveLength(0);
  });

  it("matches the address whatever its capitals or spaces", async () => {
    const { email } = await makeUser();
    await requestPasswordReset(deps, { email: `  ${email.toUpperCase()} `, ip: null, now: T0 });
    expect(await resetsFor(email)).toHaveLength(1);
  });

  it(`stops after ${RESET_PER_USER_PER_HOUR} requests an hour for one account, so the form cannot flood an inbox`, async () => {
    const { email } = await makeUser();
    for (let i = 0; i < RESET_PER_USER_PER_HOUR + 2; i++) await requestPasswordReset(deps, { email, ip: null, now: minutes(i) });
    expect(await resetsFor(email)).toHaveLength(RESET_PER_USER_PER_HOUR);

    await requestPasswordReset(deps, { email, ip: null, now: minutes(70) }); // an hour later it works again
    expect(await resetsFor(email)).toHaveLength(RESET_PER_USER_PER_HOUR + 1);
  });

  it(`stops after ${RESET_PER_IP_PER_HOUR} requests an hour from one address, across accounts`, async () => {
    const ip = "198.51.100.77";
    const people = await Promise.all(Array.from({ length: RESET_PER_IP_PER_HOUR + 3 }, () => makeUser()));
    for (const person of people) await requestPasswordReset(deps, { email: person.email, ip, now: T0 });
    const created = (await db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE ip = ?1").bind(ip).first<{ n: number }>())!.n;
    expect(created).toBe(RESET_PER_IP_PER_HOUR);
  });

  it("refuses a malformed request with 400", async () => {
    for (const body of [{}, { email: "" }, { email: "x" }, { email: 5 }, { email: "a@b.c", extra: 1 }]) {
      expect((await post("/api/auth/password-reset/request", body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("refuses a request from another website", async () => {
    const response = await post("/api/auth/password-reset/request", { email: "a@school.example" }, { "Sec-Fetch-Site": "cross-site" });
    expect(response.status).toBe(403);
  });
});

describe("confirming a reset", () => {
  async function requested(now: Date = T0) {
    const person = await makeUser();
    await requestPasswordReset(deps, { email: person.email, ip: null, now });
    return { ...person, token: await tokenFromMailbox(person.email) };
  }
  const passwordOf = async (email: string) => (await db.prepare("SELECT password_hash FROM users WHERE email = ?1").bind(email).first<{ password_hash: string }>())!.password_hash;

  it("sets the new password, ends every session, and writes an audit entry naming the person", async () => {
    const person = await requested();
    const session = await signIn({ db, sessionSecret: env.SESSION_SECRET }, { email: person.email, password: oldPassword, ip: null, userAgent: null });
    if (!session.ok || !("refreshToken" in session)) throw new Error("expected a session");

    const result = await confirmPasswordReset(deps, { token: person.token, password: newPassword }, minutes(5));
    expect(result).toEqual({ ok: true });

    expect(verifyPassword(newPassword, await passwordOf(person.email))).toBe(true);
    expect(verifyPassword(oldPassword, await passwordOf(person.email))).toBe(false);
    expect(await refreshSession({ db, sessionSecret: env.SESSION_SECRET }, session.refreshToken)).toMatchObject({ ok: false }); // the old session is over

    const audit = await db
      .prepare("SELECT a.action, a.summary, u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.action = 'accounts.password.reset' ORDER BY a.id DESC")
      .first<{ summary: string; actor: string }>();
    expect(audit).toMatchObject({ actor: person.publicId });
    expect(await verifyAuditChain(db, env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });

  it("the new password signs in and the old one does not", async () => {
    const person = await requested();
    await confirmPasswordReset(deps, { token: person.token, password: newPassword }, minutes(1));
    const ok = await signIn({ db, sessionSecret: env.SESSION_SECRET }, { email: person.email, password: newPassword, ip: null, userAgent: null });
    const old = await signIn({ db, sessionSecret: env.SESSION_SECRET }, { email: person.email, password: oldPassword, ip: null, userAgent: null });
    expect(ok.ok).toBe(true);
    expect(old.ok).toBe(false);
  });

  it("works once: a second use of the link is refused and changes nothing", async () => {
    const person = await requested();
    expect(await confirmPasswordReset(deps, { token: person.token, password: newPassword }, minutes(1))).toEqual({ ok: true });
    const again = await confirmPasswordReset(deps, { token: person.token, password: "another-fine-password-99" }, minutes(2));
    expect(again).toEqual({ ok: false, reason: "invalid_or_expired" });
    expect(verifyPassword(newPassword, await passwordOf(person.email))).toBe(true);
  });

  it(`expires after ${RESET_TTL_MINUTES} minutes`, async () => {
    const person = await requested();
    expect(await confirmPasswordReset(deps, { token: person.token, password: newPassword }, minutes(RESET_TTL_MINUTES + 1))).toEqual({ ok: false, reason: "invalid_or_expired" });
    expect(verifyPassword(oldPassword, await passwordOf(person.email))).toBe(true);
  });

  it("an expired link is refused as expired even when the new password is also weak: a dead link says nothing about passwords", async () => {
    const person = await requested();
    expect(await confirmPasswordReset(deps, { token: person.token, password: "short" }, minutes(RESET_TTL_MINUTES + 1))).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("gives the same answer for a wrong, malformed or empty token as for an expired one", async () => {
    const expired = await requested();
    const answers = [
      await confirmPasswordReset(deps, { token: expired.token, password: newPassword }, minutes(RESET_TTL_MINUTES + 5)),
      await confirmPasswordReset(deps, { token: "not-a-real-token-at-all-0123456789", password: newPassword }, T0),
      await confirmPasswordReset(deps, { token: "x", password: newPassword }, T0),
    ];
    for (const answer of answers) expect(answer).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("a newer request replaces the older link: only the latest works", async () => {
    const person = await makeUser();
    await requestPasswordReset(deps, { email: person.email, ip: null, now: T0 });
    const first = await tokenFromMailbox(person.email);
    await requestPasswordReset(deps, { email: person.email, ip: null, now: minutes(1) });
    const second = await tokenFromMailbox(person.email);
    expect(second).not.toBe(first);

    expect(await confirmPasswordReset(deps, { token: first, password: newPassword }, minutes(2))).toEqual({ ok: false, reason: "invalid_or_expired" });
    expect(await confirmPasswordReset(deps, { token: second, password: newPassword }, minutes(2))).toEqual({ ok: true });
  });

  it("using one link ends any other link still outstanding for the account", async () => {
    const person = await makeUser();
    await requestPasswordReset(deps, { email: person.email, ip: null, now: T0 });
    const token = await tokenFromMailbox(person.email);
    // A second, still-unused link (made by hand, as if from an earlier build).
    await db.prepare("INSERT INTO password_resets (user_id, token_hash, created_at, expires_at) SELECT id, 'other-outstanding-hash', ?1, ?2 FROM users WHERE email = ?3").bind(T0.toISOString(), minutes(60).toISOString(), person.email).run();

    await confirmPasswordReset(deps, { token, password: newPassword }, minutes(1));
    const open = await db.prepare("SELECT COUNT(*) AS n FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email = ?1 AND r.used_at IS NULL").bind(person.email).first<{ n: number }>();
    expect(open!.n).toBe(0);
  });

  it.each([
    ["too short", "short1!", "too_short"],
    ["a common password", "password123", "common"],
    ["the school's own name", "Royal-Softech-2083-x", "contains_school_name"],
  ])("refuses %s with the reason, and leaves the link usable for another try", async (_label, password, problem) => {
    const person = await requested();
    const result = await confirmPasswordReset(deps, { token: person.token, password }, minutes(1));
    expect(result).toMatchObject({ ok: false, reason: "weak_password" });
    expect((result as { problems: string[] }).problems).toContain(problem);

    expect(verifyPassword(oldPassword, await passwordOf(person.email))).toBe(true); // nothing changed
    expect(await confirmPasswordReset(deps, { token: person.token, password: newPassword }, minutes(2))).toEqual({ ok: true }); // link still works
  });

  it("refuses a password that contains the person's email name", async () => {
    const person = await requested();
    const local = person.email.split("@")[0]!;
    const result = await confirmPasswordReset(deps, { token: person.token, password: `${local}-plus-more-words` }, minutes(1));
    expect((result as { problems: string[] }).problems).toContain("contains_email");
  });

  it("a deactivated account cannot use an old link", async () => {
    const person = await requested();
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(person.publicId).run();
    expect(await confirmPasswordReset(deps, { token: person.token, password: newPassword }, minutes(1))).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("two people using the same link at the same moment: exactly one wins, and its password is the one that stays", async () => {
    const person = await requested();
    const [a, b] = await Promise.all([
      confirmPasswordReset(deps, { token: person.token, password: "winner-a-fine-password-11" }, minutes(1)),
      confirmPasswordReset(deps, { token: person.token, password: "winner-b-fine-password-22" }, minutes(1)),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const stored = await passwordOf(person.email);
    const winner = a.ok ? "winner-a-fine-password-11" : "winner-b-fine-password-22";
    expect(verifyPassword(winner, stored)).toBe(true);
    const audits = (await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'accounts.password.reset' AND entity_public_id = ?1").bind(person.publicId).first<{ n: number }>())!.n;
    expect(audits).toBe(1); // no phantom entry from the loser
  });

  it("over HTTP: 204 on success, 400 for a bad link, 422 with reasons for a weak password, 400 for a bad body", async () => {
    const person = await requested(new Date()); // the route uses the real clock, so the link must be made now
    const weak = await post("/api/auth/password-reset/confirm", { token: person.token, password: "short" });
    expect(weak.status).toBe(422);
    expect(((await weak.json()) as { problems: string[] }).problems).toContain("too_short");

    const bad = await post("/api/auth/password-reset/confirm", { token: "nope-nope-nope-nope-nope-nope", password: newPassword });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_or_expired_link" });

    expect((await post("/api/auth/password-reset/confirm", { token: person.token })).status).toBe(400);

    const ok = await post("/api/auth/password-reset/confirm", { token: person.token, password: newPassword });
    expect(ok.status).toBe(204);
  });

  it("refuses a confirm from another website", async () => {
    const response = await post("/api/auth/password-reset/confirm", { token: "x".repeat(20), password: newPassword }, { "Sec-Fetch-Site": "cross-site" });
    expect(response.status).toBe(403);
  });
});
