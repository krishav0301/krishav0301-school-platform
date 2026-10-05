import { z } from "@hono/zod-openapi";

import { allowedSections } from "../../core/permissions";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { getCurriculum, listSubjects } from "./queries";
import {
  ComponentChangesSchema,
  CreateComponentSchema,
  CreateGroupSchema,
  CreateOfferingSchema,
  CreateSubjectSchema,
  CurriculumSchema,
  GroupChangesSchema,
  OfferingChangesSchema,
  PublicIdSchema,
  SubjectChangesSchema,
  SubjectListSchema,
} from "./schema";
import { CreatedSchema, ErrorSchema, IdParam, OkSchema, fail, failures, json } from "./routes";
import { addComponent, createGroup, createOffering, createSubject, updateComponent, updateGroup, updateOffering, updateSubject } from "./service";

const LevelQuery = z.object({ level: PublicIdSchema });
const VIEW_SUBJECTS = { action: "setup.subjects.view" } as const;
const MANAGE_SUBJECTS = { action: "setup.subjects.manage" } as const;

/** The subject catalogue and what each programme level teaches (D-058): elective groups, offerings and mark components. */
export function registerSubjects(app: App): void {
  // --- Reads ---------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/subjects",
      operationId: "list_subjects",
      tags: ["academics"],
      description: "The school's subject catalogue, by name. Archived subjects are included and marked.",
      access: VIEW_SUBJECTS,
      responses: { 200: { description: "The subjects", content: json(SubjectListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listSubjects(c.env.DB, allowedSections(c.get("grant")!)), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/curriculum",
      operationId: "get_curriculum",
      tags: ["academics"],
      description:
        "One programme level's elective groups, subjects and mark components, in one answer. Marks and credit hours are whole hundredths. A level in a section the person may not see is 404, the same as a missing one.",
      access: VIEW_SUBJECTS,
      request: { query: LevelQuery },
      responses: {
        200: { description: "The level's curriculum", content: json(CurriculumSchema) },
        404: { description: "No such level, or not one the person may see", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const curriculum = await getCurriculum(c.env.DB, allowedSections(c.get("grant")!), c.req.valid("query").level);
      return curriculum ? c.json(curriculum, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  // --- The catalogue -----------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/subjects",
      operationId: "create_subject",
      tags: ["academics"],
      description: "Adds a subject to the catalogue. Any Co-ordinator may: an entry is only a name. A repeat name or code is 409.",
      access: MANAGE_SUBJECTS,
      request: { body: { required: true, content: json(CreateSubjectSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createSubject(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/subjects/{id}",
      operationId: "update_subject",
      tags: ["academics"],
      description: "Renames a subject, changes or removes its code, or archives and restores it. This changes the word every section uses, so it needs a whole-school Co-ordinator.",
      access: MANAGE_SUBJECTS,
      request: { params: IdParam, body: { required: true, content: json(SubjectChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateSubject(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Offerings -----------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/offerings",
      operationId: "create_offering",
      tags: ["academics"],
      description:
        "Adds a subject to a programme level, with optional credit hours (whole hundredths) and an elective group of the same level. An archived subject, a switched-off level or group, or a group of another level is 422; the subject already on the level is 409.",
      access: MANAGE_SUBJECTS,
      request: { body: { required: true, content: json(CreateOfferingSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createOffering(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/offerings/{id}",
      operationId: "update_offering",
      tags: ["academics"],
      description: "Changes credit hours (null takes them away), the elective group (null takes the subject out of its group), or switches the subject off and on for the level.",
      access: MANAGE_SUBJECTS,
      request: { params: IdParam, body: { required: true, content: json(OfferingChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateOffering(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Mark components -------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/offerings/{id}/components",
      operationId: "add_component",
      tags: ["academics"],
      description: "Adds a mark component (Theory, Practical, Internal) to a subject on a level, numbered after the last. Maximum marks are whole hundredths. At most 10.",
      access: MANAGE_SUBJECTS,
      request: { params: IdParam, body: { required: true, content: json(CreateComponentSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await addComponent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/components/{id}",
      operationId: "update_component",
      tags: ["academics"],
      description: "Renames a component, changes its maximum marks, or switches it off and on. Nothing is deleted.",
      access: MANAGE_SUBJECTS,
      request: { params: IdParam, body: { required: true, content: json(ComponentChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateComponent(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Elective groups -------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/academics/levels/{id}/groups",
      operationId: "create_elective_group",
      tags: ["academics"],
      description: "Adds an elective group to a programme level (\"pick one of these\"). A student's own pick is saved when students exist.",
      access: MANAGE_SUBJECTS,
      request: { params: IdParam, body: { required: true, content: json(CreateGroupSchema) } },
      responses: { 201: { description: "Added", content: json(CreatedSchema) }, ...failures },
    },
    async (c) => {
      const result = await createGroup(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/academics/groups/{id}",
      operationId: "update_elective_group",
      tags: ["academics"],
      description: "Renames an elective group, changes how many are picked, or switches it off and on.",
      access: MANAGE_SUBJECTS,
      request: { params: IdParam, body: { required: true, content: json(GroupChangesSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await updateGroup(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );
}

