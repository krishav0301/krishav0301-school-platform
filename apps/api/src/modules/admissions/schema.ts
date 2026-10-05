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

const Name = z.string().trim().min(1, "This is required").max(60, "Keep it to 60 characters");
const Phone = z.string().trim().regex(/^[0-9+\-() ]{7,20}$/, "That does not look like a phone number");
const Email = z.string().trim().min(1, "Give an email address").max(200).email("That does not look like an email address");

/** What the public applies with, or what a Co-ordinator/Accountant types in for a walk-in. */
export const ApplicantDetailsSchema = z.strictObject({
  firstName: Name,
  middleName: Name.optional(),
  lastName: Name,
  dob: CalendarDaySchema,
  phone: Phone,
  email: Email,
  guardianName: z.string().trim().min(1, "Give the guardian's name").max(120, "Keep it to 120 characters"),
  guardianPhone: Phone,
  previousSchool: z.string().trim().max(120).optional(),
  /** "Referred by (if any)": optional free text. */
  referredBy: z.string().trim().max(120).optional(),
  levelId: PublicIdSchema,
});
export type ApplicantDetails = z.infer<typeof ApplicantDetailsSchema>;

/** The public application form. A submission token makes a repeat click (or a retried request) change nothing new. */
export const ApplySchema = ApplicantDetailsSchema.extend({
  submissionToken: z.string().trim().regex(/^[A-Za-z0-9_-]{16,100}$/, "That is not a valid submission token"),
  /** A field no real visitor sees or fills; a script that fills every field trips it. Never rejected here: a
   * validation error would teach a bot exactly which field to leave empty. The service silently no-ops instead. */
  website: z.string().optional(),
}).openapi("ApplyInput");
export type ApplyInput = z.infer<typeof ApplySchema>;

export const WalkInSchema = ApplicantDetailsSchema.openapi("WalkInInput");
export type WalkInInput = z.infer<typeof WalkInSchema>;

export const VerifyEmailSchema = z.strictObject({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{16,200}$/, "That is not a valid token") }).openapi("VerifyEmailInput");

export const RequestChangesSchema = z.strictObject({
  fields: z.array(z.string().trim().min(1)).min(1, "Pick at least one field"),
  reason: z.string().trim().min(1, "Give a reason").max(500, "Keep the reason to 500 characters"),
}).openapi("RequestChanges");
export type RequestChanges = z.infer<typeof RequestChangesSchema>;

export const RejectSchema = z.strictObject({ reason: z.string().trim().min(1, "Give a reason").max(500, "Keep the reason to 500 characters") }).openapi("RejectInput");
export type RejectInput = z.infer<typeof RejectSchema>;

export const ApproveSchema = z.strictObject({ classId: PublicIdSchema, rollNo: z.number().int().min(1).max(999).optional() }).openapi("ApproveInput");
export type ApproveInput = z.infer<typeof ApproveSchema>;

// --- What the screens read ---------------------------------------------------------------------------

export const ApplicationStatusSchema = z.enum(["email_unverified", "pending_review", "needs_changes", "approved", "rejected", "expired"]).openapi("ApplicationStatus");

export const ApplicationSummarySchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    status: ApplicationStatusSchema,
    walkIn: z.boolean(),
    levelId: z.string(),
    levelName: z.string(),
    programmeName: z.string(),
    sectionKey: z.string(),
    /** The section's own name, for people to read; the key is for code (Co-ordinator FUT F-05). */
    sectionName: z.string(),
    duplicateFlags: z.array(z.string()),
    createdAt: z.string(),
  })
  .openapi("ApplicationSummary");
export const ApplicationQueueSchema = z.object({ applications: z.array(ApplicationSummarySchema) }).openapi("ApplicationQueue");
export type ApplicationQueue = z.infer<typeof ApplicationQueueSchema>;

export const ApplicationDetailSchema = ApplicationSummarySchema.extend({
  middleName: z.string().nullable(),
  dob: z.string(),
  dobBs: z.string().nullable(),
  phone: z.string(),
  email: z.string(),
  guardianName: z.string(),
  guardianPhone: z.string(),
  previousSchool: z.string().nullable(),
  referredBy: z.string().nullable(),
  changesRequested: z.object({ fields: z.array(z.string()), reason: z.string() }).nullable(),
  decisionReason: z.string().nullable(),
}).openapi("ApplicationDetail");
export type ApplicationDetail = z.infer<typeof ApplicationDetailSchema>;

export const StudentSummarySchema = z
  .object({
    id: z.string(),
    sid: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    status: z.enum(["active", "left", "graduated"]),
    className: z.string().nullable(),
  })
  .openapi("StudentSummary");
export const StudentListSchema = z.object({ students: z.array(StudentSummarySchema) }).openapi("StudentList");
export type StudentList = z.infer<typeof StudentListSchema>;

/** What the level picker on the public application form offers: every open level, whichever section. */
// `programmeId` lets the form ask for the wing, then the course, then the level (D-114).
export const OpenLevelSchema = z.object({ id: z.string(), name: z.string(), programmeId: z.string(), programmeName: z.string(), sectionKey: z.string(), sectionName: z.string() }).openapi("OpenLevel");
export const OpenLevelListSchema = z.object({ levels: z.array(OpenLevelSchema) }).openapi("OpenLevelList");
export type OpenLevelList = z.infer<typeof OpenLevelListSchema>;

export const StudentDetailSchema = z
  .object({
    id: z.string(),
    sid: z.string(),
    firstName: z.string(),
    middleName: z.string().nullable(),
    lastName: z.string(),
    dob: z.string(),
    dobBs: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    guardianName: z.string(),
    guardianPhone: z.string(),
    previousSchool: z.string().nullable(),
    status: z.enum(["active", "left", "graduated"]),
    className: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("StudentDetail");
export type StudentDetail = z.infer<typeof StudentDetailSchema>;

/**
 * Correcting a student's personal details (students.personal.correct; Co-ordinator FUT F-06). Only what changed is sent,
 * with the reason, which the audit trail keeps. The SID is never editable; the email is the student's sign-in, so it is
 * not changed here.
 */
export const CorrectStudentSchema = z
  .strictObject({
    firstName: Name.optional(),
    middleName: Name.nullable().optional(),
    lastName: Name.optional(),
    dob: CalendarDaySchema.optional(),
    phone: Phone.nullable().optional(),
    guardianName: z.string().trim().min(1, "Give the guardian's name").max(120, "Keep it to 120 characters").optional(),
    guardianPhone: Phone.optional(),
    previousSchool: z.string().trim().max(120).nullable().optional(),
    reason: z.string().trim().min(3, "Say why the details are being corrected").max(300, "Keep the reason to 300 characters"),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Change at least one detail")
  .openapi("CorrectStudent");
export type CorrectStudent = z.infer<typeof CorrectStudentSchema>;

/** Returned once, on the request that creates the login, and nowhere else (D-059's rule for a temporary password: never emailed, never logged). */
export const AdmittedSchema = z.object({ id: z.string(), sid: z.string(), temporaryPassword: z.string() }).openapi("Admitted");

// --- Moving students into the next term (D-109, D-110) ----------------------------------------------------------------

export const PromotionBoardSchema = z
  .object({
    /** Closed terms, newest first; `pending` when some of their students have not been moved yet. */
    terms: z.array(z.object({ id: z.string(), label: z.string(), pending: z.boolean() })),
    termId: z.string().nullable(),
    classes: z.array(
      z.object({
        classId: z.string(),
        className: z.string(),
        levelId: z.string(),
        /** Null at the last level: its students graduate. */
        nextLevelId: z.string().nullable(),
        nextLevelName: z.string().nullable(),
        students: z.array(
          z.object({
            enrollmentId: z.string(),
            studentId: z.string(),
            sid: z.string(),
            name: z.string(),
            rollNo: z.number().int().nullable(),
            /** What the closed term's enrollment still owes (positive) or is owed (negative). */
            balancePaisa: z.number().int(),
            outcome: z.enum(["pending", "promoted", "repeated", "left", "graduated"]),
            movedTo: z.string().nullable(),
          }),
        ),
      }),
    ),
    /** The open terms' classes students can move into. */
    targets: z.array(z.object({ classId: z.string(), className: z.string(), levelId: z.string(), termLabel: z.string() })),
  })
  .openapi("PromotionBoard");
export type PromotionBoard = z.infer<typeof PromotionBoardSchema>;

export const MoveInputSchema = z
  .strictObject({
    enrollmentId: PublicIdSchema,
    action: z.enum(["promote", "repeat", "leave", "graduate"]),
    /** The class to move into, for promote and repeat. */
    classId: PublicIdSchema.optional(),
  })
  .refine((m) => (m.action === "promote" || m.action === "repeat") === (m.classId !== undefined), { path: ["classId"], message: "Promote and repeat need a class; leaving and graduating do not" });
export type MoveInput = z.infer<typeof MoveInputSchema>;

export const MovesSchema = z.strictObject({ moves: z.array(MoveInputSchema).min(1, "Choose at least one student").max(300, "Move at most 300 students at once") }).openapi("Moves");

export const MoveResultSchema = z
  .object({
    enrollmentId: z.string(),
    ok: z.boolean(),
    reason: z.enum(["not_found", "invalid", "already_moved", "has_dues", "conflict"]).optional(),
    message: z.string().optional(),
    newEnrollmentId: z.string().optional(),
    carriedDues: z.boolean().optional(),
  })
  .openapi("MoveResult");
export type MoveResult = z.infer<typeof MoveResultSchema>;
export const MoveResultsSchema = z.object({ results: z.array(MoveResultSchema) }).openapi("MoveResults");
