import { z } from "@hono/zod-openapi";

import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";

const HealthSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    database: z.enum(["ok", "down"]),
  })
  .openapi("Health");

/** Liveness and database check for uptime monitoring. Reveals nothing else. */
export function registerHealth(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/health",
      operationId: "health_check",
      tags: ["health"],
      description: "Liveness and database check for uptime monitoring. Reveals nothing else.",
      access: { public: true },
      responses: {
        200: { description: "Healthy", content: { "application/json": { schema: HealthSchema } } },
        503: { description: "Database unavailable", content: { "application/json": { schema: HealthSchema } } },
      },
    },
    async (c) => {
      try {
        await c.env.DB.prepare("SELECT 1").first();
      } catch {
        return c.json({ status: "degraded", database: "down" }, 503);
      }
      return c.json({ status: "ok", database: "ok" }, 200);
    },
  );
}
