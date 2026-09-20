import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";

describe("GET /api/health", () => {
  it("reports ok to anonymous users, against the real test database", async () => {
    const response = await createApp().request("/api/health", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("reports a database failure as 503", async () => {
    const brokenEnv = {
      ENVIRONMENT: "test",
      DEMO_MODE: "false",
      DB: {
        prepare() {
          throw new Error("database is down");
        },
      },
    };

    const response = await createApp().request("/api/health", {}, brokenEnv);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "degraded", database: "down" });
  });

  it("does not answer to a trailing slash (convention: none)", async () => {
    const response = await createApp().request("/api/health/", {}, env);

    expect(response.status).toBe(404);
  });
});
