import { z } from "@hono/zod-openapi";

import { auditTrail, signInLog } from "../../core/audit";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { AuditTrailQuery, AuditTrailSchema, SignInLogSchema, SignInQuery } from "./schema";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

/**
 * The Admin's Audit trail and Sign-ins views (CLAUDE.md section 6, D-102, admin FUT F-11). Read only, for whoever holds
 * `audit.view` (the Admin and Support). No route edits or deletes an entry: the log is insert-only.
 */
export function registerAudit(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/audit/events",
      operationId: "audit_trail",
      tags: ["audit"],
      description: "The audit trail, newest first, 25 to a page, optionally of one area and matching a search. Support's own actions show as \"Support\".",
      access: { action: "audit.view" },
      request: { query: AuditTrailQuery },
      responses: { 200: { description: "One page of the audit trail", content: json(AuditTrailSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { page, area, q } = c.req.valid("query");
      return c.json(await auditTrail(c.env.DB, { page, area, q }), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/audit/sign-ins",
      operationId: "sign_in_log",
      tags: ["audit"],
      description: "Sign-in attempts, newest first, 25 to a page, optionally only the failed ones (failed passwords and failed second steps) or matching a search.",
      access: { action: "audit.view" },
      request: { query: SignInQuery },
      responses: { 200: { description: "One page of sign-in attempts", content: json(SignInLogSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { page, failed, q } = c.req.valid("query");
      return c.json(await signInLog(c.env.DB, { page, failedOnly: failed === "1", q }), 200);
    },
  );
}
