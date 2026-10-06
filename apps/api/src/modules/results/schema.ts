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

/** A part of a paper: the theory, or the practical where the terminal holds it and the subject has one (D-114). */
export const PartSchema = z.enum(["theory", "practical"]);
export type Part = z.infer<typeof PartSchema>;

const TerminalRef = z.object({ id: z.string(), name: z.string(), weight: z.number().int() });

export const MyMarkSheetsSchema = z
  .object({
    terminals: z.array(TerminalRef),
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
    terminal: TerminalRef,
    teacherName: z.string().nullable(),
    status: SheetStatusSchema,
    note: z.string().nullable(),
    /** The paper's parts, out of the paper's own marks (the teacher never sees the scaling). */
    components: z.array(z.object({ id: PartSchema, name: z.string(), kind: PartSchema, maxHundredths: z.number().int() })),
    students: z.array(
      z.object({
        enrollmentId: z.string(),
        sid: z.string(),
        name: z.string(),
        rollNo: z.number().int().nullable(),
        marks: z.array(z.object({ componentId: PartSchema, valueHundredths: z.number().int().nullable(), absent: z.boolean() })),
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
      .array(z.strictObject({ enrollmentId: PublicIdSchema, componentId: PartSchema, valueHundredths: MarkValue.nullable(), absent: z.boolean().default(false) }))
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
    terminals: z.array(TerminalRef),
    terminalId: z.string().nullable(),
    classes: z.array(
      z.object({
        classId: z.string(),
        ...Naming,
        published: z.boolean(),
        /** The class's final result is out (published with its last terminal). */
        finalPublished: z.boolean(),
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

const PartMarksSchema = z.object({ maxHundredths: z.number().int(), valueHundredths: z.number().int().nullable(), absent: z.boolean() });
const Student = z.object({ name: z.string(), sid: z.string(), rollNo: z.number().int().nullable() });
const ClassOf = z.object({ ...Naming, sectionName: z.string(), yearLabel: z.string() });

/** The pattern as it was when a result was published (D-114). */
export const PatternSnapshotSchema = z.object({
  graded: z.boolean(),
  theoryMinPercent: z.number().int(),
  practicalMinPercent: z.number().int(),
  gradeBands: z.array(z.object({ grade: z.string(), from: z.number().int() })).nullable(),
  terminals: z.array(z.object({ id: z.string(), name: z.string(), weight: z.number().int() })),
});
export type PatternSnapshot = z.infer<typeof PatternSnapshotSchema>;

/** One terminal's card: for information, no pass or fail. */
export const TerminalCardBodySchema = z.object({
  kind: z.literal("terminal"),
  student: Student,
  class: ClassOf,
  terminal: z.object({ name: z.string(), weight: z.number().int() }),
  graded: z.boolean(),
  subjects: z.array(
    z.object({
      offeringId: z.string(),
      name: z.string(),
      theory: PartMarksSchema,
      practical: PartMarksSchema.nullable(),
      obtainedHundredths: z.number().int(),
      fullHundredths: z.number().int(),
      percentHundredths: z.number().int(),
      scaledHundredths: z.number().int(),
      grade: z.string().nullable(),
    }),
  ),
  percentHundredths: z.number().int(),
  grade: z.string().nullable(),
  outcome: z.string(),
});

/** The final result: every terminal scaled and added, out of 100, pass or fail. */
export const FinalCardBodySchema = z.object({
  kind: z.literal("final"),
  student: Student,
  class: ClassOf,
  pattern: PatternSnapshotSchema,
  subjects: z.array(
    z.object({
      offeringId: z.string(),
      name: z.string(),
      terminals: z.array(z.object({ terminalId: z.string(), terminalName: z.string(), weight: z.number().int(), obtainedHundredths: z.number().int(), fullHundredths: z.number().int(), scaledHundredths: z.number().int() })),
      finalHundredths: z.number().int(),
      theoryPercentHundredths: z.number().int(),
      practicalPercentHundredths: z.number().int().nullable(),
      passed: z.boolean(),
      grade: z.string().nullable(),
    }),
  ),
  percentHundredths: z.number().int(),
  passed: z.boolean(),
  grade: z.string().nullable(),
  outcome: z.string(),
});

/** What a marks card says: the snapshot stored at publish (or at a recheck), never recomputed. */
export const CardBodySchema = z.discriminatedUnion("kind", [TerminalCardBodySchema, FinalCardBodySchema]);
export type CardBody = z.infer<typeof CardBodySchema>;
export type TerminalCardBody = z.infer<typeof TerminalCardBodySchema>;
export type FinalCardBody = z.infer<typeof FinalCardBodySchema>;

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
        /** A terminal's result, or the final (terminalName null). */
        kind: z.enum(["terminal", "final"]),
        terminalName: z.string().nullable(),
        card: MarksCardSchema,
        rechecks: z.array(RecheckSummarySchema),
      }),
    ),
  })
  .openapi("OwnResults");
export type OwnResults = z.infer<typeof OwnResultsSchema>;

/** The Top 20 ranks the final result only (D-114), per open term, section and level. */
export const Top20Schema = z
  .object({
    pools: z.array(
      z.object({
        termLabel: z.string(),
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
    /** The terminal, or null for the final result. */
    terminal: z.object({ id: z.string(), name: z.string() }).nullable(),
    graded: z.boolean(),
    publishedAt: z.string(),
    subjects: z.array(z.object({ offeringId: z.string(), name: z.string() })),
    students: z.array(
      z.object({
        enrollmentId: z.string(),
        cardId: z.string(),
        sid: z.string(),
        name: z.string(),
        /** The rank in the class on the final result (passed students only); null on a terminal. */
        rank: z.number().int().nullable(),
        percentHundredths: z.number().int(),
        /** Final only: pass or fail. */
        passed: z.boolean().nullable(),
        outcome: z.string(),
        version: z.number().int(),
        subjects: z.array(z.object({ offeringId: z.string(), grade: z.string().nullable(), percentHundredths: z.number().int() }).nullable()),
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
    marks: z.array(z.strictObject({ componentId: PartSchema, valueHundredths: MarkValue.nullable(), absent: z.boolean().default(false) })).max(2).default([]),
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
        marks: z.array(z.object({ componentId: PartSchema, name: z.string(), maxHundredths: z.number().int(), valueHundredths: z.number().int().nullable(), absent: z.boolean() })),
      }),
    ),
  })
  .openapi("RecheckList");
export type RecheckList = z.infer<typeof RecheckListSchema>;
