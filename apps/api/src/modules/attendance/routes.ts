import { z } from "@hono/zod-openapi";

import { adToBs, adToBsText, nepalDate } from "../../core/dates";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { reachOf } from "./guard";
import { getDay, getOwn, getSummary, listClasses } from "./queries";
import {
  AttendanceClassListSchema,
  AttendanceDaySchema,
  AttendanceSummarySchema,
  BsMonthSchema,
  CalendarDaySchema,
  MarkTodaySchema,
  MarkedSchema,
  OwnAttendanceSchema,
  OwnTeacherMonthSchema,
  PublicIdSchema,
  SaveTeacherDaySchema,
  TeacherDaySchema,
} from "./schema";
import { markToday } from "./service";
import { getOwnMonth, getTeacherDay, saveTeacherDay } from "./teachers";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("AttendanceError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("AttendanceInvalid");
const IdParam = z.object({ id: PublicIdSchema });
const notFound = { 404: { description: "No such class, not one the person may see, or attendance is switched off for this school", content: json(ErrorSchema) } };

const VIEW = { action: "attendance.student.view" } as const;
const MARK = { action: "attendance.student.mark" } as const;
const TEACHER_VIEW = { action: "attendance.teacher.view" } as const;
const TEACHER_MARK = { action: "attendance.teacher.mark" } as const;


export function registerAttendance(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/attendance/classes",
      operationId: "list_attendance_classes",
      tags: ["attendance"],
      description: "The active year's classes the person may see, each with today's state. A Class Teacher sees their own class; a Co-ordinator their sections; the Admin every class.",
      access: VIEW,
      responses: { 200: { description: "The classes", content: json(AttendanceClassListSchema) }, ...notFound },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      const read = await listClasses(c.env.DB, reachOf(grant, c.get("auth")!.userPublicId), nepalDate(new Date()));
      // "Switched off" and "not yours" are both 404: nothing to learn from the difference.
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/attendance/classes/{id}/day",
      operationId: "get_attendance_day",
      tags: ["attendance"],
      description: "A class's register for one day (today by default): each student, and their mark or none.",
      access: VIEW,
      request: { params: IdParam, query: z.object({ date: CalendarDaySchema.optional() }) },
      responses: {
        200: { description: "The register", content: json(AttendanceDaySchema) },
        ...notFound,
        422: { description: "A day outside the verified calendar", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const today = nepalDate(new Date());
      const date = c.req.valid("query").date ?? today;
      if (adToBsText(date) === null) return c.json({ error: "invalid" as const, message: "That day is outside the verified calendar" }, 422);
      const read = await getDay(c.env.DB, reachOf(c.get("grant")!, c.get("auth")!.userPublicId), c.req.valid("param").id, date, today);
      // "Switched off" and "not yours" are both 404: nothing to learn from the difference.
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "put",
      path: "/api/attendance/classes/{id}/today",
      operationId: "mark_attendance_today",
      tags: ["attendance"],
      description:
        "The Class Teacher's register for today (Nepal's date): the absent students; everyone else in the class is Present. Sending it again the same day replaces the day. Past days cannot be changed.",
      access: MARK,
      request: { params: IdParam, body: { required: true, content: json(MarkTodaySchema) } },
      responses: {
        200: { description: "Saved", content: json(MarkedSchema) },
        ...notFound,
        409: { description: "The academic year is closed", content: json(ErrorSchema) },
        422: { description: "A student listed is not in this class", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      const result = await markToday(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      if (result.ok) return c.json({ ok: true as const, present: result.present, absent: result.absent }, 200);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      if (result.reason === "year_closed") return c.json({ error: "year_closed" }, 409);
      return c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/attendance/classes/{id}/summary",
      operationId: "get_attendance_summary",
      tags: ["attendance"],
      description: "Each student's year so far in the class: days present and absent, the percentage, and whether it is below the school's alert threshold.",
      access: VIEW,
      request: { params: IdParam },
      responses: { 200: { description: "The summary", content: json(AttendanceSummarySchema) }, ...notFound },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const read = await getSummary(c.env.DB, reachOf(c.get("grant")!, c.get("auth")!.userPublicId), c.req.valid("param").id);
      // "Switched off" and "not yours" are both 404: nothing to learn from the difference.
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/attendance/me",
      operationId: "get_own_attendance",
      tags: ["attendance"],
      description: "The signed-in student's own attendance this year: totals, percentage, the alert flag, and the days marked absent.",
      access: VIEW,
      responses: { 200: { description: "Their attendance", content: json(OwnAttendanceSchema) }, 404: { description: "No enrollment this year, or attendance is switched off", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const read = await getOwn(c.env.DB, c.get("auth")!.userPublicId);
      // "Switched off" and "not yours" are both 404: nothing to learn from the difference.
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  // --- Teacher attendance (slice 2, D-070) --------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/attendance/teachers/day",
      operationId: "get_teacher_attendance_day",
      tags: ["attendance"],
      description: "The Co-ordinator's daily list of teachers for a day (today by default), each with their mark or none. The screen shows an unmarked teacher as Present.",
      access: TEACHER_VIEW,
      request: { query: z.object({ date: CalendarDaySchema.optional() }) },
      responses: {
        200: { description: "The list", content: json(TeacherDaySchema) },
        403: { description: "Not allowed: a teacher reads only their own month", content: json(ErrorSchema) },
        404: { description: "Teacher attendance is switched off for this school", content: json(ErrorSchema) },
        422: { description: "A day outside the verified calendar", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "forbidden" }, 403);
      const today = nepalDate(new Date());
      const date = c.req.valid("query").date ?? today;
      if (adToBsText(date) === null) return c.json({ error: "invalid" as const, message: "That day is outside the verified calendar" }, 422);
      const read = await getTeacherDay(c.env.DB, grant, date, today);
      return read.ok ? c.json(read.data, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "put",
      path: "/api/attendance/teachers/day",
      operationId: "save_teacher_attendance_day",
      tags: ["attendance"],
      description:
        "Saves a day's teacher attendance: the exceptions (Absent, On leave); every other teacher the Co-ordinator reaches is Present. Today, or a past day with a reason. Saving the same day again replaces it.",
      access: TEACHER_MARK,
      request: { body: { required: true, content: json(SaveTeacherDaySchema) } },
      responses: {
        200: { description: "Saved", content: json(z.object({ ok: z.literal(true), present: z.number().int(), absent: z.number().int(), leave: z.number().int() })) },
        404: { description: "Not allowed any more, or teacher attendance is switched off", content: json(ErrorSchema) },
        409: { description: "The day falls in a closed academic year", content: json(ErrorSchema) },
        422: { description: "A future day, a past day without a reason, or a teacher out of reach", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      const result = await saveTeacherDay(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      if (result.ok) return c.json({ ok: true as const, present: result.present, absent: result.absent, leave: result.leave }, 200);
      if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422);
      if (result.reason === "year_closed") return c.json({ error: "year_closed" }, 409);
      return c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/attendance/teachers/me",
      operationId: "get_own_teacher_month",
      tags: ["attendance"],
      description: "The signed-in teacher's own attendance for a Bikram Sambat month (this month by default), read-only.",
      access: TEACHER_VIEW,
      request: { query: z.object({ month: BsMonthSchema.optional() }) },
      responses: {
        200: { description: "The month", content: json(OwnTeacherMonthSchema) },
        404: { description: "Teacher attendance is switched off for this school", content: json(ErrorSchema) },
        422: { description: "A year outside the verified calendar", content: json(InvalidSchema) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const bs = adToBs(nepalDate(new Date()));
      const month = c.req.valid("query").month ?? `${bs.year}-${String(bs.month).padStart(2, "0")}`;
      const read = await getOwnMonth(c.env.DB, c.get("auth")!.userPublicId, month);
      if (read.ok) return c.json(read.data, 200);
      if (read.reason === "unverified") return c.json({ error: "invalid" as const, message: "That year is outside the verified calendar" }, 422);
      return c.json({ error: "not_found" }, 404);
    },
  );
}
