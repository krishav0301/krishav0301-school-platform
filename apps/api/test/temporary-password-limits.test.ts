import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { hashPassword } from "../src/core/passwords";
import { createUser } from "../src/modules/accounts/service";
import { issueTemporaryPassword } from "../src/modules/accounts/staff";

/**
 * A temporary password is 4 digits (the PM, 2026-10-10), which is easy to guess, so it stops working 24 hours after
 * it is issued and after 3 wrong tries. A new one from People & Access clears both.
 */

const db = env.DB;
const app = createApp();
const temporary = "4821";

let counter = 0;
async function person(expiresInHours: number | null = 24) {
  const email = `limits-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const { publicId } = await createUser(db, env.AUDIT_HMAC_KEY, { email, password: "Mango-Sunrise-Harbour-4471", fullName: "New Person", roles: [{ role: "coordinator", scope: "institution" }] });
  const expires = expiresInHours === null ? null : new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  // The policy would refuse 4 digits as a chosen password; a generated temporary one is stored the same way, hashed.
  await db.prepare("UPDATE users SET password_hash = ?3, must_change_password = 1, temporary_password_expires_at = ?2 WHERE public_id = ?1").bind(publicId, expires, hashPassword(temporary)).run();
  return { email, publicId };
}
const signIn = (email: string, password = temporary) =>
  app.request("https://school.example/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ email, password }) }, env);
const state = (publicId: string) => db.prepare("SELECT temporary_password_failures AS f FROM users WHERE public_id = ?1").bind(publicId).first<{ f: number }>();

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
});

describe("a 4-digit temporary password is limited", () => {
  it("works within 24 hours", async () => {
    const { email } = await person(23);
    expect(await (await signIn(email)).json()).toMatchObject({ passwordChange: "required" });
  });

  it("is refused after it expires, even though it is right", async () => {
    const { email, publicId } = await person(-1);
    expect((await signIn(email)).status).toBe(401);
    expect(await state(publicId)).toEqual({ f: 0 }); // an expired one is not a guess
  });

  it("is refused after 3 wrong tries, even when the right one comes next", async () => {
    const { email, publicId } = await person();
    for (const guess of ["0000", "1111", "2222"]) expect((await signIn(email, guess)).status).toBe(401);
    expect(await state(publicId)).toEqual({ f: 3 });
    expect((await signIn(email)).status).toBe(401);
    expect(await state(publicId)).toEqual({ f: 3 }); // a refused try is not counted again
  });

  it("two wrong tries and then the right one still works", async () => {
    const { email } = await person();
    for (const guess of ["0000", "1111"]) expect((await signIn(email, guess)).status).toBe(401);
    expect(await (await signIn(email)).json()).toMatchObject({ passwordChange: "required" });
  });

  it("an older temporary password with no expiry keeps working", async () => {
    const { email } = await person(null);
    expect(await (await signIn(email)).json()).toMatchObject({ passwordChange: "required" });
  });

  it("a new one from People & Access clears the expiry and the wrong tries", async () => {
    const { email, publicId } = await person(-1);
    for (const guess of ["0000", "1111", "2222"]) await signIn(email, guess);
    const admin = await createUser(db, env.AUDIT_HMAC_KEY, { email: `limits-admin-${crypto.randomUUID().slice(0, 6)}@school.example`, password: "Mango-Sunrise-Harbour-4471", fullName: "Admin", roles: [{ role: "admin", scope: "institution" }] });
    const issued = await issueTemporaryPassword(db, env.AUDIT_HMAC_KEY, admin.publicId, publicId);
    if (!issued.ok) throw new Error(`issue: ${JSON.stringify(issued)}`);
    expect(issued.temporaryPassword).toMatch(/^[0-9]{4}$/);
    expect(await state(publicId)).toEqual({ f: 0 });
    expect(await (await signIn(email, issued.temporaryPassword)).json()).toMatchObject({ passwordChange: "required" });
  });

  it("a person with a normal password is not affected by the tries counter", async () => {
    const { email, publicId } = await person();
    await db.prepare("UPDATE users SET must_change_password = 0 WHERE public_id = ?1").bind(publicId).run();
    expect((await signIn(email, "9999")).status).toBe(401);
    expect(await state(publicId)).toEqual({ f: 0 });
  });
});
