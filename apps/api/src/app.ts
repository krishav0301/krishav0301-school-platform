import { OpenAPIHono } from "@hono/zod-openapi";

import { environmentGuard } from "./core/environment";
import { moduleRequired } from "./core/module-guard";
import { logUnhandledError, unhandledErrorResponse } from "./core/error-handler";
import { sameOriginOnly } from "./core/same-origin";
import type { AppEnv } from "./core/types";
import { registerAcademics } from "./modules/academics/routes";
import { registerClassHub } from "./modules/academics/class-hub-routes";
import { registerSetupMap } from "./modules/academics/map-routes";
import { registerSubjects } from "./modules/academics/subject-routes";
import { registerAccounts } from "./modules/accounts/routes";
import { registerStaff } from "./modules/accounts/staff-routes";
import { registerAdmissions, studentLeaveApprovalHandler } from "./modules/admissions";
import { registerApprovalHandler } from "./modules/approvals/service";
import { registerAttendance } from "./modules/attendance";
import { registerCards } from "./modules/cards";
import { registerClasswork } from "./modules/classwork";
import { registerApprovals } from "./modules/approvals/routes";
import { registerAuth } from "./modules/auth/routes";
import { registerConfig } from "./modules/config/routes";
import { registerContent } from "./modules/content/routes";
import { registerContentApprovalHandler } from "./modules/content";
import { registerFees, registerFeesApprovalHandlers } from "./modules/fees";
import { registerResults } from "./modules/results";
import { registerAudit } from "./modules/audit/routes";
import { registerDashboard } from "./modules/dashboard/routes";
import { registerDates } from "./modules/dates/routes";
import { registerHealth } from "./modules/health/routes";
import { registerNotifications } from "./modules/notifications/routes";
import { registerSite } from "./modules/site/routes";

/**
 * Builds the API. Each module registers its own routes. A function, not a constant, so tests can
 * build fresh apps and the OpenAPI generator can build one without a running Worker.
 */
export function createApp() {
  const app = new OpenAPIHono<AppEnv>({ strict: true });

  app.use("*", environmentGuard);
  app.use("/api/*", sameOriginOnly);
  // A school that does not collect fees switches the module off: its whole address family is then "not found" (D-137).
  app.use("/api/fees/*", moduleRequired("fees"));
  // The same for the daily activity log (D-139).
  app.use("/api/activity/*", moduleRequired("activity_log"));
  // RFID cards (D-174): off unless the school's pack switches `card_attendance` on.
  app.use("/api/cards/*", moduleRequired("card_attendance"));
  // And for elective subjects (D-142): making groups, and every pick.
  for (const path of ["/api/results/classes/:classId/electives", "/api/results/enrollments/:enrollmentId/electives/:groupId", "/api/academics/levels/:id/groups", "/api/academics/groups/:id"]) {
    app.use(path, moduleRequired("electives"));
  }

  // The composition root: each kind's handler is registered here, so the generic `approvals` engine
  // never imports a specific kind's module (D-061).
  registerContentApprovalHandler();
  registerFeesApprovalHandlers();
  registerApprovalHandler("student_leave", studentLeaveApprovalHandler);

  registerHealth(app);
  registerAuth(app);
  registerAccounts(app);
  registerStaff(app);
  registerAcademics(app);
  registerSubjects(app);
  registerSetupMap(app);
  registerClassHub(app);
  registerConfig(app);
  registerContent(app);
  registerApprovals(app);
  registerAdmissions(app);
  registerAttendance(app);
  registerCards(app);
  registerClasswork(app);
  registerFees(app);
  registerResults(app);
  registerDashboard(app);
  registerAudit(app);
  registerDates(app);
  registerNotifications(app);
  registerSite(app);

  // An unhandled exception is otherwise silent: Hono answers it, but nothing records that it happened
  // (Release A go-live checklist, D-067). This is the free half of "error alerts" — the log line a
  // real alerting service (Sentry or similar) would forward once the PM chooses one and gives it a
  // secret to read; until then, the error is at least visible in the Worker's own logs.
  app.onError((err, c) => {
    logUnhandledError(err, c.req.method, c.req.path);
    return unhandledErrorResponse(c);
  });

  return app;
}

export const OPENAPI_INFO = { title: "School Platform API", version: "0.1.0" } as const;
