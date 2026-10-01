import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { applyPack, loadSiteContent } from "../src/core/config";
import { testPack } from "./programme-fixtures";
import royalJson from "../../../packs/royal-softech/pack.json";

describe("loadSiteContent", () => {
  it("is null before any pack has been applied", async () => {
    expect(await loadSiteContent(env.SCRATCH_DB)).toBeNull();
  });

  it("returns the stored block once a pack is applied", async () => {
    const pack = testPack(royalJson);
    await applyPack(env.SCRATCH_DB, pack);
    expect(await loadSiteContent(env.SCRATCH_DB)).toEqual(pack.site);
  });

  it("ignores a stored row that no longer parses, instead of breaking every page (like a stored theme)", async () => {
    await env.SCRATCH_DB.prepare("UPDATE site_content SET content_json = '{\"home\":1}'").run();
    expect(await loadSiteContent(env.SCRATCH_DB)).toBeNull();
  });

  it("the table holds one row only, whatever the code does", async () => {
    await expect(env.SCRATCH_DB.prepare("INSERT INTO site_content (id, content_json, updated_at) VALUES (2, '{}', 'x')").run()).rejects.toThrow();
  });

  it("the table refuses text that is not JSON", async () => {
    await expect(env.SCRATCH_DB.prepare("UPDATE site_content SET content_json = 'not json'").run()).rejects.toThrow();
  });
});
