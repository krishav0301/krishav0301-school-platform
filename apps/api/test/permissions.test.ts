import { OpenAPIHono, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { PUBLIC_ROUTES } from "../src/core/public-routes";
import { declaredRoutes, defineRoute } from "../src/core/routes";
import type { App, AppEnv } from "../src/core/types";

const okResponse = { 200: { description: "ok", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } } };

/** Routes that are mounted on the app but were not declared through defineRoute. */
function undeclaredRoutes(app: App): string[] {
  const declared = new Set(declaredRoutes(app).map((r) => `${r.method} ${r.path}`));
  return app.routes
    .filter((r) => r.method !== "ALL") // middleware
    .map((r) => `${r.method} ${r.path}`)
    .filter((key) => !declared.has(key));
}

/** Routes declared public that are not on the reviewed allowlist. */
function unlistedPublicRoutes(app: App): string[] {
  return declaredRoutes(app)
    .filter((r) => "public" in r.access)
    .map((r) => `${r.method} ${r.path}`)
    .filter((key) => !PUBLIC_ROUTES.has(key));
}

describe("route coverage (deny by default)", () => {
  it("every mounted route is declared through defineRoute, so it must state its access", () => {
    expect(undeclaredRoutes(createApp())).toEqual([]);
  });

  it("every public route is on the reviewed allowlist", () => {
    expect(unlistedPublicRoutes(createApp())).toEqual([]);
  });

  it("every allowlisted public route really exists", () => {
    const declared = new Set(declaredRoutes(createApp()).map((r) => `${r.method} ${r.path}`));
    expect([...PUBLIC_ROUTES].filter((key) => !declared.has(key))).toEqual([]);
  });

  it("detector: flags a route added without defineRoute", () => {
    const app = new OpenAPIHono<AppEnv>();
    app.get("/api/sneaky", (c) => c.json({ ok: true }));

    expect(undeclaredRoutes(app)).toEqual(["GET /api/sneaky"]);
  });

  it("detector: flags a public route that is not on the allowlist", () => {
    const app = new OpenAPIHono<AppEnv>();
    defineRoute(app, { method: "get", path: "/api/open", access: { public: true }, responses: okResponse }, (c) =>
      c.json({ ok: true }),
    );

    expect(unlistedPublicRoutes(app)).toEqual(["GET /api/open"]);
  });

  it("detector: accepts a route that declares a permission action", () => {
    const app = new OpenAPIHono<AppEnv>();
    defineRoute(
      app,
      { method: "get", path: "/api/students", access: { action: "student.search" }, responses: okResponse },
      (c) => c.json({ ok: true }),
    );

    expect(undeclaredRoutes(app)).toEqual([]);
    expect(unlistedPublicRoutes(app)).toEqual([]);
  });
});

describe("deny by default", () => {
  it("a route that needs a permission is refused until the permission layer exists", async () => {
    const app = new OpenAPIHono<AppEnv>();
    let handlerRan = false;
    defineRoute(
      app,
      { method: "get", path: "/api/students", access: { action: "student.search" }, responses: okResponse },
      (c) => {
        handlerRan = true;
        return c.json({ ok: true });
      },
    );

    const response = await app.request("/api/students");

    expect(response.status).toBe(401);
    expect(handlerRan).toBe(false);
  });
});
