import { z } from "@hono/zod-openapi";

/** A public id as it appears in an address. */
export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

const Naming = { programmeName: z.string(), levelName: z.string(), label: z.string() };
const Reason = (what: string) => z.string().trim().min(3, `Give a ${what} of at least 3 characters`).max(500, `Keep the ${what} to 500 characters`);

export const SheetStatusSchema = z.enum(["not_started", "draft", "under_review", "verified", "published"]);
export type SheetStatus = z.infer<typeof SheetStatusSchema>;

// --- Elective picks (slice 2) ------------------------------------------------------------------------

export const ClassElectivesSchema = z
  .object({
    classId: z.string(),
    ...Naming,
    groups: z.array(z.object({ id: z.string(), name: z.string(), pickCount: z.number().int(), subjects: z.array(z.object({ offeringId: z.string(), name: z.string() })) })),
    students: z.array(z.object({ enrollmentId: z.string(), sid: z.string(), name: z.string(), picks: z.array(z.string()) })),
  })
  .openapi("ClassElectives");
export type ClassElectives = z.infer<typeof ClassElectivesSchema>;

export const SetPicksSchema = z.strictObject({ offeringIds: z.array(PublicIdSchema).max(10) }).openapi("SetElectivePicks");
export type SetPicks = z.infer<typeof SetPicksSchema>;

// --- The marks grid (slice 2) ------------------------------------------------------------------------

export const MyMarkSheetsSchema = z
  .object({
    terminals: z.array(z.object({ id: z.string(), name: z.string() })),
    subjects: z.array(
      z.object({
        classId: z.string(),
        ...Naming,
        offeringId: z.string(),
        subjectName: z.string(),
        sheets: z.array(z.object({ terminalId: z.string(), status: SheetStatusSchema, note: z.string().nullable() })),
      }),
    ),
  })
  .openapi("MyMarkSheets");
export type MyMarkSheets = z.infer<typeof MyMarkSheetsSchema>;

export const MarkSheetSchema = z
  .object({
    sheetId: z.string().nullable(),
    classId: z.string(),
    ...Naming,
    offeringId: z.string(),
    subjectName: z.string(),
    terminal: z.object({ id: z.string(), name: z.string() }),
    teacherName: z.string().nullable(),
    status: SheetStatusSchema,
    note: z.string().nullable(),
    components: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["theory", "practical"]), maxHundredths: z.number().int() })),
    students: z.array(
      z.object({
        enrollmentId: z.string(),
        sid: z.string(),
        name: z.string(),
        rollNo: z.number().int().nullable(),
        marks: z.array(z.object({ componentId: z.string(), valueHundredths: z.number().int().nullable(), absent: z.boolean() })),
      }),
    ),
    missing: z.number().int(),
  })
  .openapi("MarkSheet");
export type MarkSheet = z.infer<typeof MarkSheetSchema>;

const MarkValue = z.number().int("Marks are whole hundredths").min(0, "A mark cannot be negative").max(100000);

export const SaveMarksSchema = z
  .strictObject({
    marks: z
      .array(z.strictObject({ enrollmentId: PublicIdSchema, componentId: PublicIdSchema, valueHundredths: MarkValue.nullable(), absent: z.boolean().default(false) }))
      .min(1, "Enter at least one mark")
      .max(2000),
  })
  .refine((b) => b.marks.every((m) => !(m.absent && m.valueHundredths !== null)), "A student marked absent has no mark")
  .refine((b) => new Set(b.marks.map((m) => `${m.enrollmentId}/${m.componentId}`)).size === b.marks.length, "A mark is listed twice")
  .openapi("SaveMarks");
export type SaveMarks = z.input<typeof SaveMarksSchema>;

// --- Review and publish (slice 3) --------------------------------------------------------------------

export const ReviewBoardSchema = z
  .object({
    terminals: z.array(z.object({ id: z.string(), name: z.string() })),
    terminalId: z.string().nullable(),
    classes: z.array(
      z.object({
        classId: z.string(),
        ...Naming,
        gradingPolicy: z.enum(["neb_gpa", "percentage_division"]).nullable(),
        published: z.boolean(),
        ready: z.boolean(),
        subjects: z.array(
          z.object({
            offeringId: z.string(),
            subjectName: z.string(),
            teacherName: z.string().nullable(),
            sheetId: z.string().nullable(),
            status: SheetStatusSchema,
            missing: z.number().int(),
          }),
        ),
      }),
    ),
  })
  .openapi("ReviewBoard");
export type ReviewBoard = z.infer<typeof ReviewBoardSchema>;

export const SendBackSchema = z.strictObject({ note: Reason("note") }).openapi("SendBackSheet");
export const BulkVerifySchema = z.strictObject({ sheetIds: z.array(PublicIdSchema).min(1).max(200) }).openapi("BulkVerify");
export const PublishSchema = z.strictObject({ terminalId: PublicIdSchema }).openapi("PublishClass");

// --- What people read (slice 4) ----------------------------------------------------------------------

export const CardSubjectSchema = z.object({
  offeringId: z.string(),
  name: z.string(),
  creditHundredths: z.number().int().nullable(),
  obtainedHundredths: z.number().int(),
  maxHundredths: z.number().int(),
  percentHundredths: z.number().int(),
  grade: z.string(),
  gradePointHundredths: z.number().int().nullable(),
  passed: z.boolean(),
  components: z.array(z.object({ name: z.string(), kind: z.enum(["theory", "practical"]), maxHundredths: z.number().int(), valueHundredths: z.number().int().nullable(), absent: z.boolean() })),
});

/** What a marks card says: the snapshot stored at publish (or at a recheck), never recomputed. */
export const CardBodySchema = z.object({
  student: z.object({ name: z.string(), sid: z.string(), rollNo: z.number().int().nullable() }),
  class: z.object({ ...Naming, sectionName: z.string(), yearLabel: z.string() }),
  terminal: z.object({ name: z.string() }),
  policy: z.enum(["neb_gpa", "percentage_division"]),
  subjects: z.array(CardSubjectSchema),
  gpaHundredths: z.number().int().nullable(),
  percentHundredths: z.number().int().nullable(),
  outcome: z.string(),
  passed: z.boolean(),
});
export type CardBody = z.infer<typeof CardBodySchema>;

export const MarksCardSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    publishedAt: z.string(),
    publishedAtBs: z.string().nullable(),
    reason: z.string().nullable(),
    body: CardBodySchema,
  })
  .openapi("MarksCard");
export type MarksCard = z.infer<typeof MarksCardSchema>;

export const RecheckSummarySchema = z.object({
  id: z.string(),
  offeringId: z.string(),
  subjectName: z.string(),
  reason: z.string(),
  status: z.enum(["open", "changed", "unchanged"]),
  requestedAt: z.string(),
  decisionReason: z.string().nullable(),
});

export const OwnResultsSchema = z
  .object({
    results: z.array(
      z.object({
        publicationId: z.string(),
        yearLabel: z.string(),
        terminalName: z.string(),
        card: MarksCardSchema,
        rechecks: z.array(RecheckSummarySchema),
      }),
    ),
  })
  .openapi("OwnResults");
export type OwnResults = z.infer<typeof OwnResultsSchema>;

export const Top20Schema = z
  .object({
    terminals: z.array(z.object({ id: z.string(), name: z.string() })),
    terminalId: z.string().nullable(),
    pools: z.array(
      z.object({
        sectionName: z.string(),
        levelName: z.string(),
        entries: z.array(z.object({ rank: z.number().int(), name: z.string(), className: z.string().optional(), score: z.number().int().optional() })),
      }),
    ),
  })
  .openapi("Top20");
export type Top20 = z.infer<typeof Top20Schema>;

export const ClassSheetSchema = z
  .object({
    classId: z.string(),
    ...Naming,
    terminal: z.object({ id: z.string(), name: z.string() }),
    policy: z.enum(["neb_gpa", "percentage_division"]),
    publishedAt: z.string(),
    subjects: z.array(z.object({ offeringId: z.string(), name: z.string() })),
    students: z.array(
      z.object({
        enrollmentId: z.string(),
        cardId: z.string(),
        sid: z.string(),
        name: z.string(),
        rank: z.number().int().nullable(),
        gpaHundredths: z.number().int().nullable(),
        percentHundredths: z.number().int().nullable(),
        outcome: z.string(),
        version: z.number().int(),
        subjects: z.array(z.object({ offeringId: z.string(), grade: z.string(), percentHundredths: z.number().int() }).nullable()),
      }),
    ),
  })
  .openapi("ClassResultSheet");
export type ClassSheet = z.infer<typeof ClassSheetSchema>;

// --- Rechecks (slice 5) ------------------------------------------------------------------------------

export const RequestRecheckSchema = z.strictObject({ offeringId: PublicIdSchema, reason: Reason("reason") }).openapi("RequestRecheck");
export type RequestRecheck = z.infer<typeof RequestRecheckSchema>;

export const DecideRecheckSchema = z
  .strictObject({
    outcome: z.enum(["changed", "unchanged"]),
    reason: Reason("reason"),
    marks: z.array(z.strictObject({ componentId: PublicIdSchema, valueHundredths: MarkValue.nullable(), absent: z.boolean().default(false) })).max(10).default([]),
  })
  .refine((b) => b.outcome === "unchanged" || b.marks.length > 0, "Give the corrected marks")
  .refine((b) => b.marks.every((m) => m.absent !== (m.valueHundredths !== null)), "Each mark is a number or absent")
  .openapi("DecideRecheck");
export type DecideRecheck = z.input<typeof DecideRecheckSchema>;

export const RecheckListSchema = z
  .object({
    rechecks: z.array(
      RecheckSummarySchema.extend({
        classId: z.string(),
        ...Naming,
        terminalName: z.string(),
        studentName: z.string(),
        sid: z.string(),
        decidedAt: z.string().nullable(),
        /** The days in BS, worked out on the server (the only place that converts), for the Principal's read (D-104). */
        decidedOnBs: z.string().nullable(),
        requestedOnBs: z.string().nullable(),
        decidedBy: z.string().nullable(),
        marks: z.array(z.object({ componentId: z.string(), name: z.string(), maxHundredths: z.number().int(), valueHundredths: z.number().int().nullable(), absent: z.boolean() })),
      }),
    ),
  })
  .openapi("RecheckList");
export type RecheckList = z.infer<typeof RecheckListSchema>;
