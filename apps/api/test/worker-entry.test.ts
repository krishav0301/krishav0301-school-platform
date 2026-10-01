import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPack } from "../src/core/config";
import { testPack } from "./programme-fixtures";
import worker from "../src/index";
import royalJson from "../../../packs/royal-softech/pack.json";

/** The Worker's front door: which requests it answers itself and which go on to the API. */
const SHELL = `<!DOCTYPE html><html lang="en"><head></head><body><div id="root"></div></body></html>`;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function assets() {
  const asked: string[] = [];
  const binding = { fetch: async (request: Request) => { asked.push(`${request.method} ${new URL(request.url).pathname}`); return new Response(SHELL, { headers: { "Content-Type": "text/html" } }); } };
  return { binding: binding as unknown as Fetcher, asked };
}
const send = (path: string, init: RequestInit = {}, withAssets = true) => {
  const a = assets();
  const response = worker.fetch(new Request(`https://school.example${path}`, { headers: { "Sec-Fetch-Site": "same-origin" }, ...init }), { ...env, ...(withAssets ? { ASSETS: a.binding } : { ASSETS: undefined }) }, ctx);
  return Promise.resolve(response).then((r) => ({ response: r, asked: a.asked }));
};

beforeAll(async () => {
  await applyPack(env.DB, testPack(royalJson));
});

describe("the Worker's front door", () => {
  it("answers a page it fills in itself, with the school's words in it", async () => {
    const { response, asked } = await send("/notices");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Notices and updates | Royal Softech College</title>");
    expect(asked).toEqual(["GET /notices"]);
  });

  it("also answers the home page and a HEAD request", async () => {
    expect(await (await send("/")).response.text()).toContain("<title>Royal Softech College</title>");
    expect((await send("/notices", { method: "HEAD" })).response.status).toBe(200);
  });

  it("sends the API on to the API, and never asks the static files for it", async () => {
    const { response, asked } = await send("/api/health");
    expect(response.status).toBe(200);
    expect(asked).toEqual([]);
  });

  it("sends a write to a page address on to the API, which has no such route", async () => {
    const { response, asked } = await send("/notices", { method: "POST" });
    expect(response.status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("does not touch a page that is not on the list", async () => {
    const { asked } = await send("/sign-in");
    expect(asked).toEqual([]);
  });

  it("without the static files bound (the tests, or a misconfiguration) leaves the address to the API instead of failing", async () => {
    const { response } = await send("/notices", {}, false);
    expect(response.status).toBe(404);
  });
});
