import { z } from "@hono/zod-openapi";

import { adToBsText, nepalDate } from "../../core/dates";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { classDay, listClasses, missingToday, myToday, ownActivity, writeToday } from "./activity";
import { reachOf } from "./guard";
import {
  assignmentDetail,
  decideResubmission,
  requestResubmission,
  reviewSubmission,
  setAssignment,
  studentAssignments,
  submitWork,
  teacherAssignments,
  withdrawAssignment,
  type HomeworkWrite,
} from "./homework";
import { shareNote, studentNotes, teacherNotes, withdrawNote } from "./notes";
import {
  ActivityClassListSchema,
  AssignmentDetailSchema,
  CalendarDaySchema,
  ClassActivityDaySchema,
  MissingActivitySchema,
  MyActivityTodaySchema,
  OwnActivitySchema,
  PublicIdSchema,
  ResubmitDecisionSchema,
  ResubmitRequestSchema,
  ReviewWorkSchema,
  SetAssignmentSchema,
  ShareNoteSchema,
  StudentAssignmentsSchema,
  StudentNotesSchema,
  SubmitWorkSchema,
  TeacherAssignmentsSchema,
  TeacherNotesSchema,
  WriteActivitySchema,
} from "./schema";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("ClassworkError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("ClassworkInvalid");

const READ = { action: "activity.read" } as const;
const WRITE = { action: "activity.write" } as const;
const NOTES_MANAGE = { action: "notes.manage" } as const;
const NOTES_VIEW = { action: "notes.view" } as const;
const WORK_MANAGE = { action: "assignments.manage" } as const;
const WORK_SUBMIT = { action: "assignments.submit" } as const;

const OkSchema = z.object({ ok: z.literal(true) });
const writeResponses = {
  200: { description: "Done", content: json(OkSchema) },
  404: { description: "Not found, not yours, or homework is switched off", content: json(ErrorSchema) },
  409: { description: "Not possible in its current state, or the academic year is closed", content: json(ErrorSchema) },
  422: { description: "Not valid", content: json(InvalidSchema) },
};

/** A homework write's answer. */
function answer(c: Parameters<Parameters<typeof defineRoute>[2]>[0], result: HomeworkWrite) {
  if (result.ok) return c.json({ ok: true as const }, 200);
  if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
  if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
  return c.json({ error: result.reason }, 409);
}

export function registerClasswork(app: App): void {
  // --- The daily activity log (slice 3, D-071) ----------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/activity/mine",
      operationId: "get_my_activity_today",
      tags: ["classwork"],
      description: "The subjects the signed-in teacher teaches this year, each with today's entry or none. An empty entry is the teacher's reminder.",
      access: WRITE,
      responses: { 200: { description: "Today's subjects", content: json(MyActivityTodaySchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await myToday(c.env.DB, c.get("auth")!.userPublicId, nepalDate(new Date())), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "put",
      path: "/api/activity/classes/{classId}/subjects/{offeringId}/today",
      operationId: "write_activity_today",
      tags: ["classwork"],
      description: "Writes today's entry for one subject in one class, by the teacher who teaches it. Writing again the same day replaces it; past days cannot change.",
      access: WRITE,
      request: { params: z.object({ classId: PublicIdSchema, offeringId: PublicIdSchema }), body: { required: true, content: json(WriteActivitySchema) } },
      responses: {
        200: { description: "Saved", content: json(z.object({ ok: z.literal(true) })) },
        404: { description: "Not a subject this teacher teaches in this class", content: json(ErrorSchema) },
        409: { description: "The academic year is closed", content: json(ErrorSchema) },
        422: { description: "Not valid", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      const { classId, offeringId } = c.req.valid("param");
      const result = await writeToday(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, classId, offeringId, c.req.valid("json"));
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      if (result.reason === "year_closed") return c.json({ error: "year_closed" }, 409);
      return c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/activity/classes/{classId}",
      operationId: "get_class_activity",
      tags: ["classwork"],
      description: "A class's activity log for a day (today by default): every subject, its entry or none, and its teacher. A teacher sees only their own subjects.",
      access: READ,
      request: { params: z.object({ classId: PublicIdSchema }), query: z.object({ date: CalendarDaySchema.optional() }) },
      responses: {
        200: { description: "The day", content: json(ClassActivityDaySchema) },
        404: { description: "No such class, or not one the person may see", content: json(ErrorSchema) },
        422: { description: "A day outside the verified calendar", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      const date = c.req.valid("query").date ?? nepalDate(new Date());
      if (adToBsText(date) === null) return c.json({ error: "invalid" as const, message: "That day is outside the verified calendar" }, 422);
      const onlyOwnSubjects = !grant.institution && grant.sections.length === 0;
      const read = await classDay(c.env.DB, reachOf(grant, c.get("auth")!.userPublicId), onlyOwnSubjects, c.req.valid("param").classId, date);
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/activity/me",
      operationId: "get_own_activity",
      tags: ["classwork"],
      description: "The signed-in student's own class: the last two weeks' entries, newest first.",
      access: READ,
      responses: { 200: { description: "The entries", content: json(OwnActivitySchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await ownActivity(c.env.DB, c.get("auth")!.userPublicId, nepalDate(new Date())), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/activity/missing",
      operationId: "get_missing_activity",
      tags: ["classwork"],
      description: "Today's reminder: each class in reach with the subjects that have a teacher but no entry yet.",
      access: READ,
      responses: { 200: { description: "What is missing", content: json(MissingActivitySchema) }, 403: { description: "Not for students or teachers", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "forbidden" }, 403);
      return c.json(await missingToday(c.env.DB, reachOf(grant, c.get("auth")!.userPublicId), nepalDate(new Date())), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/activity/classes",
      operationId: "list_activity_classes",
      tags: ["classwork"],
      description: "The active year's classes in reach, each with how many of its taught subjects have today's entry.",
      access: READ,
      responses: { 200: { description: "The classes", content: json(ActivityClassListSchema) }, 403: { description: "Not for students or teachers", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "forbidden" }, 403);
      return c.json(await listClasses(c.env.DB, reachOf(grant, c.get("auth")!.userPublicId), nepalDate(new Date())), 200);
    },
  );

  // --- Notes and question papers (slice 4, D-072) -------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/notes",
      operationId: "share_note",
      tags: ["classwork"],
      description: "Shares a note or question paper with a class, live at once. Text and an optional https link (file uploads wait for R2). Only a teacher of that subject in that class.",
      access: NOTES_MANAGE,
      request: { body: { required: true, content: json(ShareNoteSchema) } },
      responses: {
        201: { description: "Shared", content: json(z.object({ id: z.string() })) },
        404: { description: "Not a subject this teacher teaches in this class, or notes are switched off", content: json(ErrorSchema) },
        409: { description: "The academic year is closed", content: json(ErrorSchema) },
        422: { description: "Neither words nor a link", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      const result = await shareNote(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      if (result.ok) return c.json({ id: result.publicId }, 201);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      if (result.reason === "year_closed") return c.json({ error: "year_closed" }, 409);
      return c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/notes/{id}/withdraw",
      operationId: "withdraw_note",
      tags: ["classwork"],
      description: "Withdraws a shared note or question paper, once. It stays on record, hidden from students. To replace one, withdraw it and share again.",
      access: NOTES_MANAGE,
      request: { params: z.object({ id: PublicIdSchema }) },
      responses: {
        200: { description: "Withdrawn", content: json(z.object({ ok: z.literal(true) })) },
        404: { description: "No such live note in a subject this teacher teaches", content: json(ErrorSchema) },
        409: { description: "The academic year is closed", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const result = await withdrawNote(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "year_closed") return c.json({ error: "year_closed" }, 409);
      return c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/notes/mine",
      operationId: "list_teacher_notes",
      tags: ["classwork"],
      description: "What the signed-in teacher's subjects have shared this year, newest first, withdrawn ones marked.",
      access: NOTES_MANAGE,
      responses: { 200: { description: "The notes", content: json(TeacherNotesSchema) }, 404: { description: "Notes are switched off", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const read = await teacherNotes(c.env.DB, c.get("auth")!.userPublicId);
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/notes/me",
      operationId: "list_student_notes",
      tags: ["classwork"],
      description: "The signed-in student's own class's live notes and question papers, and their watermark (name and SID). Never cached.",
      access: NOTES_VIEW,
      responses: { 200: { description: "The notes", content: json(StudentNotesSchema) }, 403: { description: "Not a student", content: json(ErrorSchema) }, 404: { description: "Notes are switched off", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      if (!c.get("grant")!.own) return c.json({ error: "forbidden" }, 403);
      const read = await studentNotes(c.env.DB, c.get("auth")!.userPublicId);
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  // --- Homework (slice 4, D-072) ------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/assignments",
      operationId: "set_homework",
      tags: ["classwork"],
      description: "Sets an assignment for a class: instructions, a deadline in the future, optional marks and an optional https link. Only a teacher of that subject in that class.",
      access: WORK_MANAGE,
      request: { body: { required: true, content: json(SetAssignmentSchema) } },
      responses: { 201: { description: "Set", content: json(z.object({ id: z.string() })) }, 404: writeResponses[404], 409: writeResponses[409], 422: writeResponses[422] },
    },
    async (c) => {
      const result = await setAssignment(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      if (result.ok) return c.json({ id: result.publicId }, 201);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
      return c.json({ error: result.reason }, 409);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/assignments/{id}/withdraw",
      operationId: "withdraw_assignment",
      tags: ["classwork"],
      description: "Withdraws an assignment: hidden from students, closed to submissions, kept on record.",
      access: WORK_MANAGE,
      request: { params: z.object({ id: PublicIdSchema }) },
      responses: writeResponses,
    },
    async (c) => answer(c, await withdrawAssignment(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id)),
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/assignments/mine",
      operationId: "list_teacher_assignments",
      tags: ["classwork"],
      description: "The signed-in teacher's assignments this year, newest deadline first, with how many are submitted, waiting for review, and asking to resubmit.",
      access: WORK_MANAGE,
      responses: { 200: { description: "The assignments", content: json(TeacherAssignmentsSchema) }, 404: { description: "Homework is switched off", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const read = await teacherAssignments(c.env.DB, c.get("auth")!.userPublicId);
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/assignments/me",
      operationId: "list_student_assignments",
      tags: ["classwork"],
      description: "The signed-in student's own class's assignments, newest deadline first, each with their own submission or none.",
      access: WORK_SUBMIT,
      responses: { 200: { description: "The assignments", content: json(StudentAssignmentsSchema) }, 404: { description: "Homework is switched off", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const read = await studentAssignments(c.env.DB, c.get("auth")!.userPublicId);
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/assignments/{id}",
      operationId: "get_assignment",
      tags: ["classwork"],
      description: "One assignment for its teacher: every student of the class with their submission or none.",
      access: WORK_MANAGE,
      request: { params: z.object({ id: PublicIdSchema }) },
      responses: { 200: { description: "The assignment", content: json(AssignmentDetailSchema) }, 404: { description: "Not an assignment in a subject this teacher teaches", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const read = await assignmentDetail(c.env.DB, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/assignments/{id}/submissions/{submissionId}/review",
      operationId: "review_submission",
      tags: ["classwork"],
      description: "The teacher's marks (up to the assignment's maximum) and feedback on a submission.",
      access: WORK_MANAGE,
      request: { params: z.object({ id: PublicIdSchema, submissionId: PublicIdSchema }), body: { required: true, content: json(ReviewWorkSchema) } },
      responses: writeResponses,
    },
    async (c) => {
      const { id, submissionId } = c.req.valid("param");
      return answer(c, await reviewSubmission(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, id, submissionId, c.req.valid("json")));
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/assignments/{id}/submissions/{submissionId}/resubmission",
      operationId: "decide_resubmission",
      tags: ["classwork"],
      description: "Allows or declines a student's request to resubmit. Declined, the submission goes back to how it was.",
      access: WORK_MANAGE,
      request: { params: z.object({ id: PublicIdSchema, submissionId: PublicIdSchema }), body: { required: true, content: json(ResubmitDecisionSchema) } },
      responses: writeResponses,
    },
    async (c) => {
      const { id, submissionId } = c.req.valid("param");
      return answer(c, await decideResubmission(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, id, submissionId, c.req.valid("json").allow));
    },
  );

  defineRoute(
    app,
    {
      method: "put",
      path: "/api/assignments/{id}/submission",
      operationId: "submit_work",
      tags: ["classwork"],
      description: "The student's own submission: once, or again after the teacher allows a resubmission. Late is flagged automatically against the deadline.",
      access: WORK_SUBMIT,
      request: { params: z.object({ id: PublicIdSchema }), body: { required: true, content: json(SubmitWorkSchema) } },
      responses: writeResponses,
    },
    async (c) => answer(c, await submitWork(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").body)),
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/assignments/{id}/submission/resubmit-request",
      operationId: "request_resubmission",
      tags: ["classwork"],
      description: "The student asks to resubmit, with a reason. The teacher allows or declines it.",
      access: WORK_SUBMIT,
      request: { params: z.object({ id: PublicIdSchema }), body: { required: true, content: json(ResubmitRequestSchema) } },
      responses: writeResponses,
    },
    async (c) => answer(c, await requestResubmission(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").reason)),
  );
}
