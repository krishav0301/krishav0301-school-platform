import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "./types";

/**
 * A module a school may switch off (D-137): while it is off, everything under its address answers "not found", as if it
 * did not exist. Read from `module_switches` on each request to that module, so a pack applied later takes effect at once;
 * a module with no row is on. One small read, and only on that module's own addresses.
 */
export const moduleRequired =
  (key: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const row = await c.env.DB.prepare("SELECT enabled FROM module_switches WHERE key = ?1").bind(key).first<{ enabled: number }>();
    if (row && row.enabled === 0) return c.json({ error: "not_found" }, 404);
    await next();
  };
