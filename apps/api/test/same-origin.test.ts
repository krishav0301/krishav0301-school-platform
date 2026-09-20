import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import { sameOriginOnly } from "../src/core/same-origin";
import type { AppEnv } from "../src/core/types";

function appWithAWrite() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("/api/*", sameOriginOnly);
  app.get("/api/read", (c) => c.json({ ok: true }));
  app.post("/api/write", (c) => c.json({ ok: true }));
  return app;
}

const post = (headers: Record<string, string>) =>
  appWithAWrite().request("https://school.example/api/write", { method: "POST", headers });

describe("same-origin rule for writes", () => {
  it("lets reads through with no origin information", async () => {
    const response = await appWithAWrite().request("https://school.example/api/read");
    expect(response.status).toBe(200);
  });

  it("accepts a write from the same origin (Sec-Fetch-Site)", async () => {
    expect((await post({ "Sec-Fetch-Site": "same-origin" })).status).toBe(200);
  });

  it("accepts a write whose Origin is our own (older browsers)", async () => {
    expect((await post({ Origin: "https://school.example" })).status).toBe(200);
  });

  it("refuses a cross-site write", async () => {
    const response = await post({ "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request_refused" });
  });

  it("refuses a same-site but different-origin write (a sibling subdomain)", async () => {
    expect((await post({ "Sec-Fetch-Site": "same-site" })).status).toBe(403);
  });

  it("refuses a write that carries no origin information at all", async () => {
    expect((await post({})).status).toBe(403);
  });

  it("refuses a write whose Origin differs, when Sec-Fetch-Site is absent", async () => {
    expect((await post({ Origin: "https://evil.example" })).status).toBe(403);
  });
});
