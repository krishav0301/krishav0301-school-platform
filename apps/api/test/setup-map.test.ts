import { beforeAll, describe, expect, it } from "vitest";

import { getSetupMap } from "../src/modules/academics/setup-map";
import { db, seedSections } from "./academics-helpers";
import { activeYear, assign, classWith } from "./schoolday-helpers";

/**
 * The setup map (the PM, 2026-10-10): each open term with its exam pattern, then Wing > Department > Level, and under
 * each level its subjects and sections (Class Teacher, who teaches which subject, student count), only the wings the
 * viewer reaches, for one term or all open ones.
 */

beforeAll(async () => {
  await seedSections();
});

type Map = Awaited<ReturnType<typeof getSetupMap>>;
const levelOf = (map: Map, levelId: string) => map.terms.flatMap((t) => t.wings.flatMap((w) => w.departments.flatMap((d) => d.levels))).find((l) => l.id === levelId);

describe("the setup map", () => {
  it("links a level to its subjects, its sections, their teachers and their students", async () => {
    const fixture = await classWith("plus2", 3);
    await assign(fixture.classTeacher, fixture.classId, fixture.offeringId);
    const map = await getSetupMap(db, "all", null);

    const level = levelOf(map, fixture.levelId)!;
    expect(level.subjects).toHaveLength(1);
    expect(level.sections).toHaveLength(1);
    const section = level.sections[0]!;
    expect(section).toMatchObject({ id: fixture.classId, students: 3 });
    expect(section.classTeacher).not.toBeNull();
    expect(section.teachers).toEqual([{ subjectId: fixture.offeringId, teacher: expect.any(String) }]);

    const term = map.terms.find((t) => t.wings.some((w) => w.departments.some((d) => d.levels.some((l) => l.id === fixture.levelId))))!;
    expect(term.wings.find((w) => w.key === "plus2")).toBeDefined();
  });

  it("shows only the wings the viewer reaches", async () => {
    const plus2 = await classWith("plus2", 1);
    const bachelors = await classWith("bachelors", 1);
    const scoped = await getSetupMap(db, ["plus2"], null);
    expect(levelOf(scoped, plus2.levelId)).toBeDefined();
    expect(levelOf(scoped, bachelors.levelId)).toBeUndefined();
    expect(scoped.terms.flatMap((t) => t.wings.map((w) => w.key))).not.toContain("bachelors");
  });

  it("is limited to the term asked for", async () => {
    const fixture = await classWith("plus2", 1);
    const yearId = await activeYear();
    const one = await getSetupMap(db, "all", yearId);
    expect(one.terms.map((t) => t.id)).toEqual([yearId]);
    expect(levelOf(one, fixture.levelId)).toBeDefined();

    expect((await getSetupMap(db, "all", "0".repeat(32))).terms).toEqual([]);
  });

  it("carries the term's exam pattern and its terminals", async () => {
    const fixture = await classWith("plus2", 1);
    const yearId = await activeYear();
    await db.prepare("DELETE FROM exam_patterns WHERE academic_year_id = (SELECT id FROM academic_years WHERE public_id = ?1)").bind(yearId).run().catch(() => {});
    await db
      .prepare("INSERT OR REPLACE INTO exam_patterns (public_id, academic_year_id, graded, theory_min_percent, practical_min_percent, grade_bands, created_at, updated_at) SELECT lower(hex(randomblob(16))), id, 0, 40, 40, NULL, 'now', 'now' FROM academic_years WHERE public_id = ?1")
      .bind(yearId)
      .run();
    const term = (await getSetupMap(db, "all", yearId)).terms[0]!;
    expect(term.exam).toMatchObject({ graded: false, theoryMinPercent: 40, practicalMinPercent: 40 });
    expect(levelOf({ terms: [term] }, fixture.levelId)).toBeDefined();
  });
});
