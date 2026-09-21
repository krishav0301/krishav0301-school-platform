import { OpenAPIHono } from "@hono/zod-openapi";

import { environmentGuard } from "./core/environment";
import { sameOriginOnly } from "./core/same-origin";
import type { AppEnv } from "./core/types";
import { registerAcademics } from "./modules/academics/routes";
import { registerSubjects } from "./modules/academics/subject-routes";
import { registerAccounts } from "./modules/accounts/routes";
import { registerStaff } from "./modules/accounts/staff-routes";
import { registerAuth } from "./modules/auth/routes";
import { registerConfig } from "./modules/config/routes";
import { registerContent } from "./modules/content/routes";
import { registerDates } from "./modules/dates/routes";
import { registerHealth } from "./modules/health/routes";
import { registerSite } from "./modules/site/routes";

/**
 * Builds the API. Each module registers its own routes. A function, not a constant, so tests can
 * build fresh apps and the OpenAPI generator can build one without a running Worker.
 */
export function createApp() {
  const app = new OpenAPIHono<AppEnv>({ strict: true });

  app.use("*", environmentGuard);
  app.use("/api/*", sameOriginOnly);

  registerHealth(app);
  registerAuth(app);
  registerAccounts(app);
  registerStaff(app);
  registerAcademics(app);
  registerSubjects(app);
  registerConfig(app);
  registerContent(app);
  registerDates(app);
  registerSite(app);

  return app;
}

export const OPENAPI_INFO = { title: "School Platform API", version: "0.1.0" } as const;
