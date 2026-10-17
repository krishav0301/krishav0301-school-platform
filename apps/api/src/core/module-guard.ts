import type { MiddlewareHandler } from "hono";

import { OFF_BY_DEFAULT } from "./config/modules";
import type { AppEnv } from "./types";

/**
 * A module a school may switch off (D-137): while it is off, everything under its address answers "not found", as if it
 * did not exist. Read from `module_switches` on each request to that module, so a pack applied later takes effect at once;
 * a module with no row is on, unless it is one of the few that are off until a pack turns them on (`OFF_BY_DEFAULT`).
 * One small read, and only on that module's own addresses.
 */
export const moduleRequired =
  (key: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const row = await c.env.DB.prepare("SELECT enabled FROM module_switches WHERE key = ?1").bind(key).first<{ enabled: number }>();
    const on = row ? row.enabled === 1 : !OFF_BY_DEFAULT.includes(key);
    if (!on) return c.json({ error: "not_found" }, 404);
    await next();
  };
