import { env } from "cloudflare:test";
import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, parsePack } from "../src/core/config";
import { seal } from "../src/core/crypto-box";
import { signChallenge } from "../src/core/two-factor/challenge";
import { hashRecoveryCode } from "../src/core/two-factor/recovery";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { signIn } from "../src/modules/auth/service";
import { verifyTwoFactor } from "../src/modules/auth/two-factor";
import royalJson from "../../../packs/royal-softech/pack.json";

const db = env.DB;
const app = createApp();
const password = "blue-river-lamp-2083";
const deps = { db, sessionSecret: env.SESSION_SECRET, dataKey: env.DATA_KEY, auditKey: env.AUDIT_HMAC_KEY };

let counter = 0;
const uniqueEmail = (label: string) => `${label}-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;

async function makeUser(role: "super_admin" | "coordinator" | "admin" = "super_admin", active = true) {
  const email = uniqueEmail(role);
  const roles = role === "coordinator" ? [{ role, scope: "institution" as const }] : [{ role, scope: "institution" as const }];
  const { publicId } = await createUser(db, env.AUDIT_HMAC_KEY, { email, password, fullName: "Two Factor Person", roles });
  if (!active) await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(publicId).run();
  return { email, publicId };
}

const codeAt = (secret: string, ms: number) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" }).generate({ timestamp: ms });

async function call(path: string, body: unknown, options: { cookie?: string; headers?: Record<string, string>; method?: string } = {}) {
  return app.request(
    `https://school.example${path}`,
    {
      method: options.method ?? "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

const cookiesFrom = (response: Response) =>
  response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

/** Password step over HTTP: returns the challenge. */
async function passwordStep(email: string) {
  const response = await call("/api/auth/sign-in", { email, password });
  const body = (await response.json()) as { twoFactor?: string; challenge?: string };
  return { response, body };
}

/** Sets up two-step sign-in for a fresh Super Admin and returns everything a test needs afterwards. */
async function enrolled() {
  const person = await makeUser("super_admin");
  const { body } = await passwordStep(person.email);
  const setup = (await (await call("/api/auth/2fa/setup", { challenge: body.challenge })).json()) as { secret: string; otpauthUri: string };
  const now = Date.now();
  const enable = await call("/api/auth/2fa/enable", { challenge: body.challenge, code: codeAt(setup.secret, now) });
  const enabled = (await enable.json()) as { recoveryCodes: string[] };
  return { ...person, secret: setup.secret, recoveryCodes: enabled.recoveryCodes, enabledAtMs: now, cookie: cookiesFrom(enable) };
}

const rowFor = (publicId: string) =>
  db.prepare("SELECT tf.* FROM user_two_factor tf JOIN users u ON u.id = tf.user_id WHERE u.public_id = ?1").bind(publicId).first<Record<string, string | number | null>>();
const eventsFor = async (email: string, reason: string) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE email_tried = ?1 AND reason = ?2").bind(email, reason).first<{ n: number }>())!.n;

describe("the school is set up", () => {
  it("has a name to show in the authenticator app", async () => {
    await applyPack(db, parsePack(royalJson));
  });
});

describe("who needs a second step", () => {
  it("a Super Admin who has not set it up is asked to, and gets no session yet", async () => {
    const person = await makeUser("super_admin");
    const { response, body } = await passwordStep(person.email);
    expect(response.status).toBe(200);
    expect(body.twoFactor).toBe("setup");
    expect(typeof body.challenge).toBe("string");
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(await eventsFor(person.email, "password_ok_two_factor_setup")).toBe(1);
  });

  it("a Co-ordinator, an Admin: signed in as before, no second step", async () => {
    for (const role of ["coordinator", "admin"] as const) {
      const person = await makeUser(role);
      const { response, body } = await passwordStep(person.email);
      expect(response.status, role).toBe(200);
      expect(body.twoFactor, role).toBeUndefined();
      expect(response.headers.getSetCookie().some((c) => c.startsWith("__Host-refresh="))).toBe(true);
    }
  });

  it("anyone who HAS turned it on is asked for the code, whatever their role", async () => {
    const person = await makeUser("admin");
    const sealed = await seal(env.DATA_KEY, "JBSWY3DPEHPK3PXP", `totp:${person.publicId}`);
    await db.prepare("INSERT INTO user_two_factor (user_id, secret_sealed, created_at, enabled_at) SELECT id, ?1, ?2, ?2 FROM users WHERE public_id = ?3").bind(sealed, new Date().toISOString(), person.publicId).run();
    const { body } = await passwordStep(person.email);
    expect(body.twoFactor).toBe("required");
  });

  it("a wrong password never gets a challenge", async () => {
    const person = await makeUser("super_admin");
    const response = await call("/api/auth/sign-in", { email: person.email, password: "definitely-not-it-123" });
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("challenge");
  });
});

describe("setting it up", () => {
  it("gives a secret and the address for an authenticator app, naming the school and the account", async () => {
    const person = await makeUser("super_admin");
    const { body } = await passwordStep(person.email);
    const response = await call("/api/auth/2fa/setup", { challenge: body.challenge });
    const setup = (await response.json()) as { secret: string; otpauthUri: string };

    expect(response.status).toBe(200);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
    expect(decodeURIComponent(setup.otpauthUri)).toContain(`Royal Softech College:${person.email}`);
  });

  it("stores the secret sealed: it is not readable in the database", async () => {
    const person = await makeUser("super_admin");
    const { body } = await passwordStep(person.email);
    const setup = (await (await call("/api/auth/2fa/setup", { challenge: body.challenge })).json()) as { secret: string };
    const row = await rowFor(person.publicId);
    expect(row!.secret_sealed).not.toContain(setup.secret);
    expect(row!.enabled_at).toBeNull(); // not on until a code is confirmed
  });

  it("asking again replaces the unconfirmed secret", async () => {
    const person = await makeUser("super_admin");
    const { body } = await passwordStep(person.email);
    const first = (await (await call("/api/auth/2fa/setup", { challenge: body.challenge })).json()) as { secret: string };
    const second = (await (await call("/api/auth/2fa/setup", { challenge: body.challenge })).json()) as { secret: string };
    expect(second.secret).not.toBe(first.secret);
    const wrongOld = await call("/api/auth/2fa/enable", { challenge: body.challenge, code: codeAt(first.secret, Date.now()) });
    expect(wrongOld.status).toBe(401); // the old secret no longer works
  });

  it("refuses a wrong first code and leaves it switched off", async () => {
    const person = await makeUser("super_admin");
    const { body } = await passwordStep(person.email);
    await call("/api/auth/2fa/setup", { challenge: body.challenge });
    const response = await call("/api/auth/2fa/enable", { challenge: body.challenge, code: "000000" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_code" });
    expect((await rowFor(person.publicId))!.enabled_at).toBeNull();
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("turns on with a right code: signs the person in, and gives ten recovery codes once", async () => {
    const person = await makeUser("super_admin");
    const { body } = await passwordStep(person.email);
    const setup = (await (await call("/api/auth/2fa/setup", { challenge: body.challenge })).json()) as { secret: string };

    const response = await call("/api/auth/2fa/enable", { challenge: body.challenge, code: codeAt(setup.secret, Date.now()) });
    const result = (await response.json()) as { user: { email: string }; roles: RoleClaim[]; recoveryCodes: string[] };

    expect(response.status).toBe(200);
    expect(result.user.email).toBe(person.email);
    expect(result.roles).toEqual([{ role: "super_admin", scope: "institution" }]);
    expect(result.recoveryCodes).toHaveLength(10);
    expect((await rowFor(person.publicId))!.enabled_at).not.toBeNull();

    const me = await call("/api/auth/me", undefined, { method: "GET", cookie: cookiesFrom(response) });
    expect(me.status).toBe(200); // a real session

    // Only hashes are kept.
    const stored = await db.prepare("SELECT code_hash FROM two_factor_recovery_codes WHERE user_id = (SELECT id FROM users WHERE public_id = ?1)").bind(person.publicId).all<{ code_hash: string }>();
    expect(stored.results).toHaveLength(10);
    for (const code of result.recoveryCodes) expect(JSON.stringify(stored.results)).not.toContain(code.replace("-", ""));
    expect(stored.results.map((r) => r.code_hash).sort()).toEqual((await Promise.all(result.recoveryCodes.map(hashRecoveryCode))).sort());
  });

  it("is recorded in the audit log, naming the person, and the chain still holds", async () => {
    const person = await enrolled();
    const entry = await db
      .prepare("SELECT u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.action = 'accounts.two_factor.enabled' AND a.entity_public_id = ?1")
      .bind(person.publicId)
      .first<{ actor: string }>();
    expect(entry).toEqual({ actor: person.publicId });
    expect(await verifyAuditChain(db, env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });

  it("cannot be set up again once on, so a stolen challenge cannot swap the secret", async () => {
    const person = await enrolled();
    const challenge = await signChallenge(env.SESSION_SECRET, { sub: person.publicId, kind: "setup" });
    const response = await call("/api/auth/2fa/setup", { challenge });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already_enabled" });
  });

  it("refuses to enable when no setup was started", async () => {
    const person = await makeUser("super_admin");
    const { body } = await passwordStep(person.email);
    const response = await call("/api/auth/2fa/enable", { challenge: body.challenge, code: "123456" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no_setup" });
  });
});

describe("signing in with the second step", () => {
  it("asks for the code, and a right code completes the sign-in", async () => {
    const person = await enrolled();
    const { body } = await passwordStep(person.email);
    expect(body.twoFactor).toBe("required");

    const next = Date.now() + 30_000; // the next step is accepted too; this one was used to turn it on
    const response = await call("/api/auth/2fa/verify", { challenge: body.challenge, code: codeAt(person.secret, next) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { user: { email: string } }).user.email).toBe(person.email);
    expect((await call("/api/auth/me", undefined, { method: "GET", cookie: cookiesFrom(response) })).status).toBe(200);
  });

  it("a wrong code is refused, logged, and gives no session", async () => {
    const person = await enrolled();
    const { body } = await passwordStep(person.email);
    const response = await call("/api/auth/2fa/verify", { challenge: body.challenge, code: "000000" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_code" });
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(await eventsFor(person.email, "two_factor_failed")).toBe(1);
  });

  it("locks after five wrong codes, even for a right one, without writing more", async () => {
    const person = await enrolled();
    const { body } = await passwordStep(person.email);
    for (let i = 0; i < 5; i++) await call("/api/auth/2fa/verify", { challenge: body.challenge, code: "000000" });

    const locked = await call("/api/auth/2fa/verify", { challenge: body.challenge, code: codeAt(person.secret, Date.now() + 30_000) });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBeTruthy();
    expect(await eventsFor(person.email, "two_factor_failed")).toBe(5); // the throttled attempt wrote nothing
  });

  it("a code works once: using the same one again is refused, even inside its 30 seconds", async () => {
    const person = await enrolled();
    const t = new Date(person.enabledAtMs + 30_000);
    const first = await passwordStep(person.email);
    const second = await passwordStep(person.email);
    const code = codeAt(person.secret, t.getTime());

    expect(await verifyTwoFactor(deps, { challenge: first.body.challenge!, code, ip: null, userAgent: null }, t)).toMatchObject({ ok: true });
    expect(await verifyTwoFactor(deps, { challenge: second.body.challenge!, code, ip: null, userAgent: null }, t)).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("an older code than one already used is refused", async () => {
    const person = await enrolled();
    const later = new Date(person.enabledAtMs + 30_000);
    const a = await passwordStep(person.email);
    await verifyTwoFactor(deps, { challenge: a.body.challenge!, code: codeAt(person.secret, later.getTime()), ip: null, userAgent: null }, later);

    const b = await passwordStep(person.email);
    const older = await verifyTwoFactor(deps, { challenge: b.body.challenge!, code: codeAt(person.secret, person.enabledAtMs), ip: null, userAgent: null }, new Date(person.enabledAtMs));
    expect(older).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("two people submitting the same fresh code at once: one wins", async () => {
    const person = await enrolled();
    const t = new Date(person.enabledAtMs + 30_000);
    const a = await passwordStep(person.email);
    const b = await passwordStep(person.email);
    const code = codeAt(person.secret, t.getTime());
    const results = await Promise.all([
      verifyTwoFactor(deps, { challenge: a.body.challenge!, code, ip: null, userAgent: null }, t),
      verifyTwoFactor(deps, { challenge: b.body.challenge!, code, ip: null, userAgent: null }, t),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("a recovery code signs in once, however it is typed, and is recorded", async () => {
    const person = await enrolled();
    const [code, other] = person.recoveryCodes;
    const first = await passwordStep(person.email);
    const typed = code!.toUpperCase().replace("-", " ");
    const ok = await call("/api/auth/2fa/verify", { challenge: first.body.challenge, code: typed });
    expect(ok.status).toBe(200);

    const again = await passwordStep(person.email);
    expect((await call("/api/auth/2fa/verify", { challenge: again.body.challenge, code: code })).status).toBe(401); // used up
    expect((await call("/api/auth/2fa/verify", { challenge: again.body.challenge, code: other })).status).toBe(200); // another still works

    const remaining = await db.prepare("SELECT COUNT(*) AS n FROM two_factor_recovery_codes WHERE user_id = (SELECT id FROM users WHERE public_id = ?1) AND used_at IS NULL").bind(person.publicId).first<{ n: number }>();
    expect(remaining!.n).toBe(8);
    const audits = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'accounts.two_factor.recovery_code_used' AND entity_public_id = ?1").bind(person.publicId).first<{ n: number }>();
    expect(audits!.n).toBe(2);
    expect(await verifyAuditChain(db, env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });

  it("one person's recovery code does not work for another", async () => {
    const a = await enrolled();
    const b = await enrolled();
    const step = await passwordStep(b.email);
    expect((await call("/api/auth/2fa/verify", { challenge: step.body.challenge, code: a.recoveryCodes[0] })).status).toBe(401);
  });
});

describe("the challenge token", () => {
  it("refuses garbage, an expired challenge, and one for the wrong step", async () => {
    const person = await enrolled();
    const now = Math.floor(Date.now() / 1000);
    const expired = await signChallenge(env.SESSION_SECRET, { sub: person.publicId, kind: "verify" }, now - 600);
    const setupKind = await signChallenge(env.SESSION_SECRET, { sub: person.publicId, kind: "setup" });
    const verifyKind = await signChallenge(env.SESSION_SECRET, { sub: person.publicId, kind: "verify" });
    const code = codeAt(person.secret, Date.now() + 30_000);

    for (const bad of ["garbage", expired, setupKind]) {
      const response = await call("/api/auth/2fa/verify", { challenge: bad, code });
      expect([response.status, await response.json()], String(bad).slice(0, 20)).toEqual([401, { error: "invalid_challenge" }]);
    }
    for (const [path, body] of [
      ["/api/auth/2fa/setup", { challenge: verifyKind }],
      ["/api/auth/2fa/enable", { challenge: verifyKind, code }],
    ] as const) {
      const response = await call(path, body);
      expect([response.status, await response.json()], path).toEqual([401, { error: "invalid_challenge" }]);
    }
  });

  it("an access token cannot stand in for a challenge", async () => {
    const person = await enrolled();
    const now = Math.floor(Date.now() / 1000);
    const access = await signAccessToken(env.SESSION_SECRET, { sub: person.publicId, sid: "s", name: "N", roles: [], iat: now, exp: now + 600 });
    expect((await call("/api/auth/2fa/verify", { challenge: access, code: "123456" })).status).toBe(401);
  });

  it("a deactivated person's challenge no longer works", async () => {
    const person = await enrolled();
    const { body } = await passwordStep(person.email);
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(person.publicId).run();
    const response = await call("/api/auth/2fa/verify", { challenge: body.challenge, code: codeAt(person.secret, Date.now() + 30_000) });
    expect(response.status).toBe(401);
  });

  it("a sealed secret copied from one person's row to another's cannot be opened there", async () => {
    const a = await enrolled();
    const b = await enrolled();
    const aRow = await rowFor(a.publicId);
    await db.prepare("UPDATE user_two_factor SET secret_sealed = ?1 WHERE user_id = (SELECT id FROM users WHERE public_id = ?2)").bind(aRow!.secret_sealed, b.publicId).run();

    const { body } = await passwordStep(b.email);
    const response = await call("/api/auth/2fa/verify", { challenge: body.challenge, code: codeAt(a.secret, Date.now() + 30_000) });
    expect(response.status).toBe(401);
  });

  it("body problems are 400, and another website's request is 403", async () => {
    for (const [path, body] of [
      ["/api/auth/2fa/verify", {}],
      ["/api/auth/2fa/verify", { challenge: "x" }],
      ["/api/auth/2fa/setup", { challenge: "x", extra: 1 }],
      ["/api/auth/2fa/enable", { challenge: "x" }],
    ] as const) {
      expect((await call(path, body)).status, path).toBe(400);
    }
    expect((await call("/api/auth/2fa/verify", { challenge: "x", code: "123456" }, { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
  });
});

describe("resetting someone's second step (lost phone, no recovery codes)", () => {
  async function asSuperAdmin() {
    const admin = await makeUser("super_admin");
    return { ...admin, cookie: `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: admin.publicId, sid: "s", name: "Admin", roles: [{ role: "super_admin", scope: "institution" }], iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 })}` };
  }
  const reset = (targetId: string, cookie?: string) => call(`/api/users/${targetId}/two-factor/reset`, undefined, { cookie });

  it("another Super Admin removes it, ends the person's sessions, and the person must set it up again", async () => {
    const target = await enrolled();
    const helper = await asSuperAdmin();

    const response = await reset(target.publicId, helper.cookie);
    expect(response.status).toBe(204);
    expect(await rowFor(target.publicId)).toBeNull();
    const codes = await db.prepare("SELECT COUNT(*) AS n FROM two_factor_recovery_codes WHERE user_id = (SELECT id FROM users WHERE public_id = ?1)").bind(target.publicId).first<{ n: number }>();
    expect(codes!.n).toBe(0);

    const { body } = await passwordStep(target.email);
    expect(body.twoFactor).toBe("setup");

    const entry = await db
      .prepare("SELECT u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.action = 'accounts.two_factor.reset' AND a.entity_public_id = ?1")
      .bind(target.publicId)
      .first<{ actor: string }>();
    expect(entry).toEqual({ actor: helper.publicId });
    expect(await verifyAuditChain(db, env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });

  it("ends the sessions the person had", async () => {
    const target = await enrolled();
    const helper = await asSuperAdmin();
    await reset(target.publicId, helper.cookie);
    const live = await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE public_id = ?1) AND revoked_at IS NULL").bind(target.publicId).first<{ n: number }>();
    expect(live!.n).toBe(0);
  });

  it("nobody resets their own: a stolen session could otherwise switch the protection off", async () => {
    const helper = await asSuperAdmin();
    const response = await reset(helper.publicId, helper.cookie);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "cannot_reset_own" });
  });

  it("an unknown person is a 404", async () => {
    const helper = await asSuperAdmin();
    expect((await reset("f".repeat(32), helper.cookie)).status).toBe(404);
  });

  it("only the Super Admin: everyone else is refused, and so is someone not signed in", async () => {
    const target = await enrolled();
    for (const role of ["student", "teacher", "coordinator", "accountant", "admin"] as const) {
      const scope = role === "student" ? "own" : role === "teacher" ? "assigned" : "institution";
      const now = Math.floor(Date.now() / 1000);
      const cookie = `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: "x", sid: "s", name: "N", roles: [{ role, scope }], iat: now, exp: now + 600 })}`;
      expect((await reset(target.publicId, cookie)).status, role).toBe(403);
    }
    expect((await reset(target.publicId)).status).toBe(401);
    expect(await rowFor(target.publicId)).not.toBeNull(); // untouched
  });
});

describe("signIn (service) for a person who has to finish the second step", () => {
  it("does not hand back tokens", async () => {
    const person = await makeUser("super_admin");
    const result = await signIn({ db, sessionSecret: env.SESSION_SECRET }, { email: person.email, password, ip: null, userAgent: null });
    expect(result).toMatchObject({ ok: true, twoFactor: "setup" });
    expect(JSON.stringify(result)).not.toMatch(/accessToken|refreshToken/);
  });
});
