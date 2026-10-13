import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPack, parsePack } from "../src/core/config";
import worker from "../src/index";
import { SCHOOL_FILES, isSchoolFile } from "../src/modules/site";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import royalJson from "../../../packs/royal-softech/pack.json";
import { testPack } from "./programme-fixtures";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

/** A stand-in for the web app's files: the app's default icon, and (if asked) the school's own. */
function assets(options: { schoolIcon?: boolean } = {}) {
  const seen: string[] = [];
  const binding = {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      seen.push(path);
      if (path === "/favicon.ico") return new Response("DEFAULT-ICON", { status: 200, headers: { "Content-Type": "image/x-icon" } });
      if (path === "/site/lahan/favicon.png" && options.schoolIcon !== false) return new Response("LAHAN-ICON", { status: 200, headers: { "Content-Type": "image/png" } });
      return new Response("Not found", { status: 404 });
    },
  };
  return { binding: binding as unknown as Fetcher, seen };
}
const ask = async (over: Record<string, unknown> = {}, method = "GET") => {
  const response = await worker.fetch(new Request("https://school.example/favicon.ico?favicon.abc123.ico", { method }), { ...env, ASSETS: assets().binding, ...over } as never, ctx);
  return { response, text: await response.text() };
};

describe("which address is the school's icon", () => {
  it("is /favicon.ico, and nothing near it", () => {
    expect([...SCHOOL_FILES]).toEqual(["/favicon.ico"]);
    expect(isSchoolFile("/favicon.ico")).toBe(true);
    for (const other of ["/favicon.ico/", "/favicon.png", "/Favicon.ico", "/x/favicon.ico", "/"]) expect(isSchoolFile(other), other).toBe(false);
  });
});

describe("the icon of a school with the one-page layout (PM, 2026-10-13)", () => {
  beforeAll(async () => {
    await applyPack(env.DB, parsePack(lahanJson));
  });

  it("is the school's own, as a picture, kept by browsers for a day", async () => {
    const { response, text } = await ask();
    expect(response.status).toBe(200);
    expect(text).toBe("LAHAN-ICON");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("falls back to the app's own icon when the school's file is missing, and never fails", async () => {
    const { response, text } = await ask({ ASSETS: assets({ schoolIcon: false }).binding });
    expect(response.status).toBe(200);
    expect(text).toBe("DEFAULT-ICON");
  });

  it("answers a HEAD request without the picture", async () => {
    const { response, text } = await ask({}, "HEAD");
    expect(response.status).toBe(200);
    expect(text).toBe("");
  });
});

describe("every other school", () => {
  it("keeps the app's default icon", async () => {
    await applyPack(env.DB, testPack(royalJson));
    expect((await ask()).text).toBe("DEFAULT-ICON");
  });

  it("and so does a site that is not set up yet", async () => {
    expect((await ask({ DB: env.SCRATCH_DB })).text).toBe("DEFAULT-ICON");
  });
});
