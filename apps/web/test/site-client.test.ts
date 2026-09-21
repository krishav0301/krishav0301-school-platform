import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import { loadSite } from "@/site/client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const clientFor = (respond: () => Promise<Response>) => createApiClient({ baseUrl: "https://school.example", fetch: async () => respond() });

describe("loadSite", () => {
  it("returns the words when the school has them", async () => {
    const site = { home: { headline: "H", summary: "S" } };
    const result = await loadSite(clientFor(async () => json({ site })));
    expect(result).toEqual({ ok: true, site });
  });

  it("returns null words, not a failure, when the school has none yet", async () => {
    expect(await loadSite(clientFor(async () => json({ site: null })))).toEqual({ ok: true, site: null });
  });

  it("is a failure on a server error and on a dropped connection, and never throws", async () => {
    expect(await loadSite(clientFor(async () => json({ error: "x" }, 500)))).toEqual({ ok: false });
    expect(await loadSite(clientFor(async () => { throw new TypeError("network"); }))).toEqual({ ok: false });
  });
});
