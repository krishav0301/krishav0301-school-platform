import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { env } from "cloudflare:test";

import { GATE_FAILURE_LIMIT, signInGate } from "../src/modules/gate/signin";
import { auditActions, auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { codeAt, makeAccount, signInComputer, type Account } from "./gate-helpers";
import { setModule } from "./schoolday-helpers";

/**
 * Gate accounts and the computers signed in with them (D-176). The Admin makes an account: a special ID, a password and an
 * authenticator, shown once. Any number of computers sign in with it (ID, password, and a code that works once) and each
 * is given its own key. The sign-in is guarded like the staff one.
 */

let admin: Person, superAdmin: Person, coordinator: Person, accountant: Person, teacher: Person, student: Person;

beforeAll(async () => {
  await setModule("card_attendance", true);
  admin = await person("admin", "institution");
  superAdmin = await person("super_admin", "institution");
  coordinator = await person("coordinator", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
});

const meWith = (key: string) => call("/api/gate/me", { headers: { "x-gate-key": key } });
const scanWith = (key: string) => call("/api/gate/scan", { method: "POST", headers: { "x-gate-key": key }, body: { cardNumber: "ABCD1234", scanId: `scan-${crypto.randomUUID()}` } });
const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error("expected the sign-in to work");
  return result as Extract<T, { ok: true }>;
};

describe("making a gate account", () => {
  it("shows the login once: an ID, a password and an authenticator; the list never shows them again", async () => {
    const made = await call("/api/gate/accounts", { method: "POST", cookie: admin.cookie, body: { name: "Back gate" } });
    expect(made.status).toBe(201);
    const body = (await made.json()) as { id: string; name: string; gateId: string; password: string; authenticator: { secret: string; uri: string } };
    expect(body.gateId).toMatch(/^gate-[a-z2-9]{6}$/);
    expect(body.password).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.authenticator.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.authenticator.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(body.authenticator.uri).toContain(body.gateId);

    const list = await (await call("/api/gate/accounts", { cookie: admin.cookie })).text();
    expect(list).toContain("Back gate");
    expect(list).toContain(body.gateId);
    expect(list).not.toContain(body.password);
    expect(list).not.toContain(body.authenticator.secret);
  });

  it("stores the password only as a hash and the authenticator's secret only sealed, and writes neither to the audit log", async () => {
    const account = await makeAccount(admin, "Hidden secrets");
    const row = await db.prepare("SELECT password_hash, secret_sealed FROM gate_accounts WHERE public_id = ?1").bind(account.id).first<{ password_hash: string; secret_sealed: string }>();
    expect(row!.password_hash).not.toContain(account.password);
    expect(row!.secret_sealed).not.toContain(account.secret);
    const audit = await db.prepare("SELECT summary, before_json, after_json, reason FROM audit_events WHERE entity_public_id = ?1").bind(account.id).all<Record<string, string | null>>();
    expect(audit.results.length).toBe(1);
    expect(JSON.stringify(audit.results)).not.toContain(account.password);
    expect(JSON.stringify(audit.results)).not.toContain(account.secret);
    expect(await auditActions(account.id)).toEqual(["gate.account_created"]);
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });

  it("makes each account its own switched-off system user with no role, so it can never sign in", async () => {
    const account = await makeAccount(admin, "System user check");
    const row = await db
      .prepare("SELECT u.is_active, u.full_name, (SELECT COUNT(*) FROM role_assignments WHERE user_id = u.id) AS roles FROM gate_accounts a JOIN users u ON u.id = a.user_id WHERE a.public_id = ?1")
      .bind(account.id)
      .first<{ is_active: number; full_name: string; roles: number }>();
    expect(row).toEqual({ is_active: 0, full_name: "System user check", roles: 0 });
  });

  it("the Admin and Support may; the Co-ordinator, Accountant, a teacher and a student may not; nor a signed-out caller", async () => {
    expect((await call("/api/gate/accounts", { method: "POST", cookie: superAdmin.cookie, body: { name: "Support gate" } })).status).toBe(201);
    for (const who of [coordinator, accountant, teacher, student]) {
      expect((await call("/api/gate/accounts", { method: "POST", cookie: who.cookie, body: { name: "Not allowed" } })).status).toBe(403);
      expect((await call("/api/gate/accounts", { cookie: who.cookie })).status).toBe(403);
    }
    expect((await call("/api/gate/accounts", { method: "POST", body: { name: "Anyone" } })).status).toBe(401);
  });

  it("needs a name, and answers 'not found' while the cards module is off", async () => {
    expect((await call("/api/gate/accounts", { method: "POST", cookie: admin.cookie, body: { name: "x" } })).status).toBe(422);
    await setModule("card_attendance", false);
    expect((await call("/api/gate/accounts", { cookie: admin.cookie })).status).toBe(404);
    expect((await call("/api/gate/sign-in", { method: "POST", body: { gateId: "gate-abcdef", password: "x", code: "123456" } })).status).toBe(404);
    expect((await meWith("gk_anything-at-all-1234567890")).status).toBe(404);
    await setModule("card_attendance", true);
  });
});

describe("a computer signs in", () => {
  let account: Account;
  beforeAll(async () => {
    account = await makeAccount(admin, "Main gate");
  });

  it("with the ID, password and code, and is given a key that works", async () => {
    const result = ok(await signInComputer(account, { computer: "Front desk PC" }));
    expect(result.key).toMatch(/^gk_[A-Za-z0-9_-]{30,}$/);
    expect(result.account).toBe("Main gate");
    expect(result.computer.label).toBe("Front desk PC");
    const me = await meWith(result.key);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ account: "Main gate", computer: "Front desk PC" });
    // Only a hash of the key is stored.
    expect(await count("SELECT COUNT(*) AS n FROM gate_devices WHERE key_hash = ?1", result.key)).toBe(0);
  });

  it("the same account signs in on more than one computer, each with its own key", async () => {
    const one = ok(await signInComputer(account, { computer: "Gate 1" }));
    const two = ok(await signInComputer(account, { computer: "Gate 2" }));
    expect(one.key).not.toBe(two.key);
    expect((await meWith(one.key)).status).toBe(200);
    expect((await meWith(two.key)).status).toBe(200);
  });

  it("falls back to the browser's description when the computer is not named, and accepts the ID in capitals", async () => {
    const result = ok(await signInComputer(account, { input: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130", gateId: account.gateId.toUpperCase() } }));
    expect(result.computer.label).toContain("Chrome/130");
  });

  it("answers the same for a wrong password, a wrong code and an unknown ID, and makes no computer", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM gate_devices");
    const wrongPassword = await signInComputer(account, { input: { password: "WRONG-WRONG-WRONG" } });
    const wrongCode = await signInComputer(account, { input: { code: "000000" } });
    const unknown = await signInComputer(account, { input: { gateId: "gate-nobody" } });
    for (const r of [wrongPassword, wrongCode, unknown]) expect(r).toMatchObject({ ok: false, reason: "invalid_credentials" });
    expect(await count("SELECT COUNT(*) AS n FROM gate_devices")).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM sign_in_events WHERE email_tried = ?1 AND success = 0", `gate:${account.gateId}`)).toBeGreaterThanOrEqual(2);
  });

  it("a code works once: the same code again is refused, even with the right password", async () => {
    const first = await signInComputer(account);
    expect(first.ok).toBe(true);
    // The same code, at the same moment, with everything else right.
    const replay = await signInGate(env.DB, env.DATA_KEY, { gateId: account.gateId, password: account.password, code: codeAt(account.secret, first.at.getTime()), ip: null, userAgent: null }, first.at);
    expect(replay).toMatchObject({ ok: false, reason: "invalid_credentials" });
  });

  it("the real route signs in too, and answers 401 for a wrong login", async () => {
    const fresh = await makeAccount(admin, "Route gate");
    const good = await call("/api/gate/sign-in", { method: "POST", body: { gateId: fresh.gateId, password: fresh.password, code: codeAt(fresh.secret, Date.now()), computer: "Office" } });
    expect(good.status).toBe(200);
    const body = (await good.json()) as { key: string; account: string };
    expect(body.account).toBe("Route gate");
    expect((await meWith(body.key)).status).toBe(200);
    const bad = await call("/api/gate/sign-in", { method: "POST", body: { gateId: fresh.gateId, password: "WRONG", code: "123456" } });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "invalid_credentials" });
  });

  it("locks an ID after five wrong tries; a throttled try writes nothing and even the right login waits", async () => {
    const locked = await makeAccount(admin, "Lockout gate");
    for (let i = 0; i < GATE_FAILURE_LIMIT; i++) await signInComputer(locked, { input: { password: "WRONG-WRONG-WRONG" } });
    const events = await count("SELECT COUNT(*) AS n FROM sign_in_events WHERE email_tried = ?1", `gate:${locked.gateId}`);
    const result = await signInComputer(locked);
    expect(result).toMatchObject({ ok: false, reason: "throttled" });
    expect(await count("SELECT COUNT(*) AS n FROM sign_in_events WHERE email_tried = ?1", `gate:${locked.gateId}`)).toBe(events);

    const route = await call("/api/gate/sign-in", { method: "POST", body: { gateId: locked.gateId, password: locked.password, code: codeAt(locked.secret, Date.now()) } });
    expect(route.status).toBe(429);
  });
});

describe("signing computers out", () => {
  it("revoking one computer stops its key at once and leaves the others working; the audit log says so", async () => {
    const account = await makeAccount(admin, "Revoke gate");
    const one = ok(await signInComputer(account, { computer: "One" }));
    const two = ok(await signInComputer(account, { computer: "Two" }));
    expect((await call(`/api/gate/computers/${one.computer.id}/revoke`, { method: "POST", cookie: admin.cookie })).status).toBe(200);
    expect((await meWith(one.key)).status).toBe(401);
    expect((await scanWith(one.key)).status).toBe(401);
    expect((await meWith(two.key)).status).toBe(200);
    expect(await auditActions(one.computer.id)).toContain("gate.computer_revoked");
    // Revoking it again finds nothing; and it can sign in again with the account's login.
    expect((await call(`/api/gate/computers/${one.computer.id}/revoke`, { method: "POST", cookie: admin.cookie })).status).toBe(404);
    expect(ok(await signInComputer(account, { computer: "One again" })).key).not.toBe(one.key);
  });

  it("a new login replaces the password and the authenticator and signs every computer out", async () => {
    const account = await makeAccount(admin, "Reissue gate");
    const computer = ok(await signInComputer(account));
    const response = await call(`/api/gate/accounts/${account.id}/new-login`, { method: "POST", cookie: admin.cookie });
    expect(response.status).toBe(200);
    const next = (await response.json()) as { gateId: string; password: string; authenticator: { secret: string } };
    expect(next.gateId).toBe(account.gateId);
    expect(next.password).not.toBe(account.password);
    expect(next.authenticator.secret).not.toBe(account.secret);

    expect((await meWith(computer.key)).status).toBe(401);
    expect(await signInComputer(account)).toMatchObject({ ok: false });
    const fresh: Account = { ...account, password: next.password, secret: next.authenticator.secret };
    expect(ok(await signInComputer(fresh)).key).toMatch(/^gk_/);
    expect(JSON.stringify((await db.prepare("SELECT summary, before_json, after_json, reason FROM audit_events WHERE entity_public_id = ?1").bind(account.id).all()).results)).not.toContain(next.password);
  });

  it("disabling an account signs every computer out, refuses its login for good, and cannot be undone", async () => {
    const account = await makeAccount(admin, "Disable gate");
    const computer = ok(await signInComputer(account));
    expect((await call(`/api/gate/accounts/${account.id}/disable`, { method: "POST", cookie: admin.cookie })).status).toBe(200);
    expect((await meWith(computer.key)).status).toBe(401);
    expect(await signInComputer(account)).toMatchObject({ ok: false, reason: "invalid_credentials" });
    expect((await call(`/api/gate/accounts/${account.id}/disable`, { method: "POST", cookie: admin.cookie })).status).toBe(404);
    expect((await call(`/api/gate/accounts/${account.id}/new-login`, { method: "POST", cookie: admin.cookie })).status).toBe(404);
    await expect(db.prepare("UPDATE gate_accounts SET status = 'active', disabled_at = NULL, disabled_by_user_id = NULL WHERE public_id = ?1").bind(account.id).run()).rejects.toThrow();
    expect(await auditActions(account.id)).toContain("gate.account_disabled");
  });

  it("only the Admin and Support can sign computers out or issue a new login", async () => {
    const account = await makeAccount(admin, "Rights gate");
    const computer = ok(await signInComputer(account));
    for (const who of [coordinator, accountant, teacher, student]) {
      expect((await call(`/api/gate/computers/${computer.computer.id}/revoke`, { method: "POST", cookie: who.cookie })).status).toBe(403);
      expect((await call(`/api/gate/accounts/${account.id}/new-login`, { method: "POST", cookie: who.cookie })).status).toBe(403);
      expect((await call(`/api/gate/accounts/${account.id}/disable`, { method: "POST", cookie: who.cookie })).status).toBe(403);
    }
    expect((await meWith(computer.key)).status).toBe(200);
  });
});
