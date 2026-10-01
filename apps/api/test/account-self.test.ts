import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { createUser } from "../src/modules/accounts/service";

/**
 * Settings (D-091): a person's own account. Everyone may change their own password (knowing the current one; wrong
 * guesses count toward the sign-in lockout; every other session ends). Staff may correct their own name and phone; a
 * student may not, because a student's personal details are corrected only by the Co-ordinator (CLAUDE.md section 6).
 */
const db = env.DB;
const app = createApp();
const PASS = "Mango-Sunrise-Harbour-4471";
const NEW = "Copper-Lantern-Meadow-9083";

let n = 0;
const call = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: { "Sec-Fetch-Site": "same-origin", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
  );
const cookiesOf = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

async function signedIn(role: "coordinator" | "teacher" | "student", phone: string | null = null) {
  const email = `${role}-self-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const scope = role === "student" ? "own" : role === "teacher" ? "assigned" : "institution";
  const { publicId } = await createUser(db, env.AUDIT_HMAC_KEY, { email, password: PASS, fullName: "First Name", roles: [{ role, scope }] });
  if (phone) await db.prepare("UPDATE users SET phone = ?1 WHERE public_id = ?2").bind(phone, publicId).run();
  const response = await call("/api/auth/sign-in", { method: "POST", body: { email, password: PASS } });
  expect(response.status).toBe(200);
  return { email, publicId, cookie: cookiesOf(response) };
}

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
});

describe("your profile", () => {
  it("shows your own name, email and phone, and whether you may change them", async () => {
    const staff = await signedIn("coordinator", "9800000001");
    const mine = (await (await call("/api/account/profile", { cookie: staff.cookie })).json()) as Record<string, unknown>;
    expect(mine).toEqual({ fullName: "First Name", email: staff.email, phone: "9800000001", canEditProfile: true });
    const student = await signedIn("student");
    expect(((await (await call("/api/account/profile", { cookie: student.cookie })).json()) as { canEditProfile: boolean }).canEditProfile).toBe(false);
    expect((await call("/api/account/profile")).status).toBe(401);
  });

  it("staff correct their own name and phone, recorded in the audit log", async () => {
    const staff = await signedIn("teacher");
    const saved = await call("/api/account/profile", { method: "PATCH", cookie: staff.cookie, body: { fullName: "  Sita Sharma ", phone: "9811111111" } });
    expect(saved.status).toBe(200);
    expect(await db.prepare("SELECT full_name, phone FROM users WHERE public_id = ?1").bind(staff.publicId).first()).toEqual({ full_name: "Sita Sharma", phone: "9811111111" });
    const audit = await db.prepare("SELECT action FROM audit_events WHERE entity_public_id = ?1 AND action = 'accounts.profile.updated'").bind(staff.publicId).first();
    expect(audit).toBeTruthy();
    expect((await call("/api/account/profile", { method: "PATCH", cookie: staff.cookie, body: { fullName: "Sita", phone: null } })).status).toBe(200);
    expect(await db.prepare("SELECT phone FROM users WHERE public_id = ?1").bind(staff.publicId).first()).toEqual({ phone: null });
  });

  it("refuses an empty name, an unknown field, and a change of email", async () => {
    const staff = await signedIn("coordinator");
    for (const body of [{ fullName: " ", phone: null }, { fullName: "Ok Name", phone: null, email: "new@school.example" }, { fullName: "Ok Name", phone: null, role: "admin" }]) {
      expect((await call("/api/account/profile", { method: "PATCH", cookie: staff.cookie, body })).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("a student cannot change their own details, and nothing is written", async () => {
    const student = await signedIn("student");
    expect((await call("/api/account/profile", { method: "PATCH", cookie: student.cookie, body: { fullName: "Changed", phone: null } })).status).toBe(403);
    expect(await db.prepare("SELECT full_name FROM users WHERE public_id = ?1").bind(student.publicId).first()).toEqual({ full_name: "First Name" });
  });
});

describe("changing your password", () => {
  const change = (cookie: string, currentPassword: string, newPassword: string) => call("/api/auth/password/change", { method: "POST", cookie, body: { currentPassword, newPassword } });

  it("needs the current password; the old one stops working and the new one signs in; other sessions end, this one stays", async () => {
    const person = await signedIn("student");
    const other = cookiesOf(await call("/api/auth/sign-in", { method: "POST", body: { email: person.email, password: PASS } }));

    const done = await change(person.cookie, PASS, NEW);
    expect(done.status).toBe(200);

    expect((await call("/api/auth/sign-in", { method: "POST", body: { email: person.email, password: PASS } })).status).toBe(401);
    expect((await call("/api/auth/sign-in", { method: "POST", body: { email: person.email, password: NEW } })).status).toBe(200);
    // This browser keeps its session; the other one is signed out at its next refresh.
    expect((await call("/api/auth/refresh", { method: "POST", cookie: person.cookie })).status).toBe(200);
    expect((await call("/api/auth/refresh", { method: "POST", cookie: other })).status).toBe(401);
    expect(await db.prepare("SELECT 1 AS ok FROM audit_events WHERE entity_public_id = ?1 AND action = 'accounts.password.changed'").bind(person.publicId).first()).toBeTruthy();
  });

  it("a wrong current password changes nothing and counts toward the sign-in lockout", async () => {
    const person = await signedIn("coordinator");
    const wrong = await change(person.cookie, "Not-The-Password-1234", NEW);
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({ error: "wrong_password" });
    const failures = await db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE email_tried = ?1 AND success = 0").bind(person.email).first<{ n: number }>();
    expect(failures!.n).toBe(1);
    for (let i = 0; i < 4; i++) await change(person.cookie, "Not-The-Password-1234", NEW);
    // Five wrong tries in fifteen minutes: even the right password is refused for now, and nothing is written.
    expect((await change(person.cookie, PASS, NEW)).status).toBe(429);
    expect((await call("/api/auth/sign-in", { method: "POST", body: { email: person.email, password: PASS } })).status).toBe(429);
  });

  it("refuses a weak password, one with the school's name, and the same password again", async () => {
    const person = await signedIn("teacher");
    const weak = await change(person.cookie, PASS, "short");
    expect(weak.status).toBe(422);
    expect(await weak.json()).toMatchObject({ error: "weak_password" });
    expect((await change(person.cookie, PASS, "RoyalSoftech-Lantern-2083")).status).toBe(422);
    expect((await change(person.cookie, PASS, PASS)).status).toBe(422);
    expect((await call("/api/auth/sign-in", { method: "POST", body: { email: person.email, password: PASS } })).status).toBe(200);
  });

  it("signed out, it is refused", async () => {
    expect((await call("/api/auth/password/change", { method: "POST", body: { currentPassword: PASS, newPassword: NEW } })).status).toBe(401);
  });
});

it("the audit chain is unbroken", async () => {
  expect((await verifyAuditChain(db, env.AUDIT_HMAC_KEY)).ok).toBe(true);
});
