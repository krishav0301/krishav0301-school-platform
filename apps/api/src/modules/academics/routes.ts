import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { allowedSections } from "../../core/permissions";
import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { listClasses, listProgrammes, listTerminals, listYears } from "./queries";
import {
  AcademicYearListSchema,
  ClassChangesSchema,
  CreateClassSchema,
  CreateLevelSchema,
  CreateProgrammeSchema,
  CreateTerminalSchema,
  CreateYearSchema,
  LevelChangesSchema,
  ProgrammeChangesSchema,
  ProgrammeListSchema,
  PublicIdSchema,
  SchoolClassListSchema,
  TerminalChangesSchema,
  TerminalListSchema,
  YearChangesSchema,
} from "./schema";
import {
  activateYear,
  addLevel,
  createClass,
  createProgramme,
  createTerminal,
  createYear,
  updateClass,
  updateLevel,
  updateProgramme,
  updateTerminal,
  updateYear,
  type Failure,
} from "./service";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("AcademicsError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("AcademicsInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("AcademicsOk");
const CreatedSchema = z.object({ id: z.string() }).openapi("AcademicsCreated");
const IdParam = z.object({ id: PublicIdSchema });
const YearQuery = z.object({ year: PublicIdSchema.optional() });

/** The failure answers every write route documents. */
const failures = {
  403: { description: "Not allowed (for example, switched off since signing in, or another section's data)", content: json(ErrorSchema) },
  404: { description: "No such item", content: json(ErrorSchema) },
  409: { description: "It conflicts with what is already there (a repeat, a closed year, another active year)", content: json(ErrorSchema) },
  422: { description: "The change breaks a rule; nothing changed", content: json(InvalidSchema) },
} as const;

/**
 * Turns a service refusal into the documented answer. The cast to `never` is because the handler's type is the
 * union of what each route declares, which this one function serves for all of them.
 */
function fail(c: Context<AppEnv>, failure: Failure): never {
  switch (failure.reason) {
    case "invalid":
      return c.json({ error: "invalid" as const, message: failure.message }, 422) as never;
    case "not_allowed":
      return c.json({ error: "forbidden" }, 403) as never;
    case "not_found":
      return c.json({ error: "not_found" }, 404) as never;
    default:
      return c.json({ error: failure.reason }, 409) as never;
  }
}

const VIEW = { action: "setup.structure.view" } as const;
const MANAGE = { action: "setup.structure.manage" } as const;

export function registerAcademics(app: App): void {
  // --- Reads ---------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/years",
      operationId: "list_academic_years",
      tags: ["academics"],
      description: "Every academic year, newest first, with its days in both calendars.",
      access: VIEW,
      responses: { 200: { description: "The years", content: json(AcademicYearListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listYears(c.env.DB), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/programmes",
      operationId: "list_programmes",
      tags: ["academics"],
      description: "The programmes of the sections the person may see, each with its levels in order.",
      access: VIEW,
      responses: { 200: { description: "The programmes", content: json(ProgrammeListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listProgrammes(c.env.DB, allowedSections(c.get("grant")!)), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/classes",
      operationId: "list_classes",
      tags: ["academics"],
      description: "The classes of the sections the person may see, optionally of one year.",
      access: VIEW,
      request: { query: YearQuery },
      responses: { 200: { description: "The classes", content: json(SchoolClassListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listClasses(c.env.DB, allowedSections(c.get("grant")!), c.req.valid("query").year), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/terminals",
      operationId: "list_terminals",
      tags: ["academics"],
      description: "The terminals of one year, or of every year.",
      access: VIEW,
      request: { query: YearQuery },
      responses: { 200: { description: "The terminals", content: json(TerminalListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listTerminals(c.env.DB, c.req.valid("query").year), 200);
    },
  );

  // --- Years -----------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/years",
      operationId: "create_academic_year",
      tags: ["academics"],
      description: "Adds a year as a draft. Days are AD; the BS year must be one whose calendar is verified.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateYearSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createYear(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/years/{id}",
      operationId: "update_academic_year",
      tags: ["academics"],
      description: "Changes a draft year's label or days. Send only what changes.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(YearChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateYear(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/years/{id}/activate",
      operationId: "activate_academic_year",
      tags: ["academics"],
      description: "Makes a draft year the active one. Refused (409) while another year is active.",
      access: MANAGE,
      request: { params: IdParam },
      responses: { 200: { description: "Now active", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await activateYear(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Programmes and levels ---------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/programmes",
      operationId: "create_programme",
      tags: ["academics"],
      description: "Adds a programme to a section the person may manage.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateProgrammeSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createProgramme(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/programmes/{id}",
      operationId: "update_programme",
      tags: ["academics"],
      description: "Renames a programme, changes its affiliation, or switches it off and on. Nothing is deleted.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(ProgrammeChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateProgramme(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/programmes/{id}/levels",
      operationId: "add_level",
      tags: ["academics"],
      description: "Adds a level (Grade 11, Year 1) to a programme, numbered after the last one.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(CreateLevelSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await addLevel(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/levels/{id}",
      operationId: "update_level",
      tags: ["academics"],
      description: "Renames a level or switches it off and on. Nothing is deleted.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(LevelChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateLevel(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Classes -----------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/classes",
      operationId: "create_class",
      tags: ["academics"],
      description: "Makes a class: a level in a year, with an optional label such as Morning. A repeat is 409; a closed year is 409 `year_closed`.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateClassSchema) } },
      responses: { 201: { description: "Made", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createClass(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/classes/{id}",
      operationId: "update_class",
      tags: ["academics"],
      description: "Relabels a class or switches it off and on. A closed year cannot be changed.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(ClassChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateClass(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Terminals ---------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/terminals",
      operationId: "create_terminal",
      tags: ["academics"],
      description: "Adds a terminal to a year, numbered after the last one.",
      access: MANAGE,
      request: { body: { required: true, content: json(CreateTerminalSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createTerminal(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/terminals/{id}",
      operationId: "update_terminal",
      tags: ["academics"],
      description: "Renames a terminal. A closed year cannot be changed.",
      access: MANAGE,
      request: { params: IdParam, body: { required: true, content: json(TerminalChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateTerminal(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );
}
