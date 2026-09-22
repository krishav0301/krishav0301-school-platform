import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { listMine, listPending } from "./queries";
import { ApprovalListSchema, DeclineInputSchema, MyApprovalListSchema, RequestInputSchema } from "./schema";
import { decideRequest, requestApproval, withdrawRequest } from "./service";
import type { Failure } from "./write";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("ApprovalsError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("ApprovalsInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("ApprovalsOk");
const CreatedSchema = z.object({ id: z.string() }).openapi("ApprovalsCreated");
const IdParam = z.object({ id: z.string().regex(/^[0-9a-f]{32}$/) });

const failures = {
  403: { description: "Not allowed", content: json(ErrorSchema) },
  404: { description: "No such request or subject", content: json(ErrorSchema) },
  409: { description: "It conflicts with what is already there (already resolved, or a repeat)", content: json(ErrorSchema) },
  422: { description: "The request breaks a rule; nothing changed", content: json(InvalidSchema) },
} as const;

/** Turns a service refusal into the documented answer. The cast to `never` is because the handler's type
 * is the union of what each route declares, which this one function serves for all of them. */
function fail(c: Context<AppEnv>, failure: Failure): never {
  switch (failure.reason) {
    case "invalid":
      return c.json({ error: "invalid" as const, message: failure.message }, 422) as never;
    case "not_allowed":
      return c.json({ error: "forbidden" }, 403) as never;
    case "not_found":
      return c.json({ error: "not_found" }, 404) as never;
    case "stale":
      return c.json({ error: "stale" }, 409) as never;
    default:
      return c.json({ error: failure.reason }, 409) as never;
  }
}

const REQUEST_ACTION = { action: "approvals.request" } as const;
const VIEW_OWN_ACTION = { action: "approvals.view.own" } as const;
const DECIDE_ACTION = { action: "approvals.decide" } as const;

/** The generic approvals engine's own routes (D-061): request, withdraw, decide, and the two reads. */
export function registerApprovals(app: App): void {
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/approvals",
      operationId: "request_approval",
      tags: ["approvals"],
      description: "Sends a subject for approval: it moves to its own \"waiting\" state and a pending request is made, in one batch.",
      access: REQUEST_ACTION,
      request: { body: { required: true, content: json(RequestInputSchema) } },
      responses: { 201: { description: "Sent", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await requestApproval(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/approvals/{id}/withdraw",
      operationId: "withdraw_approval",
      tags: ["approvals"],
      description: "The requester takes back their own still-pending request; the subject reverts to its pre-request state.",
      access: VIEW_OWN_ACTION,
      request: { params: IdParam },
      responses: { 200: { description: "Withdrawn (or already resolved: the same answer either way)", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await withdrawRequest(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/approvals",
      operationId: "list_pending_approvals",
      tags: ["approvals"],
      description: "The Admin's inbox: every pending request, oldest first.",
      access: DECIDE_ACTION,
      responses: { 200: { description: "The pending requests", content: json(ApprovalListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listPending(c.env.DB), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/approvals/mine",
      operationId: "list_my_approvals",
      tags: ["approvals"],
      description: "The signed-in person's own requests, any status, newest first, with the reason when declined.",
      access: VIEW_OWN_ACTION,
      responses: { 200: { description: "Your requests", content: json(MyApprovalListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listMine(c.env.DB, c.get("auth")!.userPublicId), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/approvals/{id}/approve",
      operationId: "approve_approval",
      tags: ["approvals"],
      description: "Approves a pending request, never your own. A changed subject is 409 stale.",
      access: DECIDE_ACTION,
      request: { params: IdParam },
      responses: { 200: { description: "Approved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await decideRequest(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, { approve: true });
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/approvals/{id}/decline",
      operationId: "decline_approval",
      tags: ["approvals"],
      description: "Declines a pending request with a reason, never your own. The subject reverts to its pre-request state. A changed subject is 409 stale.",
      access: DECIDE_ACTION,
      request: { params: IdParam, body: { required: true, content: json(DeclineInputSchema) } },
      responses: { 200: { description: "Declined", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await decideRequest(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, { approve: false, ...c.req.valid("json") });
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );
}
