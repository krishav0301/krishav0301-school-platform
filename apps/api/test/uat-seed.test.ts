/**
 * The UAT starter set (D-086), for both schools, through the real API: what it makes, that its people can sign in
 * through the first-password flow, that the fees reached the students, and that it refuses to run twice.
 */
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, parsePack } from "../src/core/config";
import { bsToAd, daysInMonth, todayBs } from "../src/core/dates";
import { signAccessToken } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { seedUat, SeedError, type Actor, type Call } from "../scripts/uat/seed";
import { seedProgrammes } from "./programme-fixtures";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

// These walk a whole school year, hashing many passwords on purpose-slow scrypt; with every test file running in
// parallel they can pass the 60 s default on a busy machine (seen 2026-10-01), so they get three minutes.
vi.setConfig({ testTimeout: 180_000 });

const app = createApp();

describe.each([
  { label: "Royal Softech", json: royalJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, database: () => env.SCRATCH_DB },
])("The UAT starter set: $label", ({ json, database }) => {
  const db = () => database();
  const request = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: init.method ?? "GET",
        headers: { "Sec-Fetch-Site": "same-origin", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      { ...env, DB: db() },
    );
  const cookies: Partial<Record<Actor, string>> = {};
  const call: Call = async (method, path, actor, body) => request(path, { method, body, cookie: cookies[actor] });

  it("sets up a year's classes, subjects, teachers, students and fees, and its people can sign in", async () => {
    await applyPack(db(), parsePack(json));
    await seedProgrammes(db(), env.AUDIT_HMAC_KEY, parsePack(json)); // the Admin makes programmes first (D-087)
    for (const role of ["admin", "coordinator", "accountant"] as const) {
      const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
        email: `${role}-uat-${crypto.randomUUID().slice(0, 6)}@school.example`,
        password: "blue-river-lamp-2083",
        fullName: `${role} person`,
        roles: [{ role, scope: "institution" }],
      });
      const now = Math.floor(Date.now() / 1000);
      cookies[role] = `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: role, roles: [{ role, scope: "institution" }], iat: now, exp: now + 3600 })}`;
    }

    // Royal's school already has this year as a draft, never activated (as staging had): it is used, not made twice.
    if (json === royalJson) {
      const b = todayBs().year;
      const made = await call("POST", "/api/academics/years", "coordinator", { bsYear: b, startDate: bsToAd({ year: b, month: 1, day: 1 }), endDate: bsToAd({ year: b, month: 12, day: daysInMonth(b, 12) }) });
      expect(made.status).toBe(201);
    }

    const result = await seedUat(call, { tag: "t1" });
    expect(result.yearLabel).toBe(String(todayBs().year));
    const { years } = (await (await call("GET", "/api/academics/years", "coordinator")).json()) as { years: { status: string }[] };
    expect(years.map((y) => y.status)).toEqual(["active"]);
    expect(result.classes).toHaveLength(2);
    expect(result.accounts.filter((a) => a.role === "teacher")).toHaveLength(3);
    const students = result.accounts.filter((a) => a.role === "student");
    expect(students).toHaveLength(12);
    expect(new Set(students.map((s) => s.sid)).size).toBe(12);

    // A new student signs in with the temporary password and must choose their own before anything else.
    const first = await request("/api/auth/sign-in", { method: "POST", body: { email: students[0]!.email, password: students[0]!.temporaryPassword } });
    expect(first.status).toBe(200);
    const step = (await first.json()) as { challenge?: string; kind?: string };
    expect(step.challenge).toBeTruthy();
    const changed = await request("/api/auth/password/change-required", { method: "POST", body: { challenge: step.challenge, password: "Papaya-Compass-Ledger-8823" } });
    expect(changed.status).toBe(200);
    const studentCookie = (changed.headers.get("Set-Cookie") ?? "").split(/,(?=\s*__Host-)/).map((c) => c.split(";")[0]!.trim()).join("; ");

    // Their fees were charged from the approved structure.
    const fees = await request("/api/fees/me", { cookie: studentCookie });
    expect(fees.status).toBe(200);
    expect(((await fees.json()) as { chargedPaisa: number }).chargedPaisa).toBeGreaterThan(0);

    // Both chains are unbroken.
    expect((await verifyAuditChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
    expect((await verifyLedgerChain(db(), env.AUDIT_HMAC_KEY)).ok).toBe(true);
  });

  it("refuses to add a second set on top of a year that already has classes", async () => {
    await expect(seedUat(call, { tag: "t2" })).rejects.toThrow(SeedError);
    await expect(seedUat(call, { tag: "t2" })).rejects.toThrow(/already has classes/);
  });
});
