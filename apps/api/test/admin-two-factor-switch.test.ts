import { env } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { requiresTwoFactor } from "../src/core/two-factor/policy";
import { createUser } from "../src/modules/accounts/service";

/**
 * The Admin's second step is a school setting (the PM, 2026-10-11, D-138): on for every school unless its pack says
 * `school.adminTwoFactor: false`, as the first school's Principal signs in with an ID and a password only. Support (the
 * Super Admin) always keeps the authenticator app, whatever the school says.
 */

const db = env.DB;
const app = createApp();
const password = "Mango-Sunrise-Harbour-4471";
let counter = 0;

async function person(role: "admin" | "super_admin" | "coordinator") {
  const email = `tf-${role}-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  await createUser(db, env.AUDIT_HMAC_KEY, { email, password, fullName: "Test Person", roles: [{ role, scope: "institution" }] });
  return email;
}
const signIn = async (email: string) =>
  (await app.request("https://school.example/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ email, password }) }, env)).json() as Promise<Record<string, unknown>>;
const setting = (on: boolean) => db.prepare("UPDATE school SET admin_two_factor = ?1 WHERE id = 1").bind(on ? 1 : 0).run();

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
});
afterAll(async () => {
  await setting(true);
});

describe("who needs a second step", () => {
  it("the Super Admin always does; the Admin does unless the school says otherwise; nobody else does", () => {
    expect(requiresTwoFactor([{ role: "super_admin" }], false)).toBe(true);
    expect(requiresTwoFactor([{ role: "admin" }])).toBe(true);
    expect(requiresTwoFactor([{ role: "admin" }], true)).toBe(true);
    expect(requiresTwoFactor([{ role: "admin" }], false)).toBe(false);
    expect(requiresTwoFactor([{ role: "coordinator" }, { role: "teacher" }], true)).toBe(false);
  });
});

describe("signing in", () => {
  it("by default an Admin is asked to set up the authenticator app, and gets no session yet", async () => {
    await setting(true);
    const body = await signIn(await person("admin"));
    expect(body).toMatchObject({ twoFactor: "setup" });
    expect(body).not.toHaveProperty("accessToken");
  });

  it("with the school's setting off, an Admin signs in with the ID and password alone: a session at once", async () => {
    await setting(false);
    const body = await signIn(await person("admin"));
    expect(body).not.toHaveProperty("twoFactor");
    expect(body).toMatchObject({ user: { fullName: "Test Person" } });
    expect(body.roles).toEqual([{ role: "admin", scope: "institution" }]);
  });

  it("with the setting off, Support (the Super Admin) is still asked for the authenticator app", async () => {
    await setting(false);
    expect(await signIn(await person("super_admin"))).toMatchObject({ twoFactor: "setup" });
  });

  it("a school with no row at all keeps the rule on", async () => {
    await setting(true);
    const email = await person("admin");
    await db.prepare("DELETE FROM school WHERE id = 1").run();
    try {
      expect(await signIn(email)).toMatchObject({ twoFactor: "setup" });
    } finally {
      await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
    }
  });
});

describe("the pack says it", () => {
  it("a pack leaves the Admin's second step on unless it says adminTwoFactor: false, and applying it sets the school's flag", async () => {
    const { applyPack, parsePack } = await import("../src/core/config");
    const royalPack = (await import("../../../packs/royal-softech/pack.json")).default;
    const { testPack, withAdminSecondStep } = await import("./programme-fixtures");
    expect(royalPack.school.adminTwoFactor).toBe(false); // Royal turned it off for now (D-184)
    const royal = withAdminSecondStep(royalPack);
    expect(parsePack(testPack(royal)).school.adminTwoFactor).toBe(true);
    const off = { ...testPack(royal), school: { ...testPack(royal).school, adminTwoFactor: false } };
    await applyPack(db, parsePack(off));
    expect((await db.prepare("SELECT admin_two_factor AS f FROM school WHERE id = 1").first<{ f: number }>())!.f).toBe(0);
    await applyPack(db, parsePack(testPack(royal)));
    expect((await db.prepare("SELECT admin_two_factor AS f FROM school WHERE id = 1").first<{ f: number }>())!.f).toBe(1);
  });
});
