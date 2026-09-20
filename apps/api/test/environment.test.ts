import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { validateEnvironment } from "../src/core/environment";

describe("validateEnvironment", () => {
  it("refuses demo mode in production", () => {
    expect(() => validateEnvironment("production", true)).toThrow(/DEMO_MODE/);
  });

  it.each(["development", "test", "staging"])("allows demo mode in %s", (name) => {
    expect(() => validateEnvironment(name, true)).not.toThrow();
  });

  it("allows production without demo mode", () => {
    expect(() => validateEnvironment("production", false)).not.toThrow();
  });

  it("refuses an unknown environment name", () => {
    expect(() => validateEnvironment("prod", false)).toThrow(/ENVIRONMENT/);
  });
});

describe("environment guard", () => {
  it("serves no traffic when demo mode is on in production", async () => {
    const response = await createApp().request(
      "/api/health",
      {},
      { ...env, ENVIRONMENT: "production", DEMO_MODE: "true", DB: env.DB },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_misconfigured" });
  });
});
