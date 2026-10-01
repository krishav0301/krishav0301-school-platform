/**
 * The Phase 1 exit check (docs/build-plan.md): the whole foundation working together, for BOTH
 * schools, through the real HTTP API and the real database schema, with nothing simulated.
 *
 *  - both packs start a school, and their configuration reads back
 *  - every one of the six roles signs in (the Super Admin through two-step sign-in)
 *  - a role that should not act is refused, and a section-scoped person reaches only their section
 *  - the theme can be swapped live, and an unreadable one is refused
 *  - password reset works and its email names the right school
 *  - the audit log is still an unbroken chain after all of it
 */
import { env } from "cloudflare:test";
import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, type Pack } from "../src/core/config";
import { testPack } from "./programme-fixtures";
import { schoolNameWords } from "../src/core/passwords";
import { allowedSections, authorize, canAccessSection } from "../src/core/permissions";
import { runOutbox } from "../src/core/notifications";
import type { RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const password = "blue-river-lamp-2083";
const app = createApp();

const codeAt = (secret: string, ms: number) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" }).generate({ timestamp: ms });

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("foundation exit check: $label", ({ json, database }) => {
  const pack: Pack = testPack(json);
  const db = () => database();
  const bindings = () => ({ ...env, DB: db() });

  const call = (path: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: options.method ?? "POST",
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      bindings(),
    );
  const cookiesFrom = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

  const people: Record<string, { email: string; publicId: string; cookie: string; roles: RoleClaim[] }> = {};
  const firstSection = pack.sections[0]!.key;
  const roles: [string, RoleClaim][] = [
    ["student", { role: "student", scope: "own" }],
    ["teacher", { role: "teacher", scope: "assigned" }],
    ["coordinator", { role: "coordinator", scope: "institution" }],
    ["accountant", { role: "accountant", scope: "section", section: firstSection }],
    ["admin", { role: "admin", scope: "institution" }],
    ["super_admin", { role: "super_admin", scope: "institution" }],
  ];

  it("the school starts from its pack, and everyone can read its public configuration", async () => {
    await applyPack(db(), pack);
    const response = await call("/api/config/public", { method: "GET" });
    const body = (await response.json()) as { school: { name: string }; sections: { key: string }[]; theme: { name: string } };

    expect(response.status).toBe(200);
    expect(body.school.name).toBe(pack.school.name);
    expect(body.sections.map((s) => s.key)).toEqual(expect.arrayContaining(pack.sections.map((s) => s.key)));
    expect(body.theme.name).toBe(pack.theme.name);
  });

  it("every role signs in, and the session says exactly what was granted", async () => {
    const avoidWords = schoolNameWords([pack.school.name, pack.school.shortName]);
    for (const [name, claim] of roles) {
      const email = `${name}-exit-${crypto.randomUUID().slice(0, 6)}@school.example`;
      const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
        email,
        password,
        fullName: `${name} person`,
        roles: [{ role: claim.role as never, scope: claim.scope, ...(claim.section ? { sectionKey: claim.section } : {}) }],
        avoidWords,
      });

      const signIn = await call("/api/auth/sign-in", { body: { email, password } });
      const first = (await signIn.json()) as { twoFactor?: string; challenge?: string };
      let cookie: string;

      if (name === "super_admin" || name === "admin") {
        // The Super Admin and the Admin (D-038) must set up the authenticator app before getting a session.
        expect(first.twoFactor, `${name} is asked to set up`).toBe("setup");
        expect(signIn.headers.getSetCookie()).toHaveLength(0);
        const setup = (await (await call("/api/auth/2fa/setup", { body: { challenge: first.challenge } })).json()) as { secret: string };
        const enable = await call("/api/auth/2fa/enable", { body: { challenge: first.challenge, code: codeAt(setup.secret, Date.now()) } });
        expect(enable.status).toBe(200);
        expect(((await enable.json()) as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10);
        cookie = cookiesFrom(enable);

        // And the next time, the password alone is not enough.
        const again = (await (await call("/api/auth/sign-in", { body: { email, password } })).json()) as { twoFactor?: string; challenge?: string };
        expect(again.twoFactor, "next sign-in asks for the code").toBe("required");
        const verified = await call("/api/auth/2fa/verify", { body: { challenge: again.challenge, code: codeAt(setup.secret, Date.now() + 30_000) } });
        expect(verified.status).toBe(200);
        cookie = cookiesFrom(verified);
      } else {
        expect(signIn.status, name).toBe(200);
        expect(first.twoFactor, `${name} needs no second step`).toBeUndefined();
        cookie = cookiesFrom(signIn);
      }

      const me = (await (await call("/api/auth/me", { method: "GET", cookie })).json()) as { roles: RoleClaim[] };
      expect(me.roles, name).toEqual([claim]);
      people[name] = { email, publicId, cookie, roles: me.roles };
    }
    expect(Object.keys(people)).toHaveLength(6);
  });

  it("only the Super Admin may change the look: every other role is refused, and nothing changes", async () => {
    const before = ((await (await call("/api/config/public", { method: "GET" })).json()) as { theme: { name: string } }).theme.name;
    const swap = { ...pack.theme, name: "Exit check theme" };

    for (const name of ["student", "teacher", "coordinator", "accountant", "admin"]) {
      const response = await call("/api/config/theme", { method: "PUT", body: swap, cookie: people[name]!.cookie });
      expect(response.status, name).toBe(403);
    }
    expect(((await (await call("/api/config/public", { method: "GET" })).json()) as { theme: { name: string } }).theme.name).toBe(before);
  });

  it("only the Super Admin may reset someone's two-step sign-in; nobody may reset their own", async () => {
    const target = people.super_admin!.publicId;
    for (const name of ["student", "teacher", "coordinator", "accountant", "admin"]) {
      expect((await call(`/api/users/${target}/two-factor/reset`, { cookie: people[name]!.cookie })).status, name).toBe(403);
    }
    expect((await call(`/api/users/${target}/two-factor/reset`, { cookie: people.super_admin!.cookie })).status).toBe(400);
    expect((await call(`/api/users/${target}/two-factor/reset`)).status).toBe(401);
  });

  it("a section-scoped person, signed in for real, reaches their section and no other", async () => {
    const grant = authorize(people.accountant!.roles, "fees.cash.record");
    expect(grant).not.toBeNull();
    expect(allowedSections(grant!)).toEqual([firstSection]);
    expect(canAccessSection(grant!, firstSection)).toBe(true);
    expect(canAccessSection(grant!, "some_other_section")).toBe(false);

    // A Co-ordinator with whole-institution scope reaches everything, and cannot do the Accountant's job.
    expect(authorize(people.coordinator!.roles, "fees.cash.record")).toBeNull();
    // A Student has no staff reach at all.
    expect(authorize(people.student!.roles, "fees.cash.record")).toBeNull();
  });

  it("the Super Admin swaps the theme live: readable ones take effect at once, an unreadable one is refused", async () => {
    const cookie = people.super_admin!.cookie;
    const swapped = { ...pack.theme, name: "Exit check theme", light: { ...pack.theme.light, primary: "#0f766e", primaryText: "#ffffff" } };
    expect((await call("/api/config/theme", { method: "PUT", body: swapped, cookie })).status).toBe(200);
    const live = (await (await call("/api/config/public", { method: "GET" })).json()) as { theme: { name: string; light: { primary: string } } };
    expect(live.theme).toMatchObject({ name: "Exit check theme", light: { primary: "#0f766e" } });

    const unreadable = { ...swapped, name: "Pale", light: { ...swapped.light, text: "#dcdcdc" } };
    const refused = await call("/api/config/theme", { method: "PUT", body: unreadable, cookie });
    expect(refused.status).toBe(422);
    expect(((await (await call("/api/config/public", { method: "GET" })).json()) as { theme: { name: string } }).theme.name).toBe("Exit check theme");
  });

  it("a forgotten password can be reset by email, and the email names this school", async () => {
    const person = people.student!;
    expect((await call("/api/auth/password-reset/request", { body: { email: person.email } })).status).toBe(202);
    for (let i = 0; i < 20; i++) if ((await runOutbox(bindings())).processed === 0) break;

    const mail = await db().prepare("SELECT subject, body FROM dev_mailbox WHERE to_email = ?1 ORDER BY id DESC LIMIT 1").bind(person.email).first<{ subject: string; body: string }>();
    expect(mail!.subject).toBe(`Reset your password for ${pack.school.name}`);
    const token = mail!.body.match(/#token=([A-Za-z0-9_-]+)/)![1];

    expect((await call("/api/auth/password-reset/confirm", { body: { token, password: "new-green-mountain-tea-77" } })).status).toBe(204);
    expect((await call("/api/auth/sign-in", { body: { email: person.email, password } })).status).toBe(401); // old password gone
    expect((await call("/api/auth/sign-in", { body: { email: person.email, password: "new-green-mountain-tea-77" } })).status).toBe(200);
    // The old session is over: it cannot be renewed. (The 30-minute access cookie is stateless and simply
    // runs out; that documented limit is why money and approval actions re-check the person themselves.)
    expect((await call("/api/auth/refresh", { cookie: person.cookie })).status).toBe(401);
  });

  it("after all of that, the audit log is one unbroken, untampered chain", async () => {
    const result = await verifyAuditChain(db(), env.AUDIT_HMAC_KEY);
    expect(result).toMatchObject({ ok: true });
    expect((result as { count: number }).count).toBeGreaterThanOrEqual(9); // accounts, two-step, theme, password reset
  });
});
