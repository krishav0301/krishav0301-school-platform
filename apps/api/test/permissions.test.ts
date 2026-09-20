import { OpenAPIHono, z } from "@hono/zod-openapi";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { AUTHENTICATED_ROUTES, PUBLIC_ROUTES } from "../src/core/public-routes";
import { declaredRoutes, defineRoute } from "../src/core/routes";
import { signAccessToken } from "../src/core/tokens";
import type { App, AppEnv } from "../src/core/types";

const okResponse = {
  200: { description: "ok", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
} as const;

const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

/** Routes that are mounted on the app but were not declared through defineRoute. */
function undeclaredRoutes(app: App): string[] {
  const declared = new Set(declaredRoutes(app).map(key));
  return app.routes
    .filter((r) => r.method !== "ALL") // middleware
    .map(key)
    .filter((k) => !declared.has(k));
}

/** Routes declared public that are not on the reviewed allowlist. */
const unlistedPublicRoutes = (app: App): string[] =>
  declaredRoutes(app).filter((r) => "public" in r.access).map(key).filter((k) => !PUBLIC_ROUTES.has(k));

/** Routes declared "any signed-in user" that are not on the reviewed allowlist. */
const unlistedAuthenticatedRoutes = (app: App): string[] =>
  declaredRoutes(app).filter((r) => "authenticated" in r.access).map(key).filter((k) => !AUTHENTICATED_ROUTES.has(k));

describe("route coverage (deny by default)", () => {
  it("every mounted route is declared through defineRoute, so it must state its access", () => {
    expect(undeclaredRoutes(createApp())).toEqual([]);
  });

  it("every public route is on the reviewed allowlist", () => {
    expect(unlistedPublicRoutes(createApp())).toEqual([]);
  });

  it("every 'any signed-in user' route is on the reviewed allowlist", () => {
    expect(unlistedAuthenticatedRoutes(createApp())).toEqual([]);
  });

  it("every allowlisted route really exists", () => {
    const declared = new Set(declaredRoutes(createApp()).map(key));
    expect([...PUBLIC_ROUTES, ...AUTHENTICATED_ROUTES].filter((k) => !declared.has(k))).toEqual([]);
  });

  it("detector: flags a route added without defineRoute", () => {
    const app = new OpenAPIHono<AppEnv>();
    app.get("/api/sneaky", (c) => c.json({ ok: true }));

    expect(undeclaredRoutes(app)).toEqual(["GET /api/sneaky"]);
  });

  it("detector: flags a public route that is not on the allowlist", () => {
    const app = new OpenAPIHono<AppEnv>();
    defineRoute(app, { method: "get", path: "/api/open", access: { public: true }, responses: okResponse }, (c) =>
      c.json({ ok: true }, 200),
    );

    expect(unlistedPublicRoutes(app)).toEqual(["GET /api/open"]);
  });

  it("detector: flags an 'any signed-in user' route that is not on the allowlist", () => {
    const app = new OpenAPIHono<AppEnv>();
    defineRoute(app, { method: "get", path: "/api/mine", access: { authenticated: true }, responses: okResponse }, (c) =>
      c.json({ ok: true }, 200),
    );

    expect(unlistedAuthenticatedRoutes(app)).toEqual(["GET /api/mine"]);
  });

  it("detector: accepts a route that declares a permission action", () => {
    const app = new OpenAPIHono<AppEnv>();
    defineRoute(app, { method: "get", path: "/api/students", access: { action: "student.search" }, responses: okResponse }, (c) =>
      c.json({ ok: true }, 200),
    );

    expect(undeclaredRoutes(app)).toEqual([]);
    expect(unlistedPublicRoutes(app)).toEqual([]);
    expect(unlistedAuthenticatedRoutes(app)).toEqual([]);
  });
});

describe("deny by default", () => {
  it("a route that needs a permission is refused until the permission layer exists", async () => {
    const app = new OpenAPIHono<AppEnv>();
    let handlerRan = false;
    defineRoute(app, { method: "get", path: "/api/students", access: { action: "student.search" }, responses: okResponse }, (c) => {
      handlerRan = true;
      return c.json({ ok: true }, 200);
    });

    // Even a perfectly valid signed-in user is refused: no action is granted yet.
    const now = Math.floor(Date.now() / 1000);
    const token = await signAccessToken(env.SESSION_SECRET, {
      sub: "u", sid: "s", name: "Admin", roles: [{ role: "admin", scope: "institution" }], iat: now, exp: now + 600,
    });
    const response = await app.request("/api/students", { headers: { Cookie: `__Host-access=${token}` } }, env);

    expect(response.status).toBe(401);
    expect(handlerRan).toBe(false);
  });

  it("an 'any signed-in user' route refuses anonymous callers and does not run its handler", async () => {
    const app = new OpenAPIHono<AppEnv>();
    let handlerRan = false;
    defineRoute(app, { method: "get", path: "/api/mine", access: { authenticated: true }, responses: okResponse }, (c) => {
      handlerRan = true;
      return c.json({ ok: true }, 200);
    });

    const response = await app.request("/api/mine", {}, env);

    expect(response.status).toBe(401);
    expect(handlerRan).toBe(false);
  });
});
