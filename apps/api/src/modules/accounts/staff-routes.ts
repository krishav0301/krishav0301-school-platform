import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { listPeople } from "./people";
import { createStaff, createTeacher, issueTemporaryPassword, listStaff, setStaffAccess, setStaffActive, type StaffFailure } from "./staff";
import { AccessChangesSchema, CreateStaffSchema, CreateTeacherSchema, PeopleListSchema, PeopleQuerySchema, StaffChangesSchema, StaffListSchema } from "./staff-schema";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("StaffError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("StaffInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("StaffOk");
const IdParam = z.object({ id: z.string().regex(/^[0-9a-f]{32}$/) });

/** The one-time password of a person just made, returned here and nowhere else. */
const StaffCreatedSchema = z.object({ id: z.string(), temporaryPassword: z.string() }).openapi("StaffCreated");
const TemporaryPasswordSchema = z.object({ temporaryPassword: z.string() }).openapi("TemporaryPassword");

const writeErrors = {
  403: { description: "Not allowed (not your role, not your section, not your own account, or switched off since signing in)", content: json(ErrorSchema) },
  404: { description: "No such person or section", content: json(ErrorSchema) },
  409: { description: "That email address is already used (`email_taken`)", content: json(ErrorSchema) },
  422: { description: "The change breaks a rule; nothing changed", content: json(InvalidSchema) },
} as const;

/** Turns a service refusal into the documented answer (the cast is because one function serves every route's answer type). */
function fail(c: Context<AppEnv>, failure: StaffFailure | { ok: false; reason: "not_allowed" | "not_found" }): never {
  switch (failure.reason) {
    case "invalid":
      return c.json({ error: "invalid" as const, message: failure.message }, 422) as never;
    case "not_allowed":
      return c.json({ error: "forbidden" }, 403) as never;
    case "not_found":
      return c.json({ error: "not_found" }, 404) as never;
    default:
      return c.json({ error: "email_taken" }, 409) as never;
  }
}

/** Staff accounts (D-059): the list, adding people, switching them off and on, and a new temporary password. */
export function registerStaff(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/staff",
      operationId: "list_staff",
      tags: ["accounts"],
      description:
        "The staff the person may see: an Admin sees Co-ordinators, Accountants and teachers; a Co-ordinator sees only teachers (only their own section's, if their scope is one section); a Super Admin also sees Admins. Never a Super Admin, and never a password or hash.",
      access: { action: "accounts.staff.view" },
      responses: { 200: { description: "The staff", content: json(StaffListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listStaff(c.env.DB, c.get("auth")!.roles), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/staff",
      operationId: "create_staff",
      tags: ["accounts"],
      description:
        "Adds a Co-ordinator or an Accountant, whole-school or limited to some switched-on sections (`sectionKeys`, D-099; `sectionKey` for one). The answer carries a one-time temporary password, shown to the person adding them and never again; the new person must choose their own at first sign-in.",
      access: { action: "accounts.staff.create" },
      request: { body: { required: true, content: json(CreateStaffSchema) } },
      responses: { 201: { description: "Added, with the temporary password (never cached)", content: json(StaffCreatedSchema) }, ...writeErrors },
    },
    async (c) => {
      const result = await createStaff(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      if (!result.ok) return fail(c, result);
      c.header("Cache-Control", "no-store");
      return c.json({ id: result.publicId, temporaryPassword: result.temporaryPassword }, 201);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/teachers",
      operationId: "create_teacher",
      tags: ["accounts"],
      description:
        "Adds a teacher with a home section. A section-scoped Co-ordinator can only choose their own section. The answer carries a one-time temporary password, as for any new person.",
      access: { action: "accounts.teacher.create" },
      request: { body: { required: true, content: json(CreateTeacherSchema) } },
      responses: { 201: { description: "Added, with the temporary password (never cached)", content: json(StaffCreatedSchema) }, ...writeErrors },
    },
    async (c) => {
      const result = await createTeacher(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      if (!result.ok) return fail(c, result);
      c.header("Cache-Control", "no-store");
      return c.json({ id: result.publicId, temporaryPassword: result.temporaryPassword }, 201);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/staff/{id}",
      operationId: "update_staff",
      tags: ["accounts"],
      description: "Switches a person off or on. Switching off also ends their open sessions at once. Nobody changes their own account.",
      access: { action: "accounts.deactivate" },
      request: { params: IdParam, body: { required: true, content: json(StaffChangesSchema) } },
      responses: { 200: { description: "Done (or already so)", content: json(OkSchema) }, ...writeErrors },
    },
    async (c) => {
      const result = await setStaffActive(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").active);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/staff/{id}/temporary-password",
      operationId: "issue_temporary_password",
      tags: ["accounts"],
      description:
        "Gives a person a new temporary password, for a forgotten one. Their old password stops working, their open sessions end, and they must choose a new one at once. The password is in this answer and nowhere else.",
      access: { action: "accounts.password.issue" },
      request: { params: IdParam },
      responses: { 200: { description: "Issued (never cached)", content: json(TemporaryPasswordSchema) }, ...writeErrors },
    },
    async (c) => {
      const result = await issueTemporaryPassword(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      if (!result.ok) return fail(c, result);
      c.header("Cache-Control", "no-store");
      return c.json({ temporaryPassword: result.temporaryPassword }, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/people",
      operationId: "list_people",
      tags: ["accounts"],
      description:
        "The People & Access screen (D-099): one page of the administrative staff (`group=admin`: Co-ordinators and Accountants) or the teaching staff (`group=teaching`), searched, filtered and paged in the database, with the switched-on counts and every section. An Admin or Super Admin sees both lists; a Co-ordinator sees only teachers, and only their own sections' if limited. A teacher carries their subjects, programmes and who added them. Never a password or hash.",
      access: { action: "accounts.staff.view" },
      request: { query: PeopleQuerySchema },
      responses: { 200: { description: "The page", content: json(PeopleListSchema) } },
    },
    async (c) => {
      const auth = c.get("auth")!;
      c.header("Cache-Control", "no-store");
      return c.json(await listPeople(c.env.DB, auth.roles, auth.userPublicId, c.req.valid("query")), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/staff/{id}/access",
      operationId: "update_staff_access",
      tags: ["accounts"],
      description:
        "Changes which sections a Co-ordinator's or Accountant's access reaches (D-099): `[]` for the whole school, or switched-on sections. Admin or Super Admin only, never for themselves. Takes effect at the person's next sign-in renewal (within 30 minutes); money, approval and publish actions re-check at once. Audited.",
      access: { action: "accounts.staff.access" },
      request: { params: IdParam, body: { required: true, content: json(AccessChangesSchema) } },
      responses: { 200: { description: "Done (or already so)", content: json(OkSchema) }, ...writeErrors },
    },
    async (c) => {
      const result = await setStaffAccess(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").sectionKeys);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );
}
