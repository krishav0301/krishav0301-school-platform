import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.DB;
let counter = 0;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;

async function addLevel(): Promise<number> {
  const section = await db.prepare("INSERT INTO sections (key, name) VALUES (?1, 'Section')").bind(uniq("sec")).run();
  const programme = await db
    .prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation) VALUES (?1, ?2, 'Programme', ?3, 'Board')")
    .bind(uniq("p"), uniq("key"), section.meta.last_row_id)
    .run();
  const level = await db.prepare("INSERT INTO levels (public_id, programme_id, ordinal, name) VALUES (?1, ?2, 1, 'Level')").bind(uniq("l"), programme.meta.last_row_id).run();
  return level.meta.last_row_id;
}

const addSubject = async (name = uniq("Subject"), code: string | null = null): Promise<number> =>
  (await db.prepare("INSERT INTO subjects (public_id, name, code) VALUES (?1, ?2, ?3)").bind(uniq("s"), name, code).run()).meta.last_row_id;

const addGroup = async (levelId: number, name = uniq("Group"), pick = 1): Promise<number> =>
  (await db.prepare("INSERT INTO elective_groups (public_id, level_id, name, pick_count) VALUES (?1, ?2, ?3, ?4)").bind(uniq("g"), levelId, name, pick).run()).meta.last_row_id;

const addOffering = async (levelId: number, subjectId: number, credit: number | null = null, groupId: number | null = null): Promise<number> =>
  (
    await db
      .prepare("INSERT INTO subject_offerings (public_id, level_id, subject_id, credit_hundredths, elective_group_id) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(uniq("o"), levelId, subjectId, credit, groupId)
      .run()
  ).meta.last_row_id;

const addComponent = (offeringId: number, name: string, ordinal: number, max = 10000) =>
  db.prepare("INSERT INTO mark_components (public_id, offering_id, name, max_hundredths, ordinal) VALUES (?1, ?2, ?3, ?4, ?5)").bind(uniq("c"), offeringId, name, max, ordinal).run();

// ---------------------------------------------------------------------------------------------
describe("subjects", () => {
  it("a name is unique whatever its letter case", async () => {
    const name = uniq("Physics");
    await addSubject(name);
    await expect(addSubject(name.toUpperCase())).rejects.toThrow(/UNIQUE/);
  });

  it("a code is unique when there is one, and several subjects may have none", async () => {
    const code = uniq("PH").slice(0, 12);
    await addSubject(undefined, code);
    await expect(addSubject(undefined, code.toLowerCase())).rejects.toThrow(/UNIQUE/);
    await addSubject(undefined, null);
    await addSubject(undefined, null);
  });

  it("refuses an empty name, and a code over 20 characters", async () => {
    await expect(addSubject("")).rejects.toThrow(/CHECK/);
    await expect(addSubject(uniq("Long"), "x".repeat(21))).rejects.toThrow(/CHECK/);
  });
});

describe("subject offerings", () => {
  it("a subject is offered once per level, and may be offered at another level", async () => {
    const level = await addLevel();
    const subject = await addSubject();
    await addOffering(level, subject);
    await expect(addOffering(level, subject)).rejects.toThrow(/UNIQUE/);
    await addOffering(await addLevel(), subject);
  });

  it("credit hours are whole hundredths from 1 to 10000, or none", async () => {
    const level = await addLevel();
    await addOffering(level, await addSubject(), null);
    await addOffering(level, await addSubject(), 375);
    await expect(addOffering(level, await addSubject(), 0)).rejects.toThrow(/CHECK/);
    await expect(addOffering(level, await addSubject(), 10001)).rejects.toThrow(/CHECK/);
  });

  it("takes an elective group of its own level, and refuses one of another level", async () => {
    const level = await addLevel();
    const other = await addLevel();
    const group = await addGroup(level);
    await addOffering(level, await addSubject(), null, group);
    await addOffering(level, await addSubject(), null, null);
    await expect(addOffering(other, await addSubject(), null, group)).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("elective groups", () => {
  it("a name is used once per level, and a pick count is 1 to 10", async () => {
    const level = await addLevel();
    await addGroup(level, "Science option");
    await expect(addGroup(level, "Science option")).rejects.toThrow(/UNIQUE/);
    await addGroup(await addLevel(), "Science option");
    await expect(addGroup(level, uniq("G"), 0)).rejects.toThrow(/CHECK/);
    await expect(addGroup(level, uniq("G"), 11)).rejects.toThrow(/CHECK/);
  });
});

describe("mark components", () => {
  it("a name and an ordinal are each used once per offering", async () => {
    const level = await addLevel();
    const offering = await addOffering(level, await addSubject());
    await addComponent(offering, "Theory", 1);
    await expect(addComponent(offering, "Theory", 2)).rejects.toThrow(/UNIQUE/);
    await expect(addComponent(offering, "Practical", 1)).rejects.toThrow(/UNIQUE/);
    await addComponent(offering, "Practical", 2);
    await addComponent(await addOffering(level, await addSubject()), "Theory", 1); // another offering may reuse both
  });

  it("maximum marks are whole hundredths from 1 to 100000, and the ordinal is 1 to 10", async () => {
    const offering = await addOffering(await addLevel(), await addSubject());
    await expect(addComponent(offering, "A", 1, 0)).rejects.toThrow(/CHECK/);
    await expect(addComponent(offering, "B", 2, 100001)).rejects.toThrow(/CHECK/);
    await expect(addComponent(offering, "C", 0)).rejects.toThrow(/CHECK/);
    await expect(addComponent(offering, "D", 11)).rejects.toThrow(/CHECK/);
    await addComponent(offering, "E", 3, 100000);
  });
});
