import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { SiteContentSchema, applyPack } from "../src/core/config";
import { testPack } from "./programme-fixtures";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const app = createApp();
const call = (path: string, over: Record<string, unknown> = {}, init: RequestInit = {}) =>
  app.request(`https://school.example${path}`, { headers: { "Sec-Fetch-Site": "same-origin" }, ...init }, { ...env, ...over });

describe("GET /api/site/pages", () => {
  it("says there is nothing yet before a pack with a site block is applied", async () => {
    const response = await call("/api/site/pages", { DB: env.SCRATCH_DB });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ site: null });
  });

  it("anyone may read it with no sign-in, and gets the school's own words", async () => {
    const pack = testPack(royalJson);
    await applyPack(env.DB, pack);
    const response = await call("/api/site/pages");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ site: pack.site });
  });

  it("returns valid site content", async () => {
    const body = (await (await call("/api/site/pages")).json()) as { site: unknown };
    expect(SiteContentSchema.safeParse(body.site).success).toBe(true);
  });

  it("is a short public cache, so a change to the pack shows within about a minute", async () => {
    expect((await call("/api/site/pages")).headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("a second school gets its own words and none of the first school's", async () => {
    const pack = testPack(sampleJson);
    await applyPack(env.SCRATCH_DB, pack);
    const text = await (await call("/api/site/pages", { DB: env.SCRATCH_DB })).text();
    expect(JSON.parse(text)).toEqual({ site: pack.site });
    for (const word of ["Royal", "Lahan", "Siraha"]) expect(text, word).not.toContain(word);
  });

  it("reads a stored row that no longer parses as not ready", async () => {
    await env.SCRATCH_DB.prepare("UPDATE site_content SET content_json = '{\"home\":1}'").run();
    expect(await (await call("/api/site/pages", { DB: env.SCRATCH_DB })).json()).toEqual({ site: null });
  });

  it("is read only: nothing can be written through it", async () => {
    const response = await call("/api/site/pages", {}, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(404);
  });
});
