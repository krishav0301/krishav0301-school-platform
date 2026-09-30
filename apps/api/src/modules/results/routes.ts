import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { Grant } from "../../core/permissions";
import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { classElectives, setPicks } from "./electives";
import { reachOf, type Reach } from "./guard";
import { publishClass } from "./publish";
import { decideRecheck, listRechecks, requestRecheck } from "./rechecks";
import { loadSheet, mySheets, reviewBoard, saveMarks, sendBack, sheetPlace, submitSheet, verifySheets } from "./sheets";
import {
  BulkVerifySchema,
  ClassElectivesSchema,
  ClassSheetSchema,
  DecideRecheckSchema,
  MarkSheetSchema,
  MarksCardSchema,
  MyMarkSheetsSchema,
  OwnResultsSchema,
  PublicIdSchema,
  PublishSchema,
  RecheckListSchema,
  RequestRecheckSchema,
  ReviewBoardSchema,
  SaveMarksSchema,
  SendBackSchema,
  SetPicksSchema,
  Top20Schema,
} from "./schema";
import { classSheet, classSheetCsv, ownResults, staffCard, top20 } from "./views";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string(), message: z.string().optional() }).openapi("ResultsError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("ResultsInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("ResultsOk");

const failures = {
  404: { description: "No such item, or not one the person may reach", content: json(ErrorSchema) },
  409: { description: "Not possible in its current state (already decided, already published, not ready, or the year is closed)", content: json(ErrorSchema) },
  422: { description: "Not valid", content: json(InvalidSchema) },
};

/** A results write's failure as an answer. */
function fail(c: Context<AppEnv>, failure: { reason: string; message?: string }) {
  if (failure.reason === "invalid") return c.json({ error: "invalid" as const, message: failure.message ?? "That is not valid" }, 422);
  if (failure.reason === "not_found") return c.json({ error: "not_found" }, 404);
  return c.json({ error: failure.reason, ...(failure.message ? { message: failure.message } : {}) }, 409);
}

/** Staff reach for a read a Student may also hold for their own record: null for a person whose grant is only `own`. */
const staffReach = (grant: Grant): Reach | null => (grant.institution || grant.sections.length > 0 ? reachOf(grant) : null);

const ELECTIVES = { action: "results.electives.set" } as const;
const ENTER = { action: "marks.enter" } as const;
const VERIFY = { action: "marks.verify" } as const;
const PUBLISH = { action: "results.publish" } as const;
const VIEW = { action: "results.view" } as const;
const TOP20 = { action: "results.top20.view" } as const;
const RECHECK = { action: "results.recheck.request" } as const;
const RECHECK_EDIT = { action: "results.recheck.edit" } as const;
const REPORTS = { action: "reports.results" } as const;

const SheetParams = z.object({ classId: PublicIdSchema, offeringId: PublicIdSchema, terminalId: PublicIdSchema });
const ClassTerminal = z.object({ classId: PublicIdSchema, terminalId: PublicIdSchema });
const TerminalQuery = z.object({ terminalId: PublicIdSchema.optional() });

export function registerResults(app: App): void {
  // --- Elective picks (slice 2, D-080) -------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/classes/{classId}/electives",
      operationId: "get_class_electives",
      tags: ["results"],
      description: "A class's elective groups and each student's picks, for the Co-ordinator.",
      access: ELECTIVES,
      request: { params: z.object({ classId: PublicIdSchema }) },
      responses: { 200: { description: "The picks", content: json(ClassElectivesSchema) }, 404: failures[404] },
    },
    async (c) => {
      const result = await classElectives(c.env.DB, reachOf(c.get("grant")!), c.req.valid("param").classId);
      return result.ok ? c.json(result.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "put",
      path: "/api/results/enrollments/{enrollmentId}/electives/{groupId}",
      operationId: "set_elective_picks",
      tags: ["results"],
      description: "Sets one student's picks in one elective group: exactly the group's pick count. A subject with marks cannot be dropped.",
      access: ELECTIVES,
      request: { params: z.object({ enrollmentId: PublicIdSchema, groupId: PublicIdSchema }), body: { required: true, content: json(SetPicksSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const { enrollmentId, groupId } = c.req.valid("param");
      const result = await setPicks(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, enrollmentId, groupId, c.req.valid("json"));
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "has_marks") return c.json({ error: "has_marks", message: result.message }, 409);
      return fail(c, result);
    },
  );

  // --- The marks grid (slice 2, D-080) -------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/mine",
      operationId: "get_my_mark_sheets",
      tags: ["results"],
      description: "The signed-in teacher's subjects this year, each with its mark sheet's state per terminal.",
      access: ENTER,
      responses: { 200: { description: "The subjects", content: json(MyMarkSheetsSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await mySheets(c.env.DB, c.get("auth")!.userPublicId), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/classes/{classId}/subjects/{offeringId}/terminals/{terminalId}",
      operationId: "get_mark_sheet",
      tags: ["results"],
      description: "The marks grid for one subject in one class and terminal: the students who take it, the components, the marks so far, and how many are missing.",
      access: ENTER,
      request: { params: SheetParams },
      responses: { 200: { description: "The sheet", content: json(MarkSheetSchema) }, 404: failures[404] },
    },
    async (c) => {
      const { classId, offeringId, terminalId } = c.req.valid("param");
      const loaded = await loadSheet(c.env.DB, { teacher: c.get("auth")!.userPublicId }, classId, offeringId, terminalId);
      c.header("Cache-Control", "no-store");
      return loaded ? c.json(loaded.sheet, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "put",
      path: "/api/results/classes/{classId}/subjects/{offeringId}/terminals/{terminalId}",
      operationId: "save_marks",
      tags: ["results"],
      description: "Saves marks as a draft (whole hundredths; an absence is `absent`, never a zero). Saving again replaces. Only while the sheet is a draft.",
      access: ENTER,
      request: { params: SheetParams, body: { required: true, content: json(SaveMarksSchema) } },
      responses: { 200: { description: "Saved", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const { classId, offeringId, terminalId } = c.req.valid("param");
      const result = await saveMarks(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, classId, offeringId, terminalId, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/results/classes/{classId}/subjects/{offeringId}/terminals/{terminalId}/submit",
      operationId: "submit_mark_sheet",
      tags: ["results"],
      description: "Sends a complete draft to the Co-ordinator for review. Refused while a mark is missing.",
      access: ENTER,
      request: { params: SheetParams },
      responses: { 200: { description: "Sent", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const { classId, offeringId, terminalId } = c.req.valid("param");
      const result = await submitSheet(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, classId, offeringId, terminalId);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  // --- Review and publish (slice 3, D-081) ---------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/review",
      operationId: "get_results_review",
      tags: ["results"],
      description: "The Co-ordinator's board for a terminal (the latest by default): every class in reach, each subject's sheet state, and whether the class can be published.",
      access: VERIFY,
      request: { query: TerminalQuery },
      responses: { 200: { description: "The board", content: json(ReviewBoardSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await reviewBoard(c.env.DB, reachOf(c.get("grant")!), c.req.valid("query").terminalId), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/review/sheets/{sheetId}",
      operationId: "get_review_sheet",
      tags: ["results"],
      description: "One mark sheet, read-only, for the Co-ordinator to check before verifying.",
      access: VERIFY,
      request: { params: z.object({ sheetId: PublicIdSchema }) },
      responses: { 200: { description: "The sheet", content: json(MarkSheetSchema) }, 404: failures[404] },
    },
    async (c) => {
      const place = await sheetPlace(c.env.DB, c.req.valid("param").sheetId);
      const loaded = place ? await loadSheet(c.env.DB, { reach: reachOf(c.get("grant")!) }, place.classId, place.offeringId, place.terminalId) : null;
      c.header("Cache-Control", "no-store");
      return loaded ? c.json(loaded.sheet, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/results/review/verify",
      operationId: "verify_mark_sheets",
      tags: ["results"],
      description: "Verifies one or many sheets under review (bulk approve). Answers how many were verified; one not under review or not in reach is left as it is.",
      access: VERIFY,
      request: { body: { required: true, content: json(BulkVerifySchema) } },
      responses: { 200: { description: "Verified", content: json(z.object({ verified: z.number().int() })) }, ...failures },
    },
    async (c) => {
      const result = await verifySheets(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ verified: result.verified }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/results/review/sheets/{sheetId}/send-back",
      operationId: "send_back_mark_sheet",
      tags: ["results"],
      description: "Sends a sheet under review, or verified but not yet published, back to its teacher as a draft, with a note.",
      access: VERIFY,
      request: { params: z.object({ sheetId: PublicIdSchema }), body: { required: true, content: json(SendBackSchema) } },
      responses: { 200: { description: "Sent back", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await sendBack(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").sheetId, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/results/classes/{classId}/publish",
      operationId: "publish_class_results",
      tags: ["results"],
      description:
        "Publishes a whole class for a terminal: only when every subject is verified and the programme has a grading policy. Every student's marks card is stored as a snapshot in the same batch.",
      access: PUBLISH,
      request: { params: z.object({ classId: PublicIdSchema }), body: { required: true, content: json(PublishSchema) } },
      responses: { 201: { description: "Published", content: json(z.object({ publicationId: z.string(), cards: z.number().int() })) }, ...failures },
    },
    async (c) => {
      const result = await publishClass(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").classId, c.req.valid("json").terminalId);
      if (result.ok) return c.json({ publicationId: result.publicationId, cards: result.cards }, 201);
      if (result.reason === "cannot_grade") return c.json({ error: "invalid" as const, message: result.message }, 422);
      return fail(c, result);
    },
  );

  // --- What people read (slice 4, D-082) -----------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/me",
      operationId: "get_own_results",
      tags: ["results"],
      description: "The signed-in student's published results, every year and terminal, each with its marks card and rechecks. Nothing before publish.",
      access: VIEW,
      responses: { 200: { description: "The results", content: json(OwnResultsSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await ownResults(c.env.DB, c.get("auth")!.userPublicId), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/cards/{cardId}",
      operationId: "get_marks_card",
      tags: ["results"],
      description: "One marks card (any version), for staff whose sections reach the class.",
      access: VIEW,
      request: { params: z.object({ cardId: PublicIdSchema }) },
      responses: { 200: { description: "The card", content: json(MarksCardSchema) }, 404: failures[404] },
    },
    async (c) => {
      const reach = staffReach(c.get("grant")!);
      const card = reach ? await staffCard(c.env.DB, reach, c.req.valid("param").cardId) : null;
      return card ? c.json(card, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/classes/{classId}/terminals/{terminalId}/sheet",
      operationId: "get_class_result_sheet",
      tags: ["results"],
      description: "The whole-class sheet of a published terminal: students by subjects, with the GPA or percentage and the rank in the class.",
      access: VIEW,
      request: { params: ClassTerminal },
      responses: { 200: { description: "The sheet", content: json(ClassSheetSchema) }, 404: failures[404] },
    },
    async (c) => {
      const reach = staffReach(c.get("grant")!);
      const { classId, terminalId } = c.req.valid("param");
      const sheet = reach ? await classSheet(c.env.DB, reach, classId, terminalId) : null;
      return sheet ? c.json(sheet, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/classes/{classId}/terminals/{terminalId}/sheet.csv",
      operationId: "export_class_result_sheet",
      tags: ["results"],
      description: "The whole-class sheet as CSV, for Excel. OPEN: a native .xlsx needs a library the PM has not approved yet.",
      access: REPORTS,
      request: { params: ClassTerminal },
      responses: { 200: { description: "The CSV", content: { "text/csv": { schema: z.string() } } }, 404: failures[404] },
    },
    async (c) => {
      const { classId, terminalId } = c.req.valid("param");
      const sheet = await classSheet(c.env.DB, reachOf(c.get("grant")!), classId, terminalId);
      if (!sheet) return c.json({ error: "not_found" }, 404);
      c.header("Cache-Control", "no-store");
      c.header("Content-Disposition", 'attachment; filename="results.csv"');
      return c.body(classSheetCsv(sheet), 200, { "Content-Type": "text/csv; charset=utf-8" });
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/top20",
      operationId: "get_top20",
      tags: ["results"],
      description:
        "The Top 20 for a terminal, ranked per section among the same level, ties sharing a rank. A student sees their own list only, name and rank only, once their class is published; staff see every list in reach.",
      access: TOP20,
      request: { query: TerminalQuery },
      responses: { 200: { description: "The lists", content: json(Top20Schema) }, 404: { description: "The Top 20 is switched off for this school", content: json(ErrorSchema) } },
    },
    async (c) => {
      const grant = c.get("grant")!;
      const reach = staffReach(grant);
      const result = await top20(c.env.DB, reach ? { reach } : { student: c.get("auth")!.userPublicId }, c.req.valid("query").terminalId);
      c.header("Cache-Control", "no-store");
      return result ? c.json(result, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  // --- Rechecks (slice 5, D-083) -------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/results/publications/{publicationId}/rechecks",
      operationId: "request_recheck",
      tags: ["results"],
      description: "The student asks for one subject of their own published result to be rechecked, with a reason. One open request per subject.",
      access: RECHECK,
      request: { params: z.object({ publicationId: PublicIdSchema }), body: { required: true, content: json(RequestRecheckSchema) } },
      responses: { 201: { description: "Requested", content: json(z.object({ id: z.string() })) }, ...failures },
    },
    async (c) => {
      const result = await requestRecheck(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").publicationId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.id! }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/results/rechecks",
      operationId: "list_rechecks",
      tags: ["results"],
      description: "Rechecks in reach, open first. The Co-ordinator decides them; the Admin sees every post-publish change here.",
      access: VIEW,
      responses: { 200: { description: "The rechecks", content: json(RecheckListSchema) }, 404: failures[404] },
    },
    async (c) => {
      const reach = staffReach(c.get("grant")!);
      c.header("Cache-Control", "no-store");
      return reach ? c.json(await listRechecks(c.env.DB, reach), 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/results/rechecks/{recheckId}/decide",
      operationId: "decide_recheck",
      tags: ["results"],
      description: "The Co-ordinator decides a recheck, with a reason: unchanged, or changed with the corrected marks, which makes the next version of the marks card.",
      access: RECHECK_EDIT,
      request: { params: z.object({ recheckId: PublicIdSchema }), body: { required: true, content: json(DecideRecheckSchema) } },
      responses: { 200: { description: "Decided", content: json(OkSchema) }, ...failures },
    },
    async (c) => {
      const result = await decideRecheck(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").recheckId, c.req.valid("json"));
      if (result.ok) return c.json({ ok: true as const }, 200);
      if (result.reason === "cannot_grade") return c.json({ error: "invalid" as const, message: result.message }, 422);
      return fail(c, result);
    },
  );
}
