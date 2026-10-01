import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { allowedSections } from "../../core/permissions";
import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { getSetupChecklist, getTeaching, listClasses, listProgrammes, listTerminals, listYears } from "./queries";
import {
  AcademicYearListSchema,
  AssignmentInputSchema,
  ClassChangesSchema,
  ClassTeacherInputSchema,
  CreateClassSchema,
  CreateLevelSchema,
  CreateProgrammeSchema,
  CreateSectionSchema,
  CreateTerminalSchema,
  CreateYearSchema,
  LevelChangesSchema,
  ProgrammeChangesSchema,
  ProgrammeListSchema,
  PublicIdSchema,
  SchoolClassListSchema,
  SectionChangesSchema,
  SectionKeyParam,
  SetupChecklistSchema,
  TeachingSchema,
  TerminalChangesSchema,
  TerminalListSchema,
  YearChangesSchema,
} from "./schema";
import {
  activateYear,
  addLevel,
  createClass,
  createProgramme,
  createSection,
  createTerminal,
  createYear,
  setAssignment,
  setClassTeacher,
  updateClass,
  deleteClass,
  deleteLevel,
  deleteProgramme,
  deleteSection,
  updateSection,
  updateLevel,
  updateProgramme,
  updateTerminal,
  updateYear,
  type Done,
  type Failure,
} from "./service";

export const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
export const ErrorSchema = z.object({ error: z.string() }).openapi("AcademicsError");
export const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("AcademicsInvalid");
export const OkSchema = z.object({ ok: z.literal(true) }).openapi("AcademicsOk");
export const CreatedSchema = z.object({ id: z.string() }).openapi("AcademicsCreated");
export const IdParam = z.object({ id: PublicIdSchema });
const YearQuery = z.object({ year: PublicIdSchema.optional() });

/** The failure answers every write route documents. */
export const failures = {
  403: { description: "Not allowed (for example, switched off since signing in, or another section's data)", content: json(ErrorSchema) },
  404: { description: "No such item", content: json(ErrorSchema) },
  409: { description: "It conflicts with what is already there (a repeat, a closed year, another active year)", content: json(ErrorSchema) },
  422: { description: "The change breaks a rule; nothing changed", content: json(InvalidSchema) },
} as const;

/**
 * Turns a service refusal into the documented answer. The cast to `never` is because the handler's type is the
 * union of what each route declares, which this one function serves for all of them.
 */
export function fail(c: Context<AppEnv>, failure: Failure): never {
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

export const VIEW = { action: "setup.structure.view" } as const;
export const MANAGE = { action: "setup.structure.manage" } as const;
/** Programmes and their levels: the Admin alone (D-087). */
export const MANAGE_PROGRAMMES = { action: "setup.programmes.manage" } as const;

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

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/checklist",
      operationId: "get_setup_checklist",
      tags: ["academics"],
      description: "A Co-ordinator's setup checklist: what is done and what is left, computed fresh each time. Nothing is stored.",
      access: VIEW,
      responses: { 200: { description: "The checklist", content: json(SetupChecklistSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await getSetupChecklist(c.env.DB, allowedSections(c.get("grant")!)), 200);
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

  // --- Sections (D-095) ----------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/sections",
      operationId: "create_section",
      tags: ["academics"],
      description: "Adds a section (for example Bachelor's, Master's, Primary). A school starts with none. The key is generated and never changes.",
      access: MANAGE_PROGRAMMES,
      request: { body: { required: true, content: json(CreateSectionSchema) } },
      responses: { 201: { description: "Added", content: json(z.object({ key: z.string() })) }, ...failures },
    },
    async (c) => {
      const result = await createSection(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ key: result.key }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/sections/{key}",
      operationId: "update_section",
      tags: ["academics"],
      description: "Renames a section, or switches it off and on (D-097). Its key, and everything counted by it, stays the same.",
      access: MANAGE_PROGRAMMES,
      request: { params: SectionKeyParam, body: { required: true, content: json(SectionChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateSection(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").key, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Deleting what nothing is attached to (D-097) -----------------------------------------------------------
  const removal = (path: string, operationId: string, what: string, param: z.ZodObject, run: (c: Context<AppEnv>, id: string, actor: string) => Promise<Done>, access: typeof MANAGE | typeof MANAGE_PROGRAMMES = MANAGE_PROGRAMMES) =>
    defineRoute(
      app,
      {
        method: "delete",
        path,
        operationId,
        tags: ["academics"],
        description: `Deletes a ${what} that nothing is attached to. One with anything attached is refused with 409 "in_use": switch it off instead, which keeps its history.`,
        access,
        request: { params: param },
        responses: { 200: { description: "Deleted", content: json(OkSchema) }, ...failures },
      },
      async (c) => {
        const params = c.req.valid("param") as Record<string, string>;
        const result = await run(c, params.key ?? params.id!, c.get("auth")!.userPublicId);
        return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
      },
    );
  removal("/api/academics/sections/{key}", "delete_section", "section", SectionKeyParam, (c, key, actor) => deleteSection(c.env.DB, c.env.AUDIT_HMAC_KEY, actor, key));
  removal("/api/academics/programmes/{id}", "delete_programme", "programme", IdParam, (c, id, actor) => deleteProgramme(c.env.DB, c.env.AUDIT_HMAC_KEY, actor, id));
  removal("/api/academics/levels/{id}", "delete_level", "level", IdParam, (c, id, actor) => deleteLevel(c.env.DB, c.env.AUDIT_HMAC_KEY, actor, id));
  // A class is the Co-ordinator's, like the rest of the year's setup (`setup.structure.manage`).
  removal("/api/academics/classes/{id}", "delete_class", "class", IdParam, (c, id, actor) => deleteClass(c.env.DB, c.env.AUDIT_HMAC_KEY, actor, id), MANAGE);

  // --- Programmes and levels ---------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/programmes",
      operationId: "create_programme",
      tags: ["academics"],
      description: "Adds a programme to a section the person may manage.",
      access: MANAGE_PROGRAMMES,
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
      access: MANAGE_PROGRAMMES,
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
      access: MANAGE_PROGRAMMES,
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
      access: MANAGE_PROGRAMMES,
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

  // --- Teaching (D-060) ---------------------------------------------------------------------------------
  const VIEW_ASSIGNMENTS = { action: "setup.assignments.view" } as const;
  const MANAGE_ASSIGNMENTS = { action: "setup.assignments.manage" } as const;

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/classes/{id}/teaching",
      operationId: "get_teaching",
      tags: ["academics"],
      description: "One class's subjects with their current teacher, its Class Teacher, and the teachers the person may pick from. A class outside the person's sections is 404, the same as a missing one.",
      access: VIEW_ASSIGNMENTS,
      request: { params: IdParam },
      responses: { 200: { description: "The class's teaching", content: json(TeachingSchema) }, 404: { description: "No such class, or not one the person may see", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const teaching = await getTeaching(c.env.DB, allowedSections(c.get("grant")!), c.req.valid("param").id);
      return teaching ? c.json(teaching, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/assignments",
      operationId: "set_assignment",
      tags: ["academics"],
      description: "Assigns a teacher to a subject in a class, or (teacherId null) removes the assignment. Ends any earlier assignment for the same subject in the same class.",
      access: MANAGE_ASSIGNMENTS,
      request: { body: { required: true, content: json(AssignmentInputSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await setAssignment(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/classes/{id}/class-teacher",
      operationId: "set_class_teacher",
      tags: ["academics"],
      description: "Sets or (teacherId null) clears a class's Class Teacher. A teacher already Class Teacher of another class this year is 409.",
      access: MANAGE_ASSIGNMENTS,
      request: { params: IdParam, body: { required: true, content: json(ClassTeacherInputSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await setClassTeacher(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").teacherId);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );
}
