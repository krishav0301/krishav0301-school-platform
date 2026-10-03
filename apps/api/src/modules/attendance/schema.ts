import { z } from "@hono/zod-openapi";

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

/** An AD calendar day, "YYYY-MM-DD", checked against the real calendar. Each module keeps its own copy (modules do not reach into each other). */
export const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "That day does not exist");

/** Today's register: who is absent. Everyone else in the class is Present (the list starts pre-filled Present). */
export const MarkTodaySchema = z
  .strictObject({
    absent: z.array(PublicIdSchema).max(500, "A class has at most 500 students"),
  })
  .refine((body) => new Set(body.absent).size === body.absent.length, "A student is listed twice")
  .openapi("MarkAttendance");
export type MarkToday = z.infer<typeof MarkTodaySchema>;

export const MarkedSchema = z.object({ ok: z.literal(true), present: z.number().int(), absent: z.number().int() }).openapi("AttendanceMarked");

const ClassNaming = {
  id: z.string(),
  programmeName: z.string(),
  levelName: z.string(),
  label: z.string(),
  sectionKey: z.string(),
};

export const AttendanceClassListSchema = z
  .object({
    today: z.string(),
    todayBs: z.string().nullable(),
    classes: z.array(
      z.object({
        ...ClassNaming,
        students: z.number().int(),
        markedToday: z.boolean(),
        absentToday: z.number().int(),
        /** The class's Class Teacher, who marks its register; null when none is named yet (D-103). */
        classTeacher: z.string().nullable(),
        /** The person asking is this class's Class Teacher: the one who marks it. */
        mine: z.boolean(),
      }),
    ),
  })
  .openapi("AttendanceClassList");
export type AttendanceClassList = z.infer<typeof AttendanceClassListSchema>;

export const AttendanceStatusSchema = z.enum(["present", "absent"]);

export const AttendanceDaySchema = z
  .object({
    class: z.object(ClassNaming),
    date: z.string(),
    dateBs: z.string().nullable(),
    isToday: z.boolean(),
    /** At least one student has a mark for the day. */
    marked: z.boolean(),
    /** The person asking may mark this class today (its Class Teacher, and the day is today). */
    canMark: z.boolean(),
    students: z.array(z.object({ enrollmentId: z.string(), sid: z.string(), name: z.string(), rollNo: z.number().int().nullable(), status: AttendanceStatusSchema.nullable() })),
  })
  .openapi("AttendanceDay");
export type AttendanceDay = z.infer<typeof AttendanceDaySchema>;

const Tally = {
  present: z.number().int(),
  absent: z.number().int(),
  /** Present days over marked days, rounded down; null while nothing is marked. */
  percent: z.number().int().nullable(),
  /** Below the school's alert threshold. */
  below: z.boolean(),
};

export const AttendanceSummarySchema = z
  .object({
    class: z.object(ClassNaming),
    threshold: z.number().int(),
    students: z.array(z.object({ enrollmentId: z.string(), sid: z.string(), name: z.string(), rollNo: z.number().int().nullable(), ...Tally })),
  })
  .openapi("AttendanceSummary");
export type AttendanceSummary = z.infer<typeof AttendanceSummarySchema>;

export const OwnAttendanceSchema = z
  .object({
    yearLabel: z.string(),
    threshold: z.number().int(),
    ...Tally,
    absentDays: z.array(z.object({ date: z.string(), dateBs: z.string().nullable() })),
  })
  .openapi("OwnAttendance");
export type OwnAttendance = z.infer<typeof OwnAttendanceSchema>;

// --- Teacher attendance (slice 2) --------------------------------------------------------------

export const TeacherStatusSchema = z.enum(["present", "absent", "leave"]);

/** The Co-ordinator's daily list: the exceptions (Absent, On leave); everyone else in reach is Present. A day other than today needs a reason. */
export const SaveTeacherDaySchema = z
  .strictObject({
    date: CalendarDaySchema,
    exceptions: z.array(z.strictObject({ teacherId: PublicIdSchema, status: z.enum(["absent", "leave"]) })).max(500),
    reason: z.string().trim().max(300, "Keep the reason to 300 characters").optional(),
  })
  .refine((body) => new Set(body.exceptions.map((e) => e.teacherId)).size === body.exceptions.length, "A teacher is listed twice")
  .openapi("SaveTeacherDay");
export type SaveTeacherDay = z.infer<typeof SaveTeacherDaySchema>;

export const TeacherDaySchema = z
  .object({
    date: z.string(),
    dateBs: z.string().nullable(),
    isToday: z.boolean(),
    marked: z.boolean(),
    teachers: z.array(z.object({ id: z.string(), name: z.string(), sectionKey: z.string().nullable(), status: TeacherStatusSchema.nullable(), reason: z.string().nullable() })),
  })
  .openapi("TeacherDay");
export type TeacherDay = z.infer<typeof TeacherDaySchema>;

/** A BS month, "YYYY-MM". */
export const BsMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the form YYYY-MM (a Bikram Sambat year and month)");

export const OwnTeacherMonthSchema = z
  .object({
    month: z.string(),
    present: z.number().int(),
    absent: z.number().int(),
    leave: z.number().int(),
    days: z.array(z.object({ date: z.string(), dateBs: z.string(), weekday: z.number().int(), status: TeacherStatusSchema.nullable() })),
  })
  .openapi("OwnTeacherMonth");
export type OwnTeacherMonth = z.infer<typeof OwnTeacherMonthSchema>;
