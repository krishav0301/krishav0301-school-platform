import { beforeAll, describe, expect, it } from "vitest";

import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { approveStructure, draftStructure, link, liveFees } from "./fees-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Once a term is done, the Co-ordinator moves the students first, and only then can the Accountant make and link the new
 * term's fee structure (the PM, 2026-10-17). While students of a closed term in a wing are still waiting to be moved, the
 * Accountant of that wing can neither start a structure, start a next period, nor link one to a level.
 */

let plus2: ClassFixture, bachelors: ClassFixture;
let accountant: Person, admin: Person;
const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });

beforeAll(async () => {
  await seedSections();
  accountant = await person("accountant", "institution");
  admin = await person("admin", "institution");
  plus2 = await classWith("plus2", 2);
  bachelors = await classWith("bachelors", 1);
});

describe("students waiting to be moved", () => {
  it("while any student of a closed term in the wing has not been moved, no structure can be made, renewed or linked", async () => {
    const live = await liveFees({ accountant, admin, sectionKey: "plus2", levelIds: [plus2.levelId] });
    const ready = await draftStructure(accountant, { sectionKey: "plus2", startDate: "2027-04-14", endDate: "2028-04-12" });
    await approveStructure(accountant, admin, ready);
    // The term ends and closes: its two students still wait to be moved on.
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?1 WHERE id = (SELECT academic_year_id FROM enrollments WHERE public_id = ?2)").bind(new Date().toISOString(), plus2.pupils[0]!.enrollmentId).run();

    const made = await post("/api/fees/structures", { name: "Next term", sectionKey: "plus2", startDate: "2027-04-14", endDate: "2028-04-12" }, accountant);
    expect(made.status).toBe(409);
    expect(await made.json()).toEqual({ error: "moves_pending" });
    expect((await post(`/api/fees/structures/${live}/next-period`, { startDate: "2027-04-14", endDate: "2028-04-12" }, accountant)).status).toBe(409);
    const linked = await post(`/api/fees/structures/${ready}/levels`, { levelIds: [plus2.levelId] }, accountant);
    expect(linked.status).toBe(409);
    expect(await linked.json()).toEqual({ error: "moves_pending" });
  });

  it("the other wing is not held up by it", async () => {
    // (Both fixtures share the closed term: the Bachelor's student has nothing to be moved, having graduated.)
    await db.prepare("UPDATE students SET status = 'graduated' WHERE public_id = ?1").bind(bachelors.pupils[0]!.studentId).run();
    expect((await post("/api/fees/structures", { name: "Bachelors next", sectionKey: "bachelors", startDate: "2027-04-14", endDate: "2028-04-12" }, accountant)).status).toBe(201);
    expect(bachelors.levelId).toBeTruthy();
  });

  it("once every student has been moved on (or has left or graduated) the Accountant can go on", async () => {
    // A student who left or graduated needs no move; a moved student has a next enrollment. Both stop waiting.
    await db.prepare("UPDATE students SET status = 'graduated' WHERE public_id IN (?1, ?2)").bind(plus2.pupils[0]!.studentId, plus2.pupils[1]!.studentId).run();
    expect((await post("/api/fees/structures", { name: "Next term", sectionKey: "plus2", startDate: "2027-04-14", endDate: "2028-04-12" }, accountant)).status).toBe(201);
    const ready = await draftStructure(accountant, { sectionKey: "plus2", startDate: "2028-04-13", endDate: "2029-04-12" });
    await approveStructure(accountant, admin, ready);
    expect((await link(accountant, ready, [plus2.levelId])).status).toBe(200);
  });
});
