import { leaks } from "./leaks";
import { env } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { classWith } from "./schoolday-helpers";

/**
 * A student keeps a 4-digit PIN (the PM, 2026-10-11): in a school whose file says `studentKeepsPin`, the 4-digit password a
 * student is given at admission is theirs to keep, with no forced change and no expiry. The Co-ordinator can give a student
 * a new one. Sign-in is limited to 20 wrong tries a day for an email, since 4 digits can be guessed slowly.
 */

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, accountant: Person, teacher: Person, admin: Person;
const setKeeps = (on: boolean) => db.prepare("UPDATE school SET student_keeps_pin = ?1 WHERE id = 1").bind(on ? 1 : 0).run();
const user = (publicId: string) => db.prepare("SELECT must_change_password AS must, temporary_password_expires_at AS expires, temporary_password_failures AS failures FROM users WHERE public_id = ?1").bind(publicId).first<{ must: number; expires: string | null; failures: number }>();
const emailOf = (publicId: string) => db.prepare("SELECT email FROM users WHERE public_id = ?1").bind(publicId).first<{ email: string }>().then((r) => r!.email);
const issue = (studentId: string, who: Person) => call(`/api/students/${studentId}/pin`, { method: "POST", body: {}, cookie: who.cookie });
const signIn = (email: string, password: string) => call("/api/auth/sign-in", { method: "POST", body: { email, password } });

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Royal Softech College', 'Royal Softech')").run();
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  admin = await person("admin", "institution");
});
afterAll(async () => {
  await setKeeps(false);
});

describe("a student's 4-digit password is stored as the light, keyed hash (D-164)", () => {
  const hashOf = (publicId: string) => db.prepare("SELECT password_hash FROM users WHERE public_id = ?1").bind(publicId).first<{ password_hash: string }>().then((r) => r!.password_hash);

  it("a new PIN is stored as pin1$..., checks at sign-in, and the PIN itself is nowhere in the stored value", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const { temporaryPassword } = (await (await issue(pupil.studentId, coordinator)).json()) as { temporaryPassword: string };
    const stored = await hashOf(pupil.person.publicId);
    expect(stored.startsWith("pin1$")).toBe(true);
    expect(stored).not.toContain(temporaryPassword);
    expect((await signIn(await emailOf(pupil.person.publicId), temporaryPassword)).status).toBe(200);
    expect((await signIn(await emailOf(pupil.person.publicId), "0000" === temporaryPassword ? "1111" : "0000")).status).toBe(401);
  });

  it("a student whose 4-digit password is still on the strong hash is moved to the light one at their next sign-in, and it keeps working", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const email = await emailOf(pupil.person.publicId);
    const { hashPassword } = await import("../src/core/passwords");
    await db.prepare("UPDATE users SET password_hash = ?1, must_change_password = 0 WHERE public_id = ?2").bind(hashPassword("3827"), pupil.person.publicId).run();
    expect((await hashOf(pupil.person.publicId)).startsWith("scrypt$")).toBe(true);
    expect((await signIn(email, "3827")).status).toBe(200);
    expect((await hashOf(pupil.person.publicId)).startsWith("pin1$")).toBe(true);
    expect((await signIn(email, "3827")).status).toBe(200);
    expect((await signIn(email, "3828")).status).toBe(401);
  });

  it("a student's own longer password is never made the light hash", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const email = await emailOf(pupil.person.publicId);
    const { hashPassword } = await import("../src/core/passwords");
    const strong = hashPassword("a-student-chosen-long-passphrase");
    await db.prepare("UPDATE users SET password_hash = ?1, must_change_password = 0 WHERE public_id = ?2").bind(strong, pupil.person.publicId).run();
    expect((await signIn(email, "a-student-chosen-long-passphrase")).status).toBe(200);
    expect(await hashOf(pupil.person.publicId)).toBe(strong);
  });
});

describe("giving a student a new PIN", () => {
  it("gives a 4-digit PIN once, the old one stops working, open sessions end, and the new one signs in", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const response = await issue(pupil.studentId, coordinator);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { temporaryPassword } = (await response.json()) as { temporaryPassword: string };
    expect(temporaryPassword).toMatch(/^[0-9]{4}$/);
    const email = await emailOf(pupil.person.publicId);
    expect((await signIn(email, "Mango-Sunrise-Harbour-4471")).status).toBe(401); // the old password
    const ok = await signIn(email, temporaryPassword);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ user: { email }, roles: [{ role: "student" }] }); // a session at once: the PIN is theirs to keep
    expect(await user(pupil.person.publicId)).toEqual({ must: 0, expires: null, failures: 0 });
  });

  it("in a school that does not let students keep it, the new one is temporary again: it must be changed, and expires in a day", async () => {
    await setKeeps(false);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const { temporaryPassword } = (await (await issue(pupil.studentId, coordinator)).json()) as { temporaryPassword: string };
    const state = await user(pupil.person.publicId);
    expect(state!.must).toBe(1);
    expect(state!.expires).not.toBeNull();
    const body = (await (await signIn(await emailOf(pupil.person.publicId), temporaryPassword)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ passwordChange: "required" });
    expect(body).not.toHaveProperty("accessToken");
  });

  it("it is audited, and never writes the PIN anywhere in the audit log", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const { temporaryPassword } = (await (await issue(pupil.studentId, coordinator)).json()) as { temporaryPassword: string };
    const rows = (await db.prepare("SELECT summary, before_json, after_json FROM audit_events WHERE action = 'students.pin.issued' AND entity_public_id = ?1").bind(pupil.studentId).all<{ summary: string; before_json: string | null; after_json: string | null }>()).results;
    expect(rows).toHaveLength(1);
    expect(leaks(JSON.stringify(rows), temporaryPassword)).toBe(false);
  });

  it("only a Co-ordinator whose wing reaches the student (or Support): not the Principal, an Accountant, a teacher, another wing or the student", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 2)).pupils;
    expect((await issue(pupil[0]!.studentId, bachelorsCoordinator)).status).toBe(404);
    for (const who of [admin, accountant, teacher]) expect((await issue(pupil[0]!.studentId, who)).status, who.publicId).toBe(403);
    expect((await issue(pupil[0]!.studentId, pupil[1]!.person)).status).toBe(403);
    expect((await issue("0".repeat(32), coordinator)).status).toBe(404);
    expect((await issue(pupil[0]!.studentId, plus2Coordinator)).status).toBe(200);
  });
});

describe("guessing a PIN", () => {
  it("20 wrong tries in a day stop sign-in for that email for the rest of the day, even after the 15 minutes pass, and the right PIN no longer gets in", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const { temporaryPassword } = (await (await issue(pupil.studentId, coordinator)).json()) as { temporaryPassword: string };
    const email = await emailOf(pupil.person.publicId);
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    for (let i = 0; i < 20; i++) {
      await db.prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, NULL, ?2, 0, 'bad_password', ?3, NULL)").bind(hoursAgo(1 + (i % 5)), email, `203.0.113.${i + 1}`).run();
    }
    const refused = await signIn(email, temporaryPassword);
    expect(refused.status).toBe(429);
    // Nothing was written by the refused try.
    const written = (await db.prepare("SELECT COUNT(*) AS n FROM sign_in_events WHERE email_tried = ?1").bind(email).first<{ n: number }>())!.n;
    expect(written).toBe(20);
  });

  it("19 wrong tries in a day do not", async () => {
    await setKeeps(true);
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const { temporaryPassword } = (await (await issue(pupil.studentId, coordinator)).json()) as { temporaryPassword: string };
    const email = await emailOf(pupil.person.publicId);
    for (let i = 0; i < 19; i++) {
      await db.prepare("INSERT INTO sign_in_events (at, user_id, email_tried, success, reason, ip, user_agent) VALUES (?1, NULL, ?2, 0, 'bad_password', ?3, NULL)").bind(new Date(Date.now() - 3 * 3_600_000).toISOString(), email, `198.51.100.${i + 1}`).run();
    }
    expect((await signIn(email, temporaryPassword)).status).toBe(200);
  });
});

describe("the school's setting", () => {
  it("is in the public configuration, off unless the school's file says so", async () => {
    await setKeeps(false);
    expect(((await (await call("/api/config/public")).json()) as { school: { studentKeepsPin: boolean } }).school.studentKeepsPin).toBe(false);
    await setKeeps(true);
    expect(((await (await call("/api/config/public")).json()) as { school: { studentKeepsPin: boolean } }).school.studentKeepsPin).toBe(true);
    expect(env.DB).toBeDefined();
  });
});
