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

const ClassNaming = { programmeName: z.string(), levelName: z.string(), label: z.string() };

// --- The daily activity log (slice 3) ----------------------------------------------------------

export const WriteActivitySchema = z
  .strictObject({ body: z.string().trim().min(1, "Write what the class did today").max(2000, "Keep it to 2,000 characters") })
  .openapi("WriteActivity");
export type WriteActivity = z.infer<typeof WriteActivitySchema>;

export const MyActivityTodaySchema = z
  .object({
    date: z.string(),
    dateBs: z.string().nullable(),
    subjects: z.array(z.object({ classId: z.string(), offeringId: z.string(), subjectName: z.string(), ...ClassNaming, body: z.string().nullable() })),
  })
  .openapi("MyActivityToday");
export type MyActivityToday = z.infer<typeof MyActivityTodaySchema>;

export const ClassActivityDaySchema = z
  .object({
    classId: z.string(),
    ...ClassNaming,
    date: z.string(),
    dateBs: z.string().nullable(),
    entries: z.array(z.object({ offeringId: z.string(), subjectName: z.string(), teacherName: z.string().nullable(), body: z.string().nullable(), updatedAt: z.string().nullable() })),
  })
  .openapi("ClassActivityDay");
export type ClassActivityDay = z.infer<typeof ClassActivityDaySchema>;

export const OwnActivitySchema = z
  .object({
    days: z.array(z.object({ date: z.string(), dateBs: z.string().nullable(), entries: z.array(z.object({ subjectName: z.string(), teacherName: z.string(), body: z.string() })) })),
  })
  .openapi("OwnActivity");
export type OwnActivity = z.infer<typeof OwnActivitySchema>;

export const MissingActivitySchema = z
  .object({
    date: z.string(),
    dateBs: z.string().nullable(),
    classes: z.array(z.object({ classId: z.string(), ...ClassNaming, missing: z.array(z.object({ subjectName: z.string(), teacherName: z.string() })) })),
  })
  .openapi("MissingActivity");
export type MissingActivity = z.infer<typeof MissingActivitySchema>;

export const ActivityClassListSchema = z
  .object({
    date: z.string(),
    dateBs: z.string().nullable(),
    classes: z.array(z.object({ classId: z.string(), ...ClassNaming, expected: z.number().int(), written: z.number().int() })),
  })
  .openapi("ActivityClassList");
export type ActivityClassList = z.infer<typeof ActivityClassListSchema>;

// --- Notes and question papers (slice 4) ---------------------------------------------------------

/** Only an https address: never `javascript:`, never plain http. */
export const HttpsLinkSchema = z
  .string()
  .trim()
  .max(500, "Keep the link to 500 characters")
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a full https:// address");

export const NoteKindSchema = z.enum(["note", "question_paper"]);

export const ShareNoteSchema = z
  .strictObject({
    classId: PublicIdSchema,
    offeringId: PublicIdSchema,
    kind: NoteKindSchema,
    title: z.string().trim().min(1, "Give it a title").max(120, "Keep the title to 120 characters"),
    body: z.string().trim().max(5000, "Keep it to 5,000 characters").optional(),
    link: HttpsLinkSchema.optional(),
  })
  .openapi("ShareNote");
export type ShareNote = z.infer<typeof ShareNoteSchema>;

const NoteFields = {
  id: z.string(),
  kind: NoteKindSchema,
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  subjectName: z.string(),
  createdAt: z.string(),
};

export const TeacherNotesSchema = z
  .object({ notes: z.array(z.object({ ...NoteFields, classId: z.string(), ...ClassNaming, withdrawn: z.boolean() })) })
  .openapi("TeacherNotes");
export type TeacherNotes = z.infer<typeof TeacherNotesSchema>;

export const StudentNotesSchema = z
  .object({
    /** The student's own name and SID, drawn across each note on screen: a deterrent against sharing, not a lock. */
    watermark: z.string(),
    notes: z.array(z.object({ ...NoteFields, teacherName: z.string() })),
  })
  .openapi("StudentNotes");
export type StudentNotes = z.infer<typeof StudentNotesSchema>;

// --- Homework (slice 4) ---------------------------------------------------------------------------

/** An instant with its offset, as the screen sends it (a BS date and a Nepal time made into one moment). */
const InstantSchema = z.string().refine((value) => /T/.test(value) && !Number.isNaN(Date.parse(value)), "Give the date and time");

export const SetAssignmentSchema = z
  .strictObject({
    classId: PublicIdSchema,
    offeringId: PublicIdSchema,
    title: z.string().trim().min(1, "Give it a title").max(120, "Keep the title to 120 characters"),
    instructions: z.string().trim().min(1, "Write the instructions").max(5000, "Keep them to 5,000 characters"),
    link: HttpsLinkSchema.optional(),
    dueAt: InstantSchema,
    maxMarks: z.number().int().min(1).max(1000).optional(),
  })
  .openapi("SetAssignment");
export type SetAssignment = z.infer<typeof SetAssignmentSchema>;

export const SubmitWorkSchema = z.strictObject({ body: z.string().trim().min(1, "Write your answer").max(10000, "Keep it to 10,000 characters") }).openapi("SubmitWork");
export const ResubmitRequestSchema = z.strictObject({ reason: z.string().trim().min(1, "Say why").max(500, "Keep it to 500 characters") }).openapi("ResubmitRequest");
export const ReviewWorkSchema = z
  .strictObject({ marks: z.number().int().min(0).max(1000).optional(), feedback: z.string().trim().max(2000, "Keep feedback to 2,000 characters").optional() })
  .refine((body) => body.marks !== undefined || (body.feedback ?? "") !== "", "Give marks or feedback")
  .openapi("ReviewWork");
export const ResubmitDecisionSchema = z.strictObject({ allow: z.boolean() }).openapi("ResubmitDecision");

export const SubmissionStatusSchema = z.enum(["submitted", "reviewed", "resubmit_requested", "resubmit_allowed"]);

const AssignmentFields = {
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  link: z.string().nullable(),
  dueAt: z.string(),
  /** The deadline's day in Nepal, in BS: the screens show BS (CLAUDE.md section 6, "Dates"). */
  dueDateBs: z.string().nullable(),
  maxMarks: z.number().int().nullable(),
  subjectName: z.string(),
};

export const TeacherAssignmentsSchema = z
  .object({
    assignments: z.array(
      z.object({
        ...AssignmentFields,
        classId: z.string(),
        ...ClassNaming,
        withdrawn: z.boolean(),
        students: z.number().int(),
        submitted: z.number().int(),
        toReview: z.number().int(),
        requests: z.number().int(),
      }),
    ),
  })
  .openapi("TeacherAssignments");
export type TeacherAssignments = z.infer<typeof TeacherAssignmentsSchema>;

const SubmissionFields = {
  id: z.string(),
  status: SubmissionStatusSchema,
  isLate: z.boolean(),
  body: z.string(),
  submittedAt: z.string(),
  marks: z.number().int().nullable(),
  feedback: z.string().nullable(),
  resubmitReason: z.string().nullable(),
  attempts: z.number().int(),
};

export const AssignmentDetailSchema = z
  .object({
    ...AssignmentFields,
    classId: z.string(),
    ...ClassNaming,
    withdrawn: z.boolean(),
    students: z.array(z.object({ enrollmentId: z.string(), sid: z.string(), name: z.string(), submission: z.object(SubmissionFields).nullable() })),
  })
  .openapi("AssignmentDetail");
export type AssignmentDetail = z.infer<typeof AssignmentDetailSchema>;

export const StudentAssignmentsSchema = z
  .object({ assignments: z.array(z.object({ ...AssignmentFields, teacherName: z.string(), submission: z.object(SubmissionFields).nullable() })) })
  .openapi("StudentAssignments");
export type StudentAssignments = z.infer<typeof StudentAssignmentsSchema>;
