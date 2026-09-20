import { createRoute, type RouteConfig, type RouteHandler } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";

import { authorize, isKnownAction, type ActionId } from "./permissions";
import { readAccessCookie } from "./session-cookies";
import { verifyAccessToken } from "./tokens";
import type { App, AppEnv, AuthContext } from "./types";

/**
 * Every route is declared through `defineRoute`, which forces a decision about access:
 *  - `{ action }`        a permission from the matrix (`core/permissions/matrix.ts`). 401 if not
 *                        signed in, 403 if no role grants it. The handler gets `c.get("grant")`.
 *  - `{ authenticated }` any signed-in user, for things done to one's own account.
 *  - `{ public }`        anyone.
 * A route added any other way is caught by the route-coverage test, and an action that is not in
 * the matrix fails when the route is defined.
 */
export type RouteAccess = { action: ActionId } | { authenticated: true } | { public: true };

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

/** Who is calling, from the signed access cookie. No database read. Null if not signed in. */
export async function readAuth(c: Context<AppEnv>): Promise<AuthContext | null> {
  const token = readAccessCookie(c);
  const claims = token ? await verifyAccessToken(c.env.SESSION_SECRET, token) : null;
  return claims ? { userPublicId: claims.sub, sessionPublicId: claims.sid, name: claims.name, roles: claims.roles } : null;
}

export function defineRoute<R extends RouteConfig>(
  app: App,
  config: R & { access: RouteAccess },
  handler: RouteHandler<R, AppEnv>,
): void {
  const { access, ...routeConfig } = config;

  // A typo in an action must never quietly become "denied everywhere" or "allowed".
  if ("action" in access && !isKnownAction(access.action)) {
    throw new Error(`Route ${config.method.toUpperCase()} ${config.path} uses "${access.action}", which is not in the permission matrix.`);
  }

  // Access is a middleware, so it runs BEFORE the body and query are validated: an outsider learns
  // nothing about what a route expects, and always gets 401 or 403 rather than a 400.
  const checkAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
    if ("action" in access || "authenticated" in access) {
      const auth = await readAuth(c);
      const anonymousAction = "action" in access && authorize([], access.action)?.anonymous === true;

      if (!auth && !anonymousAction) return c.json({ error: "unauthenticated" }, 401);

      if (auth) c.set("auth", auth);
      if ("action" in access) {
        const grant = authorize(auth?.roles ?? [], access.action);
        if (!grant) return c.json({ error: "forbidden" }, 403);
        c.set("grant", grant);
      }
    }
    await next();
  };

  const route = createRoute({ ...routeConfig, middleware: checkAccess } as unknown as R);

  const list = declared.get(app) ?? [];
  list.push({ method: config.method.toUpperCase(), path: config.path, access });
  declared.set(app, list);

  app.openapi(route, handler);
}
