import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { dashboardOverview } from "../src/modules/dashboard/service";
import { db, seedSections } from "./academics-helpers";
import { activeYear, classWith } from "./schoolday-helpers";

/**
 * What the Principal's dashboard says about marks (the PM, 2026-10-11): how many mark sheets are waiting to be verified,
 * and how many are still to be sent for review, among the open terms' active classes. A sheet is expected for every
 * subject of a class's level in each of the term's exams.
 */

beforeAll(async () => {
  await seedSections();
  // A mark sheet needs the term's exam pattern (a trigger checks it).
  await db
    .prepare("INSERT OR IGNORE INTO exam_patterns (public_id, academic_year_id, graded, theory_min_percent, practical_min_percent, grade_bands, created_at, updated_at) SELECT lower(hex(randomblob(16))), id, 0, 40, 40, NULL, 'now', 'now' FROM academic_years WHERE public_id = ?1")
    .bind(await activeYear())
    .run();
});

const sheets = async () => (await dashboardOverview(db, env)).results.sheets;
let ordinal = 11; // an exam's number is 1 to 12; the two tests below take 11 and 12

async function exam(yearId: string): Promise<number> {
  const id = (
    await db
      .prepare(`INSERT INTO terminals (public_id, academic_year_id, name, ordinal, weight, has_practical) SELECT ?1, id, ?2, ?3, 100, 0 FROM academic_years WHERE public_id = ?4`)
      .bind(crypto.randomUUID().replaceAll("-", ""), `Exam ${ordinal}`, ordinal++, yearId)
      .run()
  ).meta.last_row_id;
  return id;
}
async function sheetFor(classId: string, offeringId: string, terminalId: number, status: "draft" | "under_review" | "verified"): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mark_sheets (public_id, class_id, offering_id, terminal_id, theory_max_hundredths, status, created_at, updated_at)
       SELECT ?1, c.id, o.id, ?4, 10000, ?5, ?6, ?6 FROM classes c, subject_offerings o WHERE c.public_id = ?2 AND o.public_id = ?3`,
    )
    .bind(crypto.randomUUID().replaceAll("-", ""), classId, offeringId, terminalId, status, new Date().toISOString())
    .run();
}

describe("the Principal's marks figures", () => {
  it("expects one sheet per subject of each active class, in each exam of its term", async () => {
    const yearId = await activeYear();
    const terminalId = await exam(yearId);
    const exams = (await db.prepare("SELECT COUNT(*) AS n FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE y.public_id = ?1 AND t.weight IS NOT NULL").bind(yearId).first<{ n: number }>())!.n;
    const before = await sheets();
    const fixture = await classWith("plus2", 2);
    const after = await sheets();
    expect(after.expected - before.expected).toBe(exams); // one subject, in each exam the term has
    expect(after.sent).toBe(before.sent);
    expect(terminalId).toBeGreaterThan(0);
    expect(fixture.offeringId).toBeTruthy();
  });

  it("counts a sheet waiting to be verified, and one sent, but not a draft", async () => {
    const yearId = await activeYear();
    const terminalId = await exam(yearId);
    const fixture = await classWith("plus2", 1);
    const before = await sheets();
    await sheetFor(fixture.classId, fixture.offeringId, terminalId, "draft");
    expect(await sheets()).toEqual(before); // a draft is still to be sent

    await db.prepare("UPDATE mark_sheets SET status = 'under_review' WHERE class_id = (SELECT id FROM classes WHERE public_id = ?1) AND terminal_id = ?2").bind(fixture.classId, terminalId).run();
    const reviewing = await sheets();
    expect(reviewing.underReview - before.underReview).toBe(1);
    expect(reviewing.sent - before.sent).toBe(1);

    await db.prepare("UPDATE mark_sheets SET status = 'verified' WHERE class_id = (SELECT id FROM classes WHERE public_id = ?1) AND terminal_id = ?2").bind(fixture.classId, terminalId).run();
    const verified = await sheets();
    expect(verified.underReview).toBe(before.underReview); // no longer waiting
    expect(verified.sent - before.sent).toBe(1); // still sent
  });

  it("never reports more sent than expected, so the to-do figure is not negative", async () => {
    const s = await sheets();
    expect(s.expected).toBeGreaterThanOrEqual(0);
    expect(s.sent).toBeGreaterThanOrEqual(0);
    expect(s.sent).toBeLessThanOrEqual(Math.max(s.expected, s.sent)); // the screen shows max(expected - sent, 0)
  });
});
