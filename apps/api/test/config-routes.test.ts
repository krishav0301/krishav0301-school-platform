/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately poke at loosely-typed and malformed data */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, loadConfig } from "../src/core/config";
import { testPack } from "./programme-fixtures";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

// This file starts with an unprovisioned database, on purpose.
const db = env.DB;
const app = createApp();
const password = "blue-river-lamp-2083";

const call = (path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    env,
  );

async function cookieFor(publicId: string, roles: RoleClaim[]) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles, iat: now, exp: now + 600 });
  return `__Host-access=${token}`;
}

const activeThemeName = async () =>
  (await db.prepare("SELECT name FROM themes WHERE is_active = 1").first<{ name: string }>())?.name;
const auditCount = async (action: string) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = ?1").bind(action).first<{ n: number }>())!.n;

// ---------------------------------------------------------------------------------------------
describe("GET /api/config/public", () => {
  it("says the school is not set up yet, and must not be cached", async () => {
    const response = await call("/api/config/public");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_provisioned" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("once set up, serves the configuration to anyone, with no sign-in", async () => {
    await applyPack(db, testPack(royalJson));
    const response = await call("/api/config/public");
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.school.name).toBe("Royal Softech College");
    expect(body.sections).toEqual([{ key: "plus2", name: "+2" }, { key: "bachelors", name: "Bachelor's" }]);
    expect(body.theme.font).toBe("inter");
    expect(body.terms["role.coordinator"]).toBe("Co-ordinator");
    expect(body.modules.attendance).toBe(true);
    expect(body.modules.fees).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("nothing private is in it", async () => {
    const text = JSON.stringify(await (await call("/api/config/public")).json());
    for (const secret of ["password", "hash", "email", "AUDIT_HMAC_KEY", "SESSION_SECRET", "token"]) {
      expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
  });

  it("follows the pack: a different school gets different name, wording, modules and look", async () => {
    await applyPack(db, testPack(sampleJson));
    const body = (await (await call("/api/config/public")).json()) as Record<string, any>;

    expect(body.school.name).toBe("Sample Basic School");
    expect(body.terms["role.coordinator"]).toBe("Vice Principal");
    expect(body.modules.notes).toBe(false);
    expect(body.modules.fees).toBe(true); // mandatory, whatever a pack says
    expect(body.theme.font).toBe("noto-sans");
    expect(body.theme.dark).toBeUndefined();

    await applyPack(db, testPack(royalJson)); // back to Royal for the tests below
  });
});

describe("the configuration is read in one database round trip", () => {
  /** A stand-in database that answers canned rows, and fails if anything is executed one by one. */
  function fakeDb() {
    let batches = 0;
    const statement = (sql: string) => ({
      sql,
      bind: () => statement(sql),
      first: () => Promise.reject(new Error("a statement was run outside the batch")),
      run: () => Promise.reject(new Error("a statement was run outside the batch")),
      all: () => Promise.reject(new Error("a statement was run outside the batch")),
      raw: () => Promise.reject(new Error("a statement was run outside the batch")),
    });
    const rows = (sql: string) =>
      sql.includes("FROM school")
        ? [{ name: "Fake School", short_name: "Fake", currency: "NPR", timezone: "Asia/Kathmandu", region_pack: "nepal", template_key: null }]
        : sql.includes("FROM sections") ? [{ key: "main", name: "Main" }]
        : [];
    return {
      trips: () => batches,
      db: {
        prepare: (sql: string) => statement(sql),
        batch: async (statements: { sql: string }[]) => {
          batches++;
          return statements.map((s) => ({ results: rows(s.sql), success: true, meta: {} }));
        },
      } as unknown as D1Database,
    };
  }

  it("all five reads travel in one batch and nothing runs separately", async () => {
    const { db: fake, trips } = fakeDb();
    const config = await loadConfig(fake);

    expect(trips()).toBe(1);
    expect(config!.school.name).toBe("Fake School");
    expect(config!.theme).toBeNull();
  });

  it("the route itself makes that one trip", async () => {
    const { db: fake, trips } = fakeDb();
    const response = await app.request("/api/config/public", {}, { ...env, DB: fake });

    expect(response.status).toBe(200);
    expect(trips()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("PUT /api/config/theme", () => {
  const royalTheme = royalJson.theme;
  const newTheme = { ...royalTheme, name: "A calmer green", light: { ...royalTheme.light, primary: "#0f766e" } };

  async function makeSuperAdmin() {
    const { publicId } = await createUser(db, env.AUDIT_HMAC_KEY, {
      email: `super-${crypto.randomUUID().slice(0, 8)}@school.example`,
      password,
      fullName: "Support Person",
      roles: [{ role: "super_admin", scope: "institution" }],
    });
    return { publicId, cookie: await cookieFor(publicId, [{ role: "super_admin", scope: "institution" }]) };
  }

  it("saves a readable theme for a Super Admin, makes it active, and writes an audit entry naming them", async () => {
    const { publicId, cookie } = await makeSuperAdmin();
    const before = await auditCount("config.theme.changed");

    const response = await call("/api/config/theme", { method: "PUT", cookie, body: newTheme });

    expect(response.status).toBe(200);
    expect(await activeThemeName()).toBe("A calmer green");
    expect((await loadConfig(db))!.theme!.light.primary).toBe("#0f766e");
    expect(await auditCount("config.theme.changed")).toBe(before + 1);

    const audit = await db
      .prepare("SELECT a.summary, u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.action = 'config.theme.changed' ORDER BY a.id DESC")
      .first<{ summary: string; actor: string }>();
    expect(audit).toEqual({ summary: 'Theme changed to "A calmer green"', actor: publicId });
    expect(await verifyAuditChain(db, env.AUDIT_HMAC_KEY)).toMatchObject({ ok: true });
  });

  it("keeps the previous theme (no deletes) and only ever one active", async () => {
    const themes = await db.prepare("SELECT COUNT(*) AS n FROM themes").first<{ n: number }>();
    const active = await db.prepare("SELECT COUNT(*) AS n FROM themes WHERE is_active = 1").first<{ n: number }>();
    expect(themes!.n).toBeGreaterThanOrEqual(2);
    expect(active!.n).toBe(1);
  });

  it("refuses an unreadable theme with 422, names every failure, and changes nothing", async () => {
    const { cookie } = await makeSuperAdmin();
    const nameBefore = await activeThemeName();
    const auditBefore = await auditCount("config.theme.changed");
    const unreadable = { ...royalTheme, name: "Pale grey", light: { ...royalTheme.light, text: "#dcdcdc", textMuted: "#e6e6e6" } };

    const response = await call("/api/config/theme", { method: "PUT", cookie, body: unreadable });
    const body = (await response.json()) as { error: string; failures: { mode: string; rule: string; ratio: number; minimum: number }[] };

    expect(response.status).toBe(422);
    expect(body.error).toBe("contrast_check_failed");
    expect(body.failures.map((f) => f.rule)).toEqual(expect.arrayContaining(["text-on-background", "text-on-surface", "muted-on-background"]));
    for (const f of body.failures) {
      expect(f.mode).toBe("light");
      expect(f.ratio).toBeLessThan(f.minimum);
    }
    expect(await activeThemeName()).toBe(nameBefore);
    expect(await auditCount("config.theme.changed")).toBe(auditBefore);
  });

  it("refuses a bad body with 400 and changes nothing", async () => {
    const { cookie } = await makeSuperAdmin();
    const nameBefore = await activeThemeName();

    for (const body of [
      { ...newTheme, font: "Comic Sans" },
      { ...newTheme, light: { ...newTheme.light, primary: "blue" } },
      { ...newTheme, backgroundImage: "url(x)" },
      {},
    ]) {
      expect((await call("/api/config/theme", { method: "PUT", cookie, body })).status).toBe(400);
    }
    expect(await activeThemeName()).toBe(nameBefore);
  });

  it.each([
    ["an Admin", [{ role: "admin", scope: "institution" }]],
    ["a Co-ordinator", [{ role: "coordinator", scope: "institution" }]],
    ["an Accountant", [{ role: "accountant", scope: "institution" }]],
    ["a Teacher", [{ role: "teacher", scope: "assigned" }]],
    ["a Student", [{ role: "student", scope: "own" }]],
  ] as [string, RoleClaim[]][])("refuses %s with 403: only the Super Admin changes branding", async (_who, roles) => {
    const nameBefore = await activeThemeName();
    const response = await call("/api/config/theme", { method: "PUT", cookie: await cookieFor("someone", roles), body: newTheme });

    expect(response.status).toBe(403);
    expect(await activeThemeName()).toBe(nameBefore);
  });

  it("refuses someone who is not signed in with 401", async () => {
    expect((await call("/api/config/theme", { method: "PUT", body: newTheme })).status).toBe(401);
  });

  it("checks who you are before it looks at what you sent: no hints about the body for outsiders", async () => {
    const anonymous = await call("/api/config/theme", { method: "PUT", body: {} });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });

    const student = await call("/api/config/theme", { method: "PUT", cookie: await cookieFor("s", [{ role: "student", scope: "own" }]), body: {} });
    expect(student.status).toBe(403);
    expect(await student.json()).toEqual({ error: "forbidden" });
  });

  it("refuses a request from another website, even for a Super Admin", async () => {
    const { cookie } = await makeSuperAdmin();
    const response = await call("/api/config/theme", {
      method: "PUT",
      cookie,
      body: newTheme,
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request_refused" });
  });

  it("the contract lists the route, so the web client can be generated for it", async () => {
    const spec = createApp().getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } });
    expect(Object.keys(spec.paths ?? {})).toEqual(expect.arrayContaining(["/api/config/public", "/api/config/theme"]));
  });
});
