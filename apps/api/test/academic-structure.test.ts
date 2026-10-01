import { describe, expect, it } from "vitest";

import { listProgrammes } from "../src/modules/academics/queries";
import { db } from "./academics-helpers";
import { classWith } from "./schoolday-helpers";

/**
 * The Academic Structure page's figures (D-096): students per level, per programme and in all, counted by the database
 * for the active year, and the four totals, from the one list the page reads.
 */
describe("the academic structure's figures", () => {
  it("counts this year's students per level and per programme, and adds them up, without fetching any student", async () => {
    const plus2 = await classWith("plus2", 3);
    const bachelors = await classWith("bachelors", 2);
    // A student who has left is not counted.
    await db.prepare("UPDATE enrollments SET status = 'left' WHERE public_id = ?1").bind(bachelors.pupils[0]!.enrollmentId).run();

    const list = await listProgrammes(db, "all");
    const level = (id: string) => list.programmes.flatMap((p) => p.levels).find((l) => l.id === id)!;
    expect(level(plus2.levelId).students).toBe(3);
    expect(level(bachelors.levelId).students).toBe(1);

    const owner = list.programmes.find((p) => p.levels.some((l) => l.id === plus2.levelId))!;
    expect(owner.students).toBe(3);
    expect(list.totals.students).toBe(list.programmes.reduce((n, p) => n + p.students, 0));
    expect(list.totals.sections).toBe(list.sections.length);
    expect(list.totals.programmes).toBe(list.programmes.filter((p) => p.active).length);
  });

  it("switched-off programmes and levels are not counted in the totals, but stay in the list", async () => {
    const fixture = await classWith("plus2", 1);
    const before = await listProgrammes(db, "all");
    await db.prepare("UPDATE levels SET is_active = 0 WHERE public_id = ?1").bind(fixture.levelId).run();
    const after = await listProgrammes(db, "all");
    expect(after.totals.levels).toBe(before.totals.levels - 1);
    expect(after.programmes.flatMap((p) => p.levels).some((l) => l.id === fixture.levelId)).toBe(true);
  });

  it("a section-scoped person's figures cover only their own section", async () => {
    const all = await listProgrammes(db, "all");
    const mine = await listProgrammes(db, ["plus2"]);
    expect(mine.sections.map((s) => s.key)).toEqual(["plus2"]);
    expect(mine.totals.sections).toBe(1);
    expect(mine.totals.students).toBe(mine.programmes.reduce((n, p) => n + p.students, 0));
    expect(mine.totals.students).toBeLessThan(all.totals.students);
  });
});
