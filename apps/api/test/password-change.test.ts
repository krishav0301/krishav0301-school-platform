import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { passwordProblems, schoolNameWords } from "../src/core/passwords";
import { signChallenge } from "../src/core/two-factor/challenge";
import { createUser } from "../src/modules/accounts/service";

const db = env.DB;
const app = createApp();
const temporary = "K7M2-QX9R-4TBW-HC3P"; // a stand-in for a generated temporary password
const chosen = "Mango-Sunrise-Harbour-4471";

let counter = 0;
const uniqueEmail = (label: string) => `${label}-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;

async function person(role: "coordinator" | "admin" | "teacher" = "coordinator", opts: { flagged?: boolean; active?: boolean } = {}) {
  const { flagged = true, active = true } = opts;
  const email = uniqueEmail(role);
  const scope = role === "teacher" ? "assigned" : "institution";
  const { publicId } = await createUser(db, env.AUDIT_HMAC_KEY, { email, password: temporary, fullName: "New Person", roles: [{ role, scope }] });
  if (flagged) await db.prepare("UPDATE users SET must_change_password = 1 WHERE public_id = ?1").bind(publicId).run();
  if (!active) await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(publicId).run();
  return { email, publicId };
}

const call = (path: string, body: unknown, method = "POST") =>
  app.request(
    `https://school.example${path}`,
    { method, headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
const signIn = (email: string, password = temporary) => call("/api/auth/sign-in", { email, password });
const change = (challenge: string, password: string) => call("/api/auth/password/change-required", { challenge, password });
const cookies = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!);
const flag = async (publicId: string) => (await db.prepare("SELECT must_change_password AS f FROM users WHERE public_id = ?1").bind(publicId).first<{ f: number }>())!.f;

/** Signs in with the temporary password and returns the "choose a new password" challenge. */
async function challengeFor(email: string): Promise<string> {
  const response = await signIn(email);
  const body = (await response.json()) as { passwordChange?: string; challenge?: string };
  expect(body.passwordChange).toBe("required");
  return body.challenge!;
}

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
});

// ---------------------------------------------------------------------------------------------
describe("signing in with a temporary password", () => {
  it("gives a step, never a session: no cookies, and no user or roles in the answer", async () => {
    const { email, publicId } = await person();
    const response = await signIn(email);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ passwordChange: "required" });
    expect(typeof body.challenge).toBe("string");
    expect(body).not.toHaveProperty("user");
    expect(body).not.toHaveProperty("roles");
    expect(cookies(response)).toEqual([]);
    expect(await flag(publicId)).toBe(1); // still to be done
    const event = await db.prepare("SELECT success, reason FROM sign_in_events WHERE user_id = (SELECT id FROM users WHERE public_id = ?1) ORDER BY id DESC LIMIT 1").bind(publicId).first();
    expect(event).toEqual({ success: 1, reason: "password_ok_must_change" });
  });

  it("someone with no flag signs in as before, with a session", async () => {
    const { email } = await person("coordinator", { flagged: false });
    const response = await signIn(email);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email }, roles: [{ role: "coordinator" }] });
    expect(cookies(response).length).toBeGreaterThan(0);
  });

  it("a wrong password still gets the same 401 as an unknown email, flag or no flag", async () => {
    const { email } = await person();
    const wrong = await signIn(email, "not-the-password-at-all");
    const unknown = await signIn(uniqueEmail("nobody"), "not-the-password-at-all");
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("a switched-off person gets no step either: 401", async () => {
    const { email } = await person("coordinator", { active: false });
    expect((await signIn(email)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------
describe("choosing a new password", () => {
  it("clears the flag, replaces the password, and signs the person in; the temporary password stops working", async () => {
    const { email, publicId } = await person();
    const response = await change(await challengeFor(email), chosen);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email }, roles: [{ role: "coordinator" }] });
    expect(cookies(response).length).toBeGreaterThan(0);
    expect(await flag(publicId)).toBe(0);

    expect((await signIn(email, temporary)).status).toBe(401);
    const next = await signIn(email, chosen);
    expect(next.status).toBe(200);
    expect(await next.json()).toHaveProperty("user"); // a session, no step
  });

  it("is recorded with the person as the actor, and neither password is in the entry", async () => {
    const { email, publicId } = await person();
    await change(await challengeFor(email), chosen);
    const rows = (await db.prepare("SELECT a.action, a.summary, a.before_json, a.after_json, a.reason, u.public_id AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1 AND a.action = 'accounts.password.changed'").bind(publicId).all()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: publicId });
    const text = JSON.stringify(rows);
    expect(text).not.toContain(chosen);
    expect(text).not.toContain(temporary);
  });

  it("an Admin then gets the authenticator step, not a session", async () => {
    const { email, publicId } = await person("admin");
    const response = await change(await challengeFor(email), chosen);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ twoFactor: "setup" });
    expect(cookies(response)).toEqual([]);
    expect(await flag(publicId)).toBe(0); // the password is changed; the second step is still to do
  });

  it("refuses a weak password for each reason, leaves the flag set, and the same challenge can still be used", async () => {
    const { email, publicId } = await person();
    const challenge = await challengeFor(email);
    const avoid = schoolNameWords(["Royal Softech College", "Royal Softech"]);
    const cases: [string, string][] = [
      ["short1", "too_short"],
      [email, "contains_email"],
      ["Softech-Tiger-Lantern-9917", "contains_school_name"],
    ];
    for (const [password, problem] of cases) {
      expect(passwordProblems(password, email, avoid), `precondition for ${problem}`).toContain(problem);
      const response = await change(challenge, password);
      expect(response.status, problem).toBe(422);
      const body = (await response.json()) as { error: string; problems: string[] };
      expect(body.error).toBe("weak_password");
      expect(body.problems).toContain(problem);
      expect(await flag(publicId)).toBe(1);
    }
    expect((await change(challenge, chosen)).status).toBe(200);
  });

  it("refuses the temporary password itself, and nothing changes", async () => {
    const { email, publicId } = await person();
    const challenge = await challengeFor(email);
    const response = await change(challenge, temporary);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "same_password" });
    expect(await flag(publicId)).toBe(1);
  });

  it("a challenge works once: after the change it is refused", async () => {
    const { email } = await person();
    const challenge = await challengeFor(email);
    expect((await change(challenge, chosen)).status).toBe(200);
    const again = await change(challenge, "Another-Fresh-Harbour-5582");
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "invalid_challenge" });
  });

  it("two people racing on the same challenge: exactly one wins", async () => {
    const { email, publicId } = await person();
    const challenge = await challengeFor(email);
    const results = await Promise.all([change(challenge, chosen), change(challenge, "Another-Fresh-Harbour-5582")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await flag(publicId)).toBe(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_public_id = ?1 AND action = 'accounts.password.changed'").bind(publicId).first()).toEqual({ n: 1 });
  });

  it("refuses a forged, an expired, and a wrong-kind challenge (401), and a switched-off person", async () => {
    const { email, publicId } = await person();
    expect((await change("not.a.challenge", chosen)).status).toBe(401);
    const old = await signChallenge(env.SESSION_SECRET, { sub: publicId, kind: "password" }, Math.floor(Date.now() / 1000) - 3600);
    expect((await change(old, chosen)).status).toBe(401);
    for (const kind of ["verify", "setup"] as const) {
      const wrong = await signChallenge(env.SESSION_SECRET, { sub: publicId, kind });
      expect((await change(wrong, chosen)).status, kind).toBe(401);
    }
    expect(await flag(publicId)).toBe(1);

    const off = await person("coordinator", { active: false });
    const offChallenge = await signChallenge(env.SESSION_SECRET, { sub: off.publicId, kind: "password" });
    expect((await change(offChallenge, chosen)).status).toBe(401);
    expect(email).toBeTruthy();
  });

  it("a challenge for someone whose flag is already clear is refused (nobody can use it to change a settled password)", async () => {
    const { publicId } = await person("coordinator", { flagged: false });
    const challenge = await signChallenge(env.SESSION_SECRET, { sub: publicId, kind: "password" });
    expect((await change(challenge, chosen)).status).toBe(401);
    // Refused before the password is even judged: no "too weak" answer for someone who has nothing to change.
    expect((await change(challenge, "a")).status).toBe(401);
  });

  it("a bad request body is 400", async () => {
    expect((await call("/api/auth/password/change-required", { challenge: "x" })).status).toBe(400);
    expect((await call("/api/auth/password/change-required", { nonsense: true })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------
describe("a password-change challenge opens nothing else", () => {
  it("the authenticator endpoints refuse it", async () => {
    const { email } = await person();
    const challenge = await challengeFor(email);
    for (const path of ["/api/auth/2fa/verify", "/api/auth/2fa/enable"]) {
      const response = await call(path, { challenge, code: "123456" });
      expect(response.status, path).toBe(401);
      expect(cookies(response), path).toEqual([]);
    }
    const setup = await call("/api/auth/2fa/setup", { challenge });
    expect(setup.status).toBe(401);
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
});
