/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately poke at loosely-typed data */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { InvalidPackError, applyPack, packOperations, parsePack, renderSql } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const count = async (db: D1Database, sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;

/**
 * A school starts empty (D-087): no pack seeds programmes or levels any more. The Admin makes them on the Programmes
 * screen. The pack still gives the school its sections, which a programme is made inside.
 */
describe("a pack carries no programmes (D-087)", () => {
  it("neither real pack has an academics block", () => {
    for (const json of [royalJson, sampleJson]) expect(json).not.toHaveProperty("academics");
  });

  it("a pack that tries to seed programmes is refused", () => {
    const seeding = { ...structuredClone(royalJson), academics: { programmes: [{ key: "plus2-sample", levels: ["Grade 11"] }] } } as any;
    expect(() => parsePack(seeding)).toThrow(InvalidPackError);
  });

  it("applying either pack, even twice, makes no programmes and no levels, but does make the sections", async () => {
    for (const [json, db] of [
      [royalJson, env.DB],
      [sampleJson, env.SCRATCH_DB],
    ] as const) {
      const pack = parsePack(json);
      await applyPack(db, pack);
      await applyPack(db, pack);
      expect(await count(db, "SELECT COUNT(*) AS n FROM programmes")).toBe(0);
      expect(await count(db, "SELECT COUNT(*) AS n FROM levels")).toBe(0);
      expect(await count(db, "SELECT COUNT(*) AS n FROM sections")).toBe(pack.sections.length);
    }
  });

  it("the provisioning SQL holds no programme or level", () => {
    const sql = renderSql(packOperations(parsePack(royalJson)));
    expect(sql).not.toContain("INSERT INTO programmes");
    expect(sql).not.toContain("INSERT INTO levels");
  });
});
