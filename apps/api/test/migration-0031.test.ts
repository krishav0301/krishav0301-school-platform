import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Migration 0031 (D-114): subjects get a wing, sorted from their curriculum. The test database already ran it; its
 * sorting block acts only on subjects with no wing, so it is run again here on prepared rows, as it would run on a
 * school's data: a subject used in one wing, one used in two, and one used nowhere.
 */
const db = env.DB;
let n = 0;
const uniq = (prefix: string) => `${prefix}-${++n}-${crypto.randomUUID().slice(0, 8)}`;

function sortingBlock(): string[] {
  const migration = (env.TEST_MIGRATIONS as { name: string; queries: string[] }[]).find((m) => m.name.startsWith("0031_"));
  if (!migration) throw new Error("migration 0031 not found");
  const from = migration.queries.findIndex((q) => /UPDATE subjects SET section_id/.test(q));
  if (from < 0) throw new Error("sorting block not found");
  return migration.queries.slice(from);
}

async function wing(): Promise<number> {
  return (await db.prepare("INSERT INTO sections (key, name) VALUES (?1, ?2)").bind(uniq("wing"), uniq("Wing")).run()).meta.last_row_id;
}
async function levelIn(sectionId: number): Promise<number> {
  const p = await db.prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation) VALUES (?1, ?2, ?3, ?4, 'Board')").bind(uniq("p"), uniq("k"), uniq("Course"), sectionId).run();
  return (await db.prepare("INSERT INTO levels (public_id, programme_id, ordinal, name, usual_months) VALUES (?1, ?2, 1, 'Level', 12)").bind(uniq("l"), p.meta.last_row_id).run()).meta.last_row_id;
}
const unsorted = async (name: string, code: string | null = null): Promise<number> =>
  (await db.prepare("INSERT INTO subjects (public_id, section_id, name, code) VALUES (?1, NULL, ?2, ?3)").bind(uniq("s"), name, code).run()).meta.last_row_id;
const offer = async (levelId: number, subjectId: number): Promise<number> =>
  (await db.prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id) VALUES (?1, ?2, ?3)").bind(uniq("o"), levelId, subjectId).run()).meta.last_row_id;
const sectionOf = async (subjectId: number) => (await db.prepare("SELECT section_id FROM subjects WHERE id = ?1").bind(subjectId).first<{ section_id: number | null }>())!.section_id;
const subjectOf = async (offeringId: number) => (await db.prepare("SELECT subject_id FROM subject_offerings WHERE id = ?1").bind(offeringId).first<{ subject_id: number }>())!.subject_id;

describe("migration 0031: subjects sorted into wings", () => {
  it("a subject used in one wing goes to it; one used nowhere stays unsorted", async () => {
    const [plus2] = [await wing()];
    const physics = await unsorted(uniq("Physics"));
    await offer(await levelIn(plus2!), physics);
    const unused = await unsorted(uniq("Music"));
    await db.batch(sortingBlock().map((q) => db.prepare(q)));
    expect(await sectionOf(physics)).toBe(plus2);
    expect(await sectionOf(unused)).toBeNull();
  });

  it("a subject used in two wings is split: it keeps the lower wing, and the other wing's offerings move to a copy", async () => {
    const a = await wing();
    const b = await wing();
    const name = uniq("English");
    const english = await unsorted(name, uniq("ENG").slice(0, 20));
    const inA = await offer(await levelIn(a), english);
    const inB = await offer(await levelIn(b), english);
    await db.prepare("INSERT INTO mark_components (public_id, offering_id, name, max_hundredths, ordinal) VALUES (?1, ?2, 'Theory', 10000, 1)").bind(uniq("c"), inB).run();

    await db.batch(sortingBlock().map((q) => db.prepare(q)));

    expect(await sectionOf(english)).toBe(Math.min(a, b));
    expect(await subjectOf(inA)).toBe(english);
    const copy = await subjectOf(inB);
    expect(copy).not.toBe(english);
    expect(await db.prepare("SELECT section_id, name, code FROM subjects WHERE id = ?1").bind(copy).first()).toMatchObject({ section_id: b, name });
    // The mark component stays on its offering, which now points at the copy.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM mark_components WHERE offering_id = ?1").bind(inB).first<{ n: number }>()).toEqual({ n: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'subject_wing_split'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("running the block again changes nothing", async () => {
    const before = await db.prepare("SELECT id, section_id FROM subjects ORDER BY id").all();
    await db.batch(sortingBlock().map((q) => db.prepare(q)));
    expect(await db.prepare("SELECT id, section_id FROM subjects ORDER BY id").all()).toEqual(before);
  });

  it("names and codes are unique within a wing, whatever their case, and may repeat across wings", async () => {
    const a = await wing();
    const b = await wing();
    const name = uniq("Maths");
    const insert = (sectionId: number, text: string, code: string | null = null) => db.prepare("INSERT INTO subjects (public_id, section_id, name, code) VALUES (?1, ?2, ?3, ?4)").bind(uniq("s"), sectionId, text, code).run();
    await insert(a, name, "MTH");
    await insert(b, name, "MTH");
    await expect(insert(a, name.toUpperCase())).rejects.toThrow(/UNIQUE/);
    await expect(insert(a, uniq("Other"), "mth")).rejects.toThrow(/UNIQUE/);
  });
});
