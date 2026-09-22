import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { runInBackground } from "../../core/background";
import { runOutbox } from "../../core/notifications";
import { allowedSections } from "../../core/permissions";
import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { getApplication, getOwnStudent, getStudent, listOpenLevels, listQueue, searchStudents } from "./queries";
import {
  ApplicationDetailSchema,
  ApplicationQueueSchema,
  ApplySchema,
  ApproveSchema,
  OpenLevelListSchema,
  PublicIdSchema,
  RejectSchema,
  RequestChangesSchema,
  StudentDetailSchema,
  StudentListSchema,
  VerifyEmailSchema,
  WalkInSchema,
} from "./schema";
import { applyForAdmission, approveApplication, registerStudent, registerWalkIn, reject, requestChanges, verifyApplicationEmail, type WriteFailure } from "./service";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("AdmissionsError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("AdmissionsInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("AdmissionsOk");
const CreatedSchema = z.object({ id: z.string() }).openapi("AdmissionsCreated");
const IdParam = z.object({ id: PublicIdSchema });

const failures = {
  403: { description: "Not allowed", content: json(ErrorSchema) },
  404: { description: "No such item", content: json(ErrorSchema) },
  409: { description: "It conflicts with what is already there", content: json(ErrorSchema) },
  422: { description: "The change breaks a rule; nothing changed", content: json(InvalidSchema) },
} as const;

/** Delivers whatever a request just queued (an email), the same as the other modules that send one. */
async function deliver(c: Context<AppEnv>): Promise<void> {
  const pending = runInBackground(c, runOutbox(c.env));
  if (pending) await pending;
}

function fail(c: Context<AppEnv>, failure: WriteFailure | { ok: false; reason: string; message?: string }): never {
  if (failure.reason === "invalid") return c.json({ error: "invalid" as const, message: (failure as { message: string }).message }, 422) as never;
  if (failure.reason === "not_allowed") return c.json({ error: "forbidden" }, 403) as never;
  if (failure.reason === "not_found") return c.json({ error: "not_found" }, 404) as never;
  if (failure.reason === "throttled") return c.json({ error: "too_many_attempts" }, 429) as never;
  return c.json({ error: failure.reason }, 409) as never;
}

const APPLY_ACTION = { action: "admissions.apply" } as const;
const WALKIN_ACTION = { action: "admissions.walkin.register" } as const;
const REGISTER_ACTION = { action: "admissions.student.register" } as const;
const REVIEW_ACTION = { action: "admissions.review" } as const;
const SEARCH_ACTION = { action: "students.search" } as const;
const VIEW_ACTION = { action: "students.personal.view" } as const;

export function registerAdmissions(app: App): void {
  // --- The public application ------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/admissions/levels",
      operationId: "list_open_levels",
      tags: ["admissions"],
      description: "Every open level, for the public application form's picker. Anonymous, the same reach as applying itself.",
      access: APPLY_ACTION,
      responses: { 200: { description: "The open levels", content: json(OpenLevelListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listOpenLevels(c.env.DB), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/admissions/apply",
      operationId: "apply_for_admission",
      tags: ["admissions"],
      description: "Applies for admission. Anonymous, rate limited. A submission token makes a retried request change nothing new. Enters the queue once the email is verified.",
      access: APPLY_ACTION,
      request: { body: { required: true, content: json(ApplySchema) } },
      responses: { 201: { description: "Received", content: json(CreatedSchema) }, 404: { description: "No such level, or no active year", content: json(ErrorSchema) }, 422: failures[422], 429: { description: "Too many recent attempts", content: json(ErrorSchema) } },
    },
    async (c) => {
      const ip = c.req.header("CF-Connecting-IP") ?? "0.0.0.0";
      const result = await applyForAdmission(c.env.DB, c.env.DATA_KEY, c.req.valid("json"), ip);
      if (!result.ok) return fail(c, result);
      await deliver(c);
      return c.json({ id: result.publicId }, 201);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/admissions/verify",
      operationId: "verify_admission_email",
      tags: ["admissions"],
      description: "Confirms the applicant's email from the link sent to them, and puts the application in the queue.",
      access: { public: true },
      request: { body: { required: true, content: json(VerifyEmailSchema) } },
      responses: { 200: { description: "Confirmed", content: json(OkSchema) }, 401: { description: "The link has expired or was already used", content: json(ErrorSchema) } },
    },
    async (c) => {
      const result = await verifyApplicationEmail(c.env.DB, c.req.valid("json").token);
      return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: "invalid_or_expired" }, 401);
    },
  );

  // --- Staff-entered applications ----------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/admissions/walk-ins",
      operationId: "register_walk_in",
      tags: ["admissions"],
      description: "The Co-ordinator registers a walk-in and places them straight into a class. Auto-approved.",
      access: WALKIN_ACTION,
      request: { body: { required: true, content: json(WalkInSchema.extend({ classId: PublicIdSchema })) } },
      responses: { 201: { description: "Admitted", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await registerWalkIn(c.env.DB, c.env.AUDIT_HMAC_KEY, c.env.DATA_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      if (!result.ok) return fail(c, result);
      await deliver(c);
      return c.json({ id: result.publicId }, 201);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/admissions/register",
      operationId: "register_student",
      tags: ["admissions"],
      description: "The Accountant registers a student. Goes to the Co-ordinator's review queue like a public applicant who has verified their email.",
      access: REGISTER_ACTION,
      request: { body: { required: true, content: json(WalkInSchema) } },
      responses: { 201: { description: "Sent to the queue", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await registerStudent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  // --- The review queue ---------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/admissions/queue",
      operationId: "list_admission_queue",
      tags: ["admissions"],
      description: "Applications waiting on a decision, oldest first, scoped to the person's sections.",
      access: REVIEW_ACTION,
      responses: { 200: { description: "The queue", content: json(ApplicationQueueSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listQueue(c.env.DB, allowedSections(c.get("grant")!)), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/admissions/applications/{id}",
      operationId: "get_application",
      tags: ["admissions"],
      description: "One application in full, for the review screen. Outside the person's sections is 404, the same as a missing one.",
      access: REVIEW_ACTION,
      request: { params: IdParam },
      responses: { 200: { description: "The application", content: json(ApplicationDetailSchema) }, 404: { description: "No such application, or not one the person may see", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const found = await getApplication(c.env.DB, allowedSections(c.get("grant")!), c.req.valid("param").id);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/admissions/applications/{id}/request-changes",
      operationId: "request_application_changes",
      tags: ["admissions"],
      description: "Asks the applicant to change one or more fields, with a reason. The applicant is emailed.",
      access: REVIEW_ACTION,
      request: { params: IdParam, body: { required: true, content: json(RequestChangesSchema) } },
      responses: { 200: { description: "Sent", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await requestChanges(c.env.DB, c.env.AUDIT_HMAC_KEY, c.env.DATA_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      if (!result.ok) return fail(c, result);
      await deliver(c);
      return c.json({ ok: true as const }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/admissions/applications/{id}/reject",
      operationId: "reject_application",
      tags: ["admissions"],
      description: "Rejects the application, with a reason. Final: the applicant must reapply.",
      access: REVIEW_ACTION,
      request: { params: IdParam, body: { required: true, content: json(RejectSchema) } },
      responses: { 200: { description: "Rejected", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await reject(c.env.DB, c.env.AUDIT_HMAC_KEY, c.env.DATA_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      if (!result.ok) return fail(c, result);
      await deliver(c);
      return c.json({ ok: true as const }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/admissions/applications/{id}/approve",
      operationId: "approve_application",
      tags: ["admissions"],
      description: "Approves the application: assigns the SID, creates the student and their login, and enrolls them in the given class. The class must be active and of the application's own level.",
      access: REVIEW_ACTION,
      request: { params: IdParam, body: { required: true, content: json(ApproveSchema) } },
      responses: { 200: { description: "Admitted", content: json(z.object({ ok: z.literal(true), sid: z.string(), studentId: z.string() })) }, ...failures },
    },
    async (c) => {
      const result = await approveApplication(c.env.DB, c.env.AUDIT_HMAC_KEY, c.env.DATA_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      if (!result.ok) return fail(c, result);
      await deliver(c);
      return c.json({ ok: true as const, sid: result.sid, studentId: result.studentId }, 200);
    },
  );

  // --- Students ------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/students",
      operationId: "search_students",
      tags: ["students"],
      description: "By name, SID or phone, scoped to the person's sections.",
      access: SEARCH_ACTION,
      request: { query: z.object({ q: z.string().trim().min(1, "Type something to search for") }) },
      responses: { 200: { description: "Matches", content: json(StudentListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await searchStudents(c.env.DB, allowedSections(c.get("grant")!), c.req.valid("query").q), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/students/me",
      operationId: "get_own_student",
      tags: ["students"],
      description: "The signed-in student's own record.",
      access: VIEW_ACTION,
      responses: { 200: { description: "The record", content: json(StudentDetailSchema) }, 404: { description: "No student record for this sign-in", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const found = await getOwnStudent(c.env.DB, c.get("auth")!.userPublicId);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/students/{id}",
      operationId: "get_student",
      tags: ["students"],
      description: "One student's personal details, for staff. Outside the person's sections is 404, the same as a missing one.",
      access: VIEW_ACTION,
      request: { params: IdParam },
      responses: { 200: { description: "The record", content: json(StudentDetailSchema) }, 404: { description: "No such student, or not one the person may see", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (grant.own) return c.json({ error: "not_found" }, 404); // a student reaches only /me, never another id
      const found = await getStudent(c.env.DB, allowedSections(grant), c.req.valid("param").id);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );
}
