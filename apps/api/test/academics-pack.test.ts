/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately poke at loosely-typed and malformed data */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { InvalidPackError, applyPack, packOperations, parsePack, renderSql } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const clone = <T>(x: T): T => structuredClone(x);
const count = async (db: D1Database, sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;
const levelsOf = async (db: D1Database, key: string) =>
  (await db.prepare("SELECT l.ordinal, l.name, l.is_active FROM levels l JOIN programmes p ON p.id = l.programme_id WHERE p.key = ?1 ORDER BY l.ordinal").bind(key).all()).results;

describe("the academics block of a pack", () => {
  it("both real packs carry one, and every key is one of the site's programmes", () => {
    for (const json of [royalJson, sampleJson]) {
      const pack = parsePack(json);
      expect(pack.academics.programmes.length).toBeGreaterThan(0);
      const siteKeys = pack.site.programmes.map((p) => p.key);
      for (const programme of pack.academics.programmes) expect(siteKeys).toContain(programme.key);
    }
  });

  it("is optional: a pack without one is valid and seeds nothing", () => {
    const bare = clone(royalJson) as any;
    delete bare.academics;
    expect(parsePack(bare).academics).toEqual({ programmes: [] });
  });

  const cases: [string, (p: any) => void, RegExp][] = [
    ["a key that is not one of the site's programmes", (p) => (p.academics.programmes[0].key = "nowhere"), /academics\.programmes\.0\.key/],
    ["the same programme twice", (p) => p.academics.programmes.push(clone(p.academics.programmes[0])), /keys must be unique/],
    ["the same level name twice in a programme", (p) => (p.academics.programmes[0].levels = ["Year 1", "Year 1"]), /names must be unique/],
    ["a programme with no levels", (p) => (p.academics.programmes[0].levels = []), /levels/],
    ["more than 20 levels", (p) => (p.academics.programmes[0].levels = Array.from({ length: 21 }, (_, i) => `L${i}`)), /levels/],
    ["a field that is not allowed", (p) => (p.academics.programmes[0].name = "Mine"), /name|unrecognized/i],
  ];
  it.each(cases)("refuses %s", (_label, mutate, message) => {
    const bad = clone(royalJson) as any;
    mutate(bad);
    expect(() => parsePack(bad)).toThrow(InvalidPackError);
    try {
      parsePack(bad);
    } catch (error) {
      expect((error as InvalidPackError).problems.join("\n")).toMatch(message);
    }
  });
});

describe("applying a pack seeds programmes and levels", () => {
  it("takes each programme's name, section and affiliation from the site block, and its levels in order", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.DB, pack);
    for (const entry of pack.academics.programmes) {
      const site = pack.site.programmes.find((p) => p.key === entry.key)!;
      const row = await env.DB
        .prepare("SELECT p.name, p.affiliation, p.is_active, s.key AS section FROM programmes p JOIN sections s ON s.id = p.section_id WHERE p.key = ?1")
        .bind(entry.key)
        .first();
      expect(row).toEqual({ name: site.name, affiliation: site.affiliation, is_active: 1, section: site.section });
      expect((await levelsOf(env.DB, entry.key)).map((l: any) => [l.ordinal, l.name])).toEqual(entry.levels.map((name, i) => [i + 1, name]));
    }
  });

  it("applying twice changes nothing (same rows, same ids)", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.DB, pack);
    const snapshot = async () => (await env.DB.prepare("SELECT public_id, key, name, ordering FROM programmes ORDER BY id").all()).results;
    const levelsSnapshot = async () => (await env.DB.prepare("SELECT public_id, programme_id, ordinal, name FROM levels ORDER BY id").all()).results;
    const [programmes, levels] = [await snapshot(), await levelsSnapshot()];
    await applyPack(env.DB, pack);
    expect(await snapshot()).toEqual(programmes);
    expect(await levelsSnapshot()).toEqual(levels);
  });

  it("never overwrites what the Co-ordinator changed on a screen", async () => {
    const pack = parsePack(royalJson);
    const first = pack.academics.programmes[0]!;
    await applyPack(env.DB, pack);
    await env.DB.prepare("UPDATE programmes SET name = 'Renamed by the Co-ordinator', is_active = 0 WHERE key = ?1").bind(first.key).run();
    await env.DB.prepare("UPDATE levels SET name = 'First year (renamed)', is_active = 0 WHERE programme_id = (SELECT id FROM programmes WHERE key = ?1) AND ordinal = 1").bind(first.key).run();
    await env.DB
      .prepare("INSERT INTO levels (public_id, programme_id, ordinal, name) SELECT 'added-by-hand', id, ?2, 'Added level' FROM programmes WHERE key = ?1")
      .bind(first.key, first.levels.length + 1)
      .run();

    await applyPack(env.DB, pack);

    expect(await env.DB.prepare("SELECT name, is_active FROM programmes WHERE key = ?1").bind(first.key).first()).toEqual({ name: "Renamed by the Co-ordinator", is_active: 0 });
    const levels = (await levelsOf(env.DB, first.key)) as any[];
    expect(levels[0]).toMatchObject({ name: "First year (renamed)", is_active: 0 });
    expect(levels.at(-1)).toMatchObject({ name: "Added level" });
    expect(levels).toHaveLength(first.levels.length + 1);
  });

  it("the sample school gets its own structure and none of Royal's", async () => {
    const pack = parsePack(sampleJson);
    await applyPack(env.SCRATCH_DB, pack);
    const keys = (await env.SCRATCH_DB.prepare("SELECT key FROM programmes ORDER BY ordering").all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(pack.academics.programmes.map((p) => p.key));
    expect(await count(env.SCRATCH_DB, "SELECT COUNT(*) AS n FROM programmes WHERE key LIKE 'plus2%' OR key LIKE 'bachelors%'")).toBe(0);
    expect((await levelsOf(env.SCRATCH_DB, "primary")).map((l: any) => l.name)).toEqual(["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"]);
  });

  it("renders as plain SQL for the provisioning script, without leaving a value out", () => {
    const sql = renderSql(packOperations(parsePack(royalJson)));
    expect(sql).toContain("INSERT INTO programmes");
    expect(sql).toContain("INSERT INTO levels");
  });
});
