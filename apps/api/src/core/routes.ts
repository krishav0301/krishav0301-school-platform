import { createRoute, type RouteConfig, type RouteHandler } from "@hono/zod-openapi";

import { readAccessCookie } from "./session-cookies";
import { verifyAccessToken } from "./tokens";
import type { App, AppEnv } from "./types";

/**
 * Every route is declared through `defineRoute`, which forces a decision about access:
 *  - `{ action }`        a permission from docs/permission-matrix.md. Denied until the permission
 *                        layer exists (slice 4); deny by default.
 *  - `{ authenticated }` any signed-in user, for things done to one's own account.
 *  - `{ public }`        anyone.
 * A route added any other way is caught by the route-coverage test.
 */
export type RouteAccess = { action: string } | { authenticated: true } | { public: true };

export interface DeclaredRoute {
  method: string;
  path: string;
  access: RouteAccess;
}

/** Remembers what was declared on each app, so tests can compare it with what is mounted. */
const declared = new WeakMap<object, DeclaredRoute[]>();

export function declaredRoutes(app: App): readonly DeclaredRoute[] {
  return declared.get(app) ?? [];
}

export function defineRoute<R extends RouteConfig>(
  app: App,
  config: R & { access: RouteAccess },
  handler: RouteHandler<R, AppEnv>,
): void {
  const { access, ...routeConfig } = config;
  const route = createRoute(routeConfig as unknown as R);

  const list = declared.get(app) ?? [];
  list.push({ method: config.method.toUpperCase(), path: config.path, access });
  declared.set(app, list);

  // The wrapper checks access before the handler. Types are checked on `handler` above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.openapi(route, (async (c: any, next: any) => {
    if ("action" in access) {
      // Slice 4 replaces this with the role + action + scope check. Until then, deny.
      return c.json({ error: "unauthenticated" }, 401);
    }
    if ("authenticated" in access) {
      const token = readAccessCookie(c);
      const claims = token ? await verifyAccessToken(c.env.SESSION_SECRET, token) : null;
      if (!claims) return c.json({ error: "unauthenticated" }, 401);
      c.set("auth", { userPublicId: claims.sub, sessionPublicId: claims.sid, name: claims.name, roles: claims.roles });
    }
    return handler(c, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}
