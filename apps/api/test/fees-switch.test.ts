import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { createStaff } from "../src/modules/accounts/staff";
import { isMandatoryModule, resolveModules } from "../src/core/config";
import { auditKey, call, db, person, seedSections, type Person } from "./academics-helpers";

/**
 * Fees can be switched off for a school that does not collect them (the PM, 2026-10-11): the Fees pages and the whole
 * `/api/fees` family answer "not found", and there is no Accountant to add. Every school keeps it on unless its pack says
 * `"fees": false`; the ledger rules do not change for the schools that use it.
 */

let accountant: Person, coordinator: Person, admin: Person;
const setFees = (enabled: boolean) => db.prepare("INSERT INTO module_switches (key, enabled) VALUES ('fees', ?1) ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled").bind(enabled ? 1 : 0).run();

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
});
afterAll(async () => {
  await setFees(true);
});

describe("the fees switch", () => {
  it("is optional now: on unless a pack turns it off, and the others that carry rules stay mandatory", () => {
    expect(isMandatoryModule("fees")).toBe(false);
    expect(resolveModules({}).fees).toBe(true);
    expect(resolveModules({ fees: false }).fees).toBe(false);
    for (const key of ["results", "audit", "approvals", "accounts", "admissions"]) expect(isMandatoryModule(key), key).toBe(true);
    expect(resolveModules({ results: false }).results).toBe(true);
  });

  it("with fees on, the fee pages answer as before", async () => {
    await setFees(true);
    expect((await call("/api/fees/dues", { cookie: accountant.cookie })).status).toBe(200);
  });

  it("with fees off, every fee route answers not found, for everyone who could have used it", async () => {
    await setFees(false);
    for (const who of [accountant, admin, coordinator]) {
      const response = await call("/api/fees/dues", { cookie: who.cookie });
      expect(response.status, who.publicId).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect((await call("/api/fees/structures", { cookie: accountant.cookie })).status).toBe(404);
    // A write is refused the same way, before it reaches the ledger.
    const write = await call("/api/fees/payments/cash", { method: "POST", cookie: accountant.cookie, body: {} });
    expect(write.status).toBe(404);
    // The rest of the platform is not affected.
    expect((await call("/api/academics/years", { cookie: coordinator.cookie })).status).toBe(200);
  });

  it("with fees off, no Accountant can be added; a Co-ordinator still can", async () => {
    await setFees(false);
    const email = (who: string) => `${who}.${crypto.randomUUID().slice(0, 6)}@school.example`;
    const refused = await createStaff(db, auditKey, admin.publicId, { email: email("acc"), fullName: "No Accounts", role: "accountant" } as never);
    expect(refused).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/fees are switched off/i) });
    const made = await createStaff(db, auditKey, admin.publicId, { email: email("coo"), fullName: "Still Fine", role: "coordinator" } as never);
    expect(made.ok).toBe(true);
    await setFees(true);
    const again = await createStaff(db, auditKey, admin.publicId, { email: email("acc2"), fullName: "Has Accounts", role: "accountant" } as never);
    expect(again.ok).toBe(true);
  });
});
