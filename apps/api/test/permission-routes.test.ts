import { OpenAPIHono, z } from "@hono/zod-openapi";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { ALL_ACTIONS, MATRIX, ROLE_CODES, ROLE_OF, authorize, rowFor, type RoleCode } from "../src/core/permissions";
import { defineRoute } from "../src/core/routes";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import type { AppEnv } from "../src/core/types";

const SCOPE_OF: Record<RoleCode, RoleClaim["scope"]> = {
  STU: "own", TEA: "assigned", COO: "institution", ACC: "institution", ADM: "institution", SUP: "institution",
};

const ok = z.object({ ran: z.boolean(), grant: z.any() });

/** One synthetic route per action, so every permission is exercised over real HTTP. */
function buildApp() {
  const app = new OpenAPIHono<AppEnv>();
  const ran: string[] = [];
  for (const action of ALL_ACTIONS) {
    defineRoute(
      app,
      {
        method: "get",
        path: `/api/_matrix/${action}`,
        access: { action },
        responses: { 200: { description: "ok", content: { "application/json": { schema: ok } } } },
      },
      (c) => {
        ran.push(action);
        return c.json({ ran: true, grant: c.get("grant") }, 200);
      },
    );
  }
  return { app, ran };
}

async function cookieFor(roles: RoleClaim[], overrides: { exp?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signAccessToken(env.SESSION_SECRET, {
    sub: "person", sid: "session", name: "Person", roles, iat: now, exp: overrides.exp ?? now + 600,
  });
  return `__Host-access=${token}`;
}

const get = (app: OpenAPIHono<AppEnv>, action: string, cookie?: string) =>
  app.request(`/api/_matrix/${action}`, { headers: cookie ? { Cookie: cookie } : {} }, env);

describe("every action, every role, over HTTP", () => {
  it.each(ROLE_CODES)("as %s: allowed where the matrix says, 403 everywhere else, and denied handlers never run", async (code) => {
    const { app, ran } = buildApp();
    const roles: RoleClaim[] = [{ role: ROLE_OF[code], scope: SCOPE_OF[code] }];
    const cookie = await cookieFor(roles);

    for (const action of ALL_ACTIONS) {
      const shouldRun = authorize(roles, action) !== null;
      const before = ran.length;
      const response = await get(app, action, cookie);

      expect(response.status, `${code} ${action}`).toBe(shouldRun ? 200 : 403);
      expect(ran.length - before, `${code} ${action} handler ran`).toBe(shouldRun ? 1 : 0);
      if (!shouldRun) expect(await response.json()).toEqual({ error: "forbidden" });
    }
  });

  it("with no cookie, everything needs sign-in (401), except the actions open to anyone", async () => {
    const { app, ran } = buildApp();
    for (const action of ALL_ACTIONS) {
      const open = rowFor(action)!.anonymous === true;
      const before = ran.length;
      const response = await get(app, action);

      expect(response.status, action).toBe(open ? 200 : 401);
      expect(ran.length - before, action).toBe(open ? 1 : 0);
    }
  });

  it("an expired cookie is treated as not signed in (401), not as forbidden", async () => {
    const { app } = buildApp();
    const expired = await cookieFor([{ role: "admin", scope: "institution" }], { exp: Math.floor(Date.now() / 1000) - 5 });

    expect((await get(app, "audit.view", expired)).status).toBe(401);
  });

  it("a signed-in person with no roles at all is refused every protected action", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor([]);
    for (const action of ALL_ACTIONS.filter((a) => rowFor(a)!.anonymous !== true)) {
      expect((await get(app, action, cookie)).status, action).toBe(403);
    }
  });

  it("the handler receives the grant, narrowed to the section for a section-scoped Co-ordinator", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor([{ role: "coordinator", scope: "section", section: "plus2" }]);

    const response = await get(app, "admissions.review", cookie);
    const body = (await response.json()) as { grant: { institution: boolean; sections: string[] } };

    expect(response.status).toBe(200);
    expect(body.grant).toMatchObject({ institution: false, sections: ["plus2"] });
  });

  it("the same Co-ordinator, whole-institution, is not narrowed", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor([{ role: "coordinator", scope: "institution" }]);
    const body = (await (await get(app, "admissions.review", cookie)).json()) as { grant: { institution: boolean } };

    expect(body.grant.institution).toBe(true);
  });

  it("a signed token cannot be promoted by editing it", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor([{ role: "student", scope: "own" }]);
    const [name, token] = cookie.split("=") as [string, string];
    const [payload, signature] = token.split(".") as [string, string];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    decoded.roles = [{ role: "admin", scope: "institution" }];
    const forged = btoa(JSON.stringify(decoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    expect((await get(app, "fees.refund.approve", `${name}=${forged}.${signature}`)).status).toBe(401);
  });
});

describe("routes and the matrix stay in step", () => {
  it("a route that names an action missing from the matrix cannot be defined", () => {
    const app = new OpenAPIHono<AppEnv>();
    expect(() =>
      defineRoute(
        app,
        // @ts-expect-error: deliberately not an ActionId
        { method: "get", path: "/api/typo", access: { action: "fees.aprove" }, responses: { 200: { description: "ok" } } },
        (c) => c.json({}, 200),
      ),
    ).toThrow(/not in the permission matrix/);
  });

  it("the matrix has rows for every build phase's main actions", () => {
    const phases = new Set(MATRIX.map((r) => r.phase));
    for (const phase of [1, 2, 3, 4, 5, 6, 7, 8]) expect(phases.has(phase), `phase ${phase}`).toBe(true);
  });
});
