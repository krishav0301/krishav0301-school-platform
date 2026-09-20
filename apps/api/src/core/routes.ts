import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import type { Handler } from "hono";

import type { App, AppEnv } from "./types";

/**
 * Every route is declared through `defineRoute`, which forces a decision about access:
 * a permission `action` (see docs/permission-matrix.md) or an explicit `public: true`.
 * A route added any other way is caught by the route-coverage test.
 *
 * Deny by default: until the permission layer exists (Phase 1), every non-public route answers
 * 401, whatever its action.
 */
export type RouteAccess = { action: string } | { public: true };

export interface DeclaredRoute {
  method: string;
  path: string;
  access: RouteAccess;
}

type DefineRouteConfig = RouteConfig & { access: RouteAccess };

/** Remembers what was declared on each app, so tests can compare it with what is mounted. */
const declared = new WeakMap<object, DeclaredRoute[]>();

export function declaredRoutes(app: App): readonly DeclaredRoute[] {
  return declared.get(app) ?? [];
}

export function defineRoute(
  app: App,
  config: DefineRouteConfig,
  // The response type is checked by the route's own schema; the handler is wrapped below.
  handler: Handler<AppEnv, string>,
): void {
  const { access, ...routeConfig } = config;
  const route = createRoute(routeConfig);

  const list = declared.get(app) ?? [];
  list.push({ method: config.method.toUpperCase(), path: config.path, access });
  declared.set(app, list);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.openapi(route, (async (c: any, next: any) => {
    if (!("public" in access)) {
      // Phase 1 replaces this with the role + action + scope check. Until then, deny.
      return c.json({ error: "unauthenticated" }, 401);
    }
    return handler(c, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}
