import { scrypt } from "@noble/hashes/scrypt.js";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { toBase64Url } from "../src/core/encoding";
import { needsRehash, verifyPassword } from "../src/core/passwords";
import { ACCESS_TTL_SECONDS, sha256Hex, signAccessToken } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { EMAIL_FAILURE_LIMIT, IP_FAILURE_LIMIT } from "../src/modules/auth/service";

const app = createApp();
const db = env.DB;
const password = "blue-river-lamp-2083";
let counter = 0;
const uniqueEmail = (name: string) => `${name}-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;

interface Init {
  method?: string;
  body?: unknown;
  cookies?: Record<string, string>;
  ip?: string;
  headers?: Record<string, string>;
}

const call = (path: string, init: Init = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.cookies ? { Cookie: Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(init.ip ? { "CF-Connecting-IP": init.ip } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    env,
  );

/** The cookies a response sets, as name to value. */
function jarOf(response: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";")[0]!;
    const at = pair.indexOf("=");
    jar[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return jar;
}

const signIn = (email: string, pw = password, ip?: string) => call("/api/auth/sign-in", { method: "POST", body: { email, password: pw }, ip });
const refresh = (jar: Record<string, string>) => call("/api/auth/refresh", { method: "POST", cookies: jar });
const me = (jar: Record<string, string>) => call("/api/auth/me", { cookies: jar });

async function newUser(name = "person", roles: Parameters<typeof createUser>[2]["roles"] = [{ role: "coordinator", scope: "institution" }]) {
  const email = uniqueEmail(name);
  await createUser(db, env.AUDIT_HMAC_KEY, { email, password, fullName: "Test Person", roles });
  return email;
}

async function insertFailures(opts: { email?: string; ip?: string; count: number; minutesAgo?: number }) {
  const at = new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000).toISOString();
  await db.batch(
    Array.from({ length: opts.count }, () =>
      db
        .prepare("INSERT INTO sign_in_events (at, email_tried, success, reason, ip) VALUES (?1, ?2, 0, 'bad_password', ?3)")
        .bind(at, opts.email ?? "someone@school.example", opts.ip ?? null),
    ),
  );
}

/** A dead session must say so and clear the cookies. A bare 401 is not enough: `refresh_in_progress` is also a 401. */
async function expectSignedOut(response: Response) {
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthenticated" });
  expect(response.headers.getSetCookie().some((line) => /Max-Age=0/.test(line))).toBe(true);
}

const sessionOf = async (refreshToken: string) =>
  db.prepare("SELECT * FROM sessions WHERE refresh_hash = ?1").bind(await sha256Hex(refreshToken)).first<Record<string, string | number | null>>();

let email: string; // a shared coordinator, to avoid hashing a new password in every test
beforeAll(async () => {
  email = await newUser("shared");
});

describe("signing in", () => {
  it("returns the user and roles, and sets two HttpOnly, Secure, same-site cookies", async () => {
    const response = await signIn(email);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { fullName: "Test Person", email },
      roles: [{ role: "coordinator", scope: "institution" }],
    });

    const lines = response.headers.getSetCookie();
    const access = lines.find((l) => l.startsWith("__Host-access="))!;
    const refreshLine = lines.find((l) => l.startsWith("__Host-refresh="))!;
    for (const line of [access, refreshLine]) {
      expect(line).toMatch(/Path=\//);
      expect(line).toMatch(/HttpOnly/);
      expect(line).toMatch(/Secure/);
      expect(line).toMatch(/SameSite=Lax/);
      expect(line).not.toMatch(/Domain=/); // __Host- cookies must not carry a Domain
    }
    expect(access).toMatch(new RegExp(`Max-Age=${ACCESS_TTL_SECONDS}`));
    expect(refreshLine).toMatch(/Max-Age=2592000/); // 30 days
  });

  it("does not care about the letter case of the email", async () => {
    expect((await signIn(email.toUpperCase())).status).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown email, so emails cannot be discovered", async () => {
    const wrong = await signIn(email, "definitely-the-wrong-one");
    const unknown = await signIn("nobody-at-all@school.example");

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.getSetCookie()).toEqual([]);
    expect(unknown.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a deactivated account, with the same generic answer", async () => {
    const inactive = await newUser("inactive");
    await db.prepare("UPDATE users SET is_active = 0 WHERE email = ?1").bind(inactive).run();

    const response = await signIn(inactive);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a request with no password", async () => {
    const response = await call("/api/auth/sign-in", { method: "POST", body: { email } });
    expect(response.status).toBe(400);
  });

  it("refuses a sign-in that does not come from our own site", async () => {
    const response = await call("/api/auth/sign-in", {
      method: "POST",
      body: { email, password },
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(response.status).toBe(403);
  });

  it("upgrades a hash made with weaker settings at sign-in", async () => {
    const weakEmail = await newUser("weak");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = scrypt(password, salt, { N: 2 ** 14, r: 8, p: 1, dkLen: 32 });
    const weak = `scrypt$16384$8$1$${toBase64Url(salt)}$${toBase64Url(key)}`;
    await db.prepare("UPDATE users SET password_hash = ?1 WHERE email = ?2").bind(weak, weakEmail).run();

    expect((await signIn(weakEmail)).status).toBe(200);

    const row = await db.prepare("SELECT password_hash FROM users WHERE email = ?1").bind(weakEmail).first<{ password_hash: string }>();
    expect(needsRehash(row!.password_hash)).toBe(false);
    expect(verifyPassword(password, row!.password_hash)).toBe(true);
  });
});

describe("the sign-in log", () => {
  it("records successes and failures, never the password", async () => {
    const who = await newUser("logged");
    await signIn(who, "the-wrong-password-123", "203.0.113.7");
    await signIn(who, password, "203.0.113.7");

    const { results } = await db
      .prepare("SELECT * FROM sign_in_events WHERE email_tried = ?1 ORDER BY id")
      .bind(who)
      .all<Record<string, unknown>>();

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ success: 0, reason: "bad_password", ip: "203.0.113.7" });
    expect(results[1]).toMatchObject({ success: 1, reason: null, ip: "203.0.113.7" });
    expect(results[1]!.user_id).not.toBeNull();
    expect(JSON.stringify(results)).not.toContain(password);
    expect(JSON.stringify(results)).not.toContain("the-wrong-password-123");
  });

  it("notes why an unknown email or an inactive account failed", async () => {
    const ghost = uniqueEmail("ghost");
    await signIn(ghost);
    const row = await db.prepare("SELECT reason, user_id FROM sign_in_events WHERE email_tried = ?1").bind(ghost).first();
    expect(row).toEqual({ reason: "unknown_user", user_id: null });
  });

  it("cannot be edited or deleted", async () => {
    await insertFailures({ count: 1 });
    await expect(db.prepare("UPDATE sign_in_events SET success = 1").run()).rejects.toThrow(/append-only/);
    await expect(db.prepare("DELETE FROM sign_in_events").run()).rejects.toThrow(/append-only/);
  });
});

describe("lockout and throttling", () => {
  it(`locks an email after ${EMAIL_FAILURE_LIMIT} recent failures, even for the right password`, async () => {
    const target = await newUser("locked");
    await insertFailures({ email: target, count: EMAIL_FAILURE_LIMIT });

    const response = await signIn(target);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "too_many_attempts" });
    expect(response.headers.get("Retry-After")).toBe("900");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("locks an email that does not exist in exactly the same way, so lockout reveals nothing", async () => {
    const ghost = uniqueEmail("ghost");
    await insertFailures({ email: ghost, count: EMAIL_FAILURE_LIMIT });

    const response = await signIn(ghost);
    expect(response.status).toBe(429);
  });

  it("one person's failures do not lock anyone else", async () => {
    const target = await newUser("victim");
    await insertFailures({ email: target, count: EMAIL_FAILURE_LIMIT });
    expect((await signIn(email)).status).toBe(200);
  });

  it("failures older than 15 minutes no longer count", async () => {
    const target = await newUser("old-failures");
    await insertFailures({ email: target, count: EMAIL_FAILURE_LIMIT, minutesAgo: 16 });
    expect((await signIn(target)).status).toBe(200);
  });

  it("one fewer than the limit still lets the right password in", async () => {
    const target = await newUser("almost");
    await insertFailures({ email: target, count: EMAIL_FAILURE_LIMIT - 1 });
    expect((await signIn(target)).status).toBe(200);
  });

  it(`throttles an address after ${IP_FAILURE_LIMIT} recent failures, whatever the email`, async () => {
    await insertFailures({ ip: "198.51.100.9", count: IP_FAILURE_LIMIT });
    expect((await signIn(email, password, "198.51.100.9")).status).toBe(429);
    expect((await signIn(email, password, "198.51.100.10")).status).toBe(200); // another address is fine
  });

  it("a throttled attempt writes nothing, so it cannot be used to burn the daily write budget", async () => {
    const target = await newUser("no-writes");
    await insertFailures({ email: target, count: EMAIL_FAILURE_LIMIT });
    const before = await db.prepare("SELECT COUNT(*) AS n FROM sign_in_events").first<{ n: number }>();

    await signIn(target);
    await signIn(target);

    const after = await db.prepare("SELECT COUNT(*) AS n FROM sign_in_events").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});

describe("who am I", () => {
  it("answers from the signed cookie for a signed-in user", async () => {
    const jar = jarOf(await signIn(email));
    const response = await me(jar);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Test Person", roles: [{ role: "coordinator", scope: "institution" }] });
  });

  it("is refused with no cookie", async () => {
    expect((await me({})).status).toBe(401);
  });

  it("is refused with a tampered cookie", async () => {
    const jar = jarOf(await signIn(email));
    const token = jar["__Host-access"]!;
    expect((await me({ "__Host-access": token.slice(0, -3) + "AAA" })).status).toBe(401);
  });

  it("is refused once the access token has expired", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await signAccessToken(env.SESSION_SECRET, {
      sub: "u", sid: "s", name: "Old", roles: [], iat: now - 4000, exp: now - 10,
    });
    expect((await me({ "__Host-access": expired })).status).toBe(401);
  });

  it("is refused for a token signed with a different secret", async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = await signAccessToken("attacker-secret-0123456789abcdef0123456789", {
      sub: "u", sid: "s", name: "Mallory", roles: [{ role: "admin", scope: "institution" }], iat: now, exp: now + 1000,
    });
    expect((await me({ "__Host-access": forged })).status).toBe(401);
  });
});

describe("roles in the token", () => {
  it("carry the scope and the section, and pick up changes at the next refresh", async () => {
    await db.prepare("INSERT OR IGNORE INTO sections (key, name) VALUES ('plus2', '+2')").run();
    const multi = await newUser("multi", [
      { role: "coordinator", scope: "institution" },
      { role: "accountant", scope: "section", sectionKey: "plus2" },
    ]);

    const jar = jarOf(await signIn(multi));
    expect(await (await me(jar)).json()).toMatchObject({
      roles: [
        { role: "coordinator", scope: "institution" },
        { role: "accountant", scope: "section", section: "plus2" },
      ],
    });

    await db
      .prepare("INSERT INTO role_assignments (user_id, role, scope_type) SELECT id, 'teacher', 'assigned' FROM users WHERE email = ?1")
      .bind(multi)
      .run();
    const refreshed = jarOf(await refresh(jar));
    expect(((await (await me(refreshed)).json()) as { roles: unknown[] }).roles).toHaveLength(3);
  });

  it("leave out an assignment that has been deactivated", async () => {
    const who = await newUser("deactivated-role", [
      { role: "coordinator", scope: "institution" },
      { role: "teacher", scope: "assigned" },
    ]);
    await db
      .prepare("UPDATE role_assignments SET is_active = 0 WHERE role = 'teacher' AND user_id = (SELECT id FROM users WHERE email = ?1)")
      .bind(who)
      .run();

    const body = (await (await signIn(who)).json()) as { roles: { role: string }[] };
    expect(body.roles.map((r) => r.role)).toEqual(["coordinator"]);
  });
});

describe("refreshing", () => {
  it("issues a new pair of tokens, and the new cookies work", async () => {
    const first = jarOf(await signIn(email));
    const response = await refresh(first);

    expect(response.status).toBe(200);
    const second = jarOf(response);
    expect(second["__Host-refresh"]).toBeDefined();
    expect(second["__Host-refresh"]).not.toBe(first["__Host-refresh"]);
    expect((await me(second)).status).toBe(200);
  });

  it("stores only a hash of the refresh token", async () => {
    const jar = jarOf(await signIn(email));
    const token = jar["__Host-refresh"]!;
    const session = await sessionOf(token);

    expect(session!.refresh_hash).toBe(await sha256Hex(token));
    expect(session!.refresh_hash).not.toBe(token);
    expect(JSON.stringify(session)).not.toContain(token);
  });

  it("refuses a made-up refresh token and clears the cookies", async () => {
    const response = await refresh({ "__Host-refresh": "x".repeat(43) });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().some((l) => /Max-Age=0/.test(l))).toBe(true);
  });

  it("refuses when there is no refresh cookie", async () => {
    expect((await refresh({})).status).toBe(401);
  });

  it("treats the old token used straight after rotation as two tabs racing: retry, and the session lives", async () => {
    const first = jarOf(await signIn(email));
    const second = jarOf(await refresh(first));

    const raced = await refresh(first); // the old token, a moment later
    expect(raced.status).toBe(401);
    expect(await raced.json()).toEqual({ error: "refresh_in_progress" });
    expect(raced.headers.getSetCookie()).toEqual([]); // cookies are left alone

    expect((await refresh(second)).status).toBe(200); // the newer token still works
  });

  it("treats the old token used LATER as theft, and ends the whole session", async () => {
    const first = jarOf(await signIn(email));
    const second = jarOf(await refresh(first));
    const session = await sessionOf(second["__Host-refresh"]!);
    const longAgo = new Date(Date.now() - 60_000).toISOString();
    await db.prepare("UPDATE sessions SET last_used_at = ?1 WHERE id = ?2").bind(longAgo, session!.id).run();

    await expectSignedOut(await refresh(first)); // the copied old token
    await expectSignedOut(await refresh(second)); // and now the legitimate one too
    const row = await db.prepare("SELECT revoked_reason FROM sessions WHERE id = ?1").bind(session!.id).first<{ revoked_reason: string }>();
    expect(row!.revoked_reason).toBe("refresh_token_reuse");
  });

  it("two refreshes at the same instant: exactly one wins", async () => {
    const jar = jarOf(await signIn(email));
    const results = await Promise.all([refresh(jar), refresh(jar)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("refuses a session past its absolute lifetime", async () => {
    const jar = jarOf(await signIn(email));
    const session = await sessionOf(jar["__Host-refresh"]!);
    await db.prepare("UPDATE sessions SET expires_at = ?1 WHERE id = ?2").bind(new Date(Date.now() - 1000).toISOString(), session!.id).run();

    await expectSignedOut(await refresh(jar));
  });

  it("refuses a session unused for more than 7 days", async () => {
    const jar = jarOf(await signIn(email));
    const session = await sessionOf(jar["__Host-refresh"]!);
    const eightDays = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    await db.prepare("UPDATE sessions SET last_used_at = ?1 WHERE id = ?2").bind(eightDays, session!.id).run();

    await expectSignedOut(await refresh(jar));
  });

  it("ends the session when the account is deactivated", async () => {
    const who = await newUser("fired");
    const jar = jarOf(await signIn(who));
    await db.prepare("UPDATE users SET is_active = 0 WHERE email = ?1").bind(who).run();

    await expectSignedOut(await refresh(jar));
    const session = await sessionOf(jar["__Host-refresh"]!);
    expect(session!.revoked_reason).toBe("user_inactive");
  });
});

describe("signing out", () => {
  it("ends the session: the refresh cookie stops working, and the cookies are cleared", async () => {
    const jar = jarOf(await signIn(email));
    const response = await call("/api/auth/sign-out", { method: "POST", cookies: jar });

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().filter((l) => /Max-Age=0/.test(l))).toHaveLength(2);
    await expectSignedOut(await refresh(jar));
  });

  it("succeeds even with no cookies at all", async () => {
    expect((await call("/api/auth/sign-out", { method: "POST" })).status).toBe(204);
  });

  it("only ends its own session, not the user's other devices", async () => {
    const phone = jarOf(await signIn(email));
    const laptop = jarOf(await signIn(email));
    await call("/api/auth/sign-out", { method: "POST", cookies: phone });

    expect((await refresh(laptop)).status).toBe(200);
  });

  it("known limit: the access cookie keeps working until it expires (at most 30 minutes)", async () => {
    // Sign-out revokes the session, so it cannot be refreshed. But the signed access token is
    // checked without a database read, so it lives out its 30 minutes. That is why money,
    // approval and publish actions re-check the user's assignments inside their own batch.
    const jar = jarOf(await signIn(email));
    await call("/api/auth/sign-out", { method: "POST", cookies: jar });

    expect((await me(jar)).status).toBe(200);
  });
});
