import { z } from "@hono/zod-openapi";

import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { DashboardOverviewSchema } from "./schema";
import { dashboardOverview } from "./service";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

/** The Principal's dashboard (D-088): the Admin and Support only; every figure from the database as of now. */
export function registerDashboard(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/dashboard/overview",
      operationId: "dashboard_overview",
      tags: ["dashboard"],
      description: "The whole school at a glance for the Principal: students, staff, attendance, fees, programmes, results, what needs attention and the website. One round trip.",
      access: { action: "dashboard.overview.view" },
      responses: { 200: { description: "The dashboard", content: json(DashboardOverviewSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await dashboardOverview(c.env.DB, c.env), 200);
    },
  );
}
