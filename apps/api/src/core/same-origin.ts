import { createMiddleware } from "hono/factory";

import type { AppEnv } from "./types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated requests (D-021). Every request that changes state must
 * come from our own origin. There is no CORS, so no other origin is ever allowed.
 *
 * Browsers always send `Sec-Fetch-Site` on modern versions, and `Origin` on cross-origin writes.
 * A request that carries neither is refused: it is not a browser page of ours.
 */
export const sameOriginOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const site = c.req.header("Sec-Fetch-Site");
  const origin = c.req.header("Origin");
  const ownOrigin = new URL(c.req.url).origin;

  const allowed = site !== undefined ? site === "same-origin" : origin !== undefined && origin === ownOrigin;

  if (!allowed) return c.json({ error: "cross_origin_request_refused" }, 403);
  await next();
});
