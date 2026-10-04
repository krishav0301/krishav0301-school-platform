import { z } from "@hono/zod-openapi";

/** An AD calendar day, "YYYY-MM-DD", checked against the real calendar. (Kept here, not imported from `content`: modules do not reach into each other.) */
export const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "That day does not exist");

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

// --- Academic terms (D-109, D-110) ----------------------------------------------------------------------
// The code still says "year": a row of `academic_years` is an academic term of any length, set by the Principal.

const TermName = z.string().trim().min(1, "Give the term a name").max(60, "Keep the name to 60 characters");
/** The marker in a receipt number, such as 2083 in P2-2083-00007: 2 to 10 capital letters or digits. */
const TermCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, "Use 2 to 10 letters or digits for the receipt code"));
const LevelIds = z.array(PublicIdSchema).max(200, "That is too many levels for one term");

/** The whole of a term. The service checks every write against this (and against the verified calendar). */
export const YearInputSchema = z
  .strictObject({
    /** Optional and only checked: the BS year is the one the start day falls in. */
    bsYear: z.number().int("The BS year is a whole number").optional(),
    label: TermName.optional(),
    /** Optional: by default the BS year of the start day, with a letter added if that is taken. */
    code: TermCode.optional(),
    startDate: CalendarDaySchema,
    endDate: CalendarDaySchema,
    /** The levels that run in this term (none if left out). A level can be in only one open term at a time. */
    levelIds: LevelIds.optional(),
  })
  .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "The term must end after it starts" });
export type YearInput = z.input<typeof YearInputSchema>;

export const CreateYearSchema = YearInputSchema.openapi("CreateYear");

/**
 * What may change. The name, receipt code and days only while the term is a draft; the levels while it is open (a level
 * with classes in the term stays).
 */
export const YearChangesSchema = z
  .strictObject({ label: TermName, code: TermCode, startDate: CalendarDaySchema, endDate: CalendarDaySchema, levelIds: LevelIds })
  .partial()
  .openapi("YearChanges");
export type YearChanges = z.infer<typeof YearChangesSchema>;

// --- Programmes and levels ---------------------------------------------------------------------------

const ProgrammeName = z.string().trim().min(1, "Give the programme a name").max(120, "Keep the name to 120 characters");
const Affiliation = z.string().trim().min(1, "Give the affiliation, for example NEB").max(120, "Keep the affiliation to 120 characters");
const LevelName = z.string().trim().min(1, "Give the level a name").max(60, "Keep the name to 60 characters");

/**
 * A section (D-095): a part of the school that groups programmes, such as "Bachelor's", "Master's", "Primary". The
 * Admin makes them; a school starts with none. Its key is generated and never changes: section scopes, receipt
 * numbering and the Top 20 are keyed by it. Only the name may change.
 */
const SectionName = z.string().trim().min(1, "Give the section a name").max(60, "Keep the name to 60 characters");
/**
 * The short code a section's receipt numbers start with (D-102), such as "P2" in P2-2083-00007: 2 to 6 letters or
 * digits, stored in capitals. Left out when adding a section, one is made from the name.
 */
export const ReceiptCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,6}$/, "Use 2 to 6 letters or digits for the receipt code, such as P2 or BACH");
export const CreateSectionSchema = z.strictObject({ name: SectionName, receiptCode: ReceiptCode.optional() }).openapi("CreateSection");
export type SectionInput = z.input<typeof CreateSectionSchema>;
export const SectionChangesSchema = z.strictObject({ name: SectionName, active: z.boolean(), receiptCode: ReceiptCode }).partial().openapi("SectionChanges");
export type SectionChanges = z.infer<typeof SectionChangesSchema>;
export const SectionKeyParam = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/) });

export const CreateProgrammeSchema = z
  .strictObject({ name: ProgrammeName, sectionKey: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "Choose a section"), affiliation: Affiliation })
  .openapi("CreateProgramme");
export type ProgrammeInput = z.input<typeof CreateProgrammeSchema>;

/** A programme's grading policy (Phase 7, D-079); null means none, and a class of a programme with none cannot be published. */
export const GradingPolicySchema = z.enum(["neb_gpa", "percentage_division"]);

export const ProgrammeChangesSchema = z
  .strictObject({ name: ProgrammeName, affiliation: Affiliation, active: z.boolean(), gradingPolicy: GradingPolicySchema.nullable() })
  .partial()
  .openapi("ProgrammeChanges");
export type ProgrammeChanges = z.infer<typeof ProgrammeChangesSchema>;

/** How long a level usually runs, in months (D-110): fills in the next term's end date. */
const UsualMonths = z.number().int("Use whole months").min(1, "At least 1 month").max(60, "At most 60 months");

export const CreateLevelSchema = z.strictObject({ name: LevelName, usualMonths: UsualMonths.optional() }).openapi("CreateLevel");
export type LevelInput = z.input<typeof CreateLevelSchema>;

export const LevelChangesSchema = z.strictObject({ name: LevelName, active: z.boolean(), usualMonths: UsualMonths.nullable() }).partial().openapi("LevelChanges");
export type LevelChanges = z.infer<typeof LevelChangesSchema>;

// --- Classes and terminals ---------------------------------------------------------------------------

const ClassLabel = z.string().trim().max(40, "Keep the label to 40 characters");
const TerminalName = z.string().trim().min(1, "Give the terminal a name").max(60, "Keep the name to 60 characters");

/** A class is a level in a year. The programme is the level's own, so it is never sent. */
export const CreateClassSchema = z.strictObject({ yearId: PublicIdSchema, levelId: PublicIdSchema, label: ClassLabel.default("") }).openapi("CreateClass");
export type ClassInput = z.input<typeof CreateClassSchema>;

export const ClassChangesSchema = z.strictObject({ label: ClassLabel, active: z.boolean() }).partial().openapi("ClassChanges");
export type ClassChanges = z.infer<typeof ClassChangesSchema>;

export const CreateTerminalSchema = z.strictObject({ yearId: PublicIdSchema, name: TerminalName }).openapi("CreateTerminal");
export type TerminalInput = z.input<typeof CreateTerminalSchema>;

export const TerminalChangesSchema = z.strictObject({ name: TerminalName }).partial().openapi("TerminalChanges");
export type TerminalChanges = z.infer<typeof TerminalChangesSchema>;

// --- What the screens read ---------------------------------------------------------------------------

export const TermLevelSchema = z
  .object({ id: z.string(), name: z.string(), ordinal: z.number().int(), programmeId: z.string(), programmeName: z.string(), sectionKey: z.string() })
  .openapi("TermLevel");

export const AcademicYearSchema = z
  .object({
    id: z.string(),
    /** The BS year the term starts in. */
    bsYear: z.number().int(),
    label: z.string(),
    /** The marker in its receipt numbers. */
    code: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    /** The same days in Bikram Sambat, "YYYY-MM-DD"; null if a day is outside the verified years. */
    startDateBs: z.string().nullable(),
    endDateBs: z.string().nullable(),
    status: z.enum(["draft", "active", "closed"]),
    /** The levels that run in it, by section, programme and level order. */
    levels: z.array(TermLevelSchema),
    classes: z.number().int(),
    students: z.number().int(),
  })
  .openapi("AcademicYear");
export const AcademicYearListSchema = z.object({ years: z.array(AcademicYearSchema) }).openapi("AcademicYearList");
export type AcademicYearList = z.infer<typeof AcademicYearListSchema>;

/** What still stops a term from closing (D-109): a class with students whose results are not published for an exam. */
export const CloseCheckSchema = z
  .object({
    ready: z.boolean(),
    exams: z.number().int(),
    classes: z.number().int(),
    missing: z.array(z.object({ classId: z.string(), className: z.string(), examId: z.string().nullable(), examName: z.string().nullable() })),
  })
  .openapi("TermCloseCheck");
export type CloseCheck = z.infer<typeof CloseCheckSchema>;

/** The next term, filled in for the Principal to confirm (D-109): the next level of each batch, and dates following on. */
export const NextTermSchema = z
  .object({
    label: z.string(),
    code: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    startDateBs: z.string().nullable(),
    endDateBs: z.string().nullable(),
    levels: z.array(TermLevelSchema.extend({ takenBy: z.string().nullable() })),
  })
  .openapi("NextTerm");
export type NextTerm = z.infer<typeof NextTermSchema>;

export const LevelSchema = z
  .object({
    id: z.string(),
    ordinal: z.number().int(),
    name: z.string(),
    active: z.boolean(),
    /** How long it usually runs, in months; null when not given (D-110). */
    usualMonths: z.number().int().nullable(),
    /** Students enrolled at this level in the active year (D-096); 0 when no year is active. */
    students: z.number().int(),
    /** Nothing is attached to it (no class, subject, elective group, application or fee structure), so it may be deleted (D-097). */
    canDelete: z.boolean(),
  })
  .openapi("Level");
export const ProgrammeSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    section: z.object({ key: z.string(), name: z.string() }),
    affiliation: z.string(),
    active: z.boolean(),
    gradingPolicy: GradingPolicySchema.nullable(),
    levels: z.array(LevelSchema),
    /** Students enrolled in this programme in the active year: the sum of its levels' (D-096). */
    students: z.number().int(),
    /** It has no levels and no applications, so it may be deleted (D-097). */
    canDelete: z.boolean(),
  })
  .openapi("Programme");
export const SectionSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    /** Switched off sections keep their history and take no new programmes (D-097). */
    active: z.boolean(),
    /** What its receipt numbers start with (D-102); null for a section made before codes, which numbers with its key. */
    receiptCode: z.string().nullable(),
    /** The receipt code is fixed once the section has issued a receipt under it (D-102). */
    receiptCodeLocked: z.boolean(),
    /** Nothing is attached to it (no programme, staff scope or home section, receipt or receipt counter), so it may be deleted (D-097). */
    canDelete: z.boolean(),
  })
  .openapi("Section");
export const ProgrammeListSchema = z
  .object({
    programmes: z.array(ProgrammeSchema),
    /** The sections the person may see, in order, with or without programmes: the Programs screen lists and adds to them (D-095). */
    sections: z.array(SectionSchema),
    /**
     * The Academic Structure page's four figures (D-096), worked out here from the same rows: sections, programmes
     * switched on, levels switched on (of programmes switched on), and students enrolled in the active year.
     */
    totals: z.object({ sections: z.number().int(), programmes: z.number().int(), levels: z.number().int(), students: z.number().int() }),
  })
  .openapi("ProgrammeList");
export type ProgrammeList = z.infer<typeof ProgrammeListSchema>;

export const SchoolClassSchema = z
  .object({
    id: z.string(),
    yearId: z.string(),
    programmeId: z.string(),
    programmeName: z.string(),
    sectionKey: z.string(),
    levelId: z.string(),
    levelName: z.string(),
    /** Empty when the class has no label. */
    label: z.string(),
    active: z.boolean(),
    /** No student, teacher, activity, note, homework, mark sheet or published result is attached, so it may be deleted (D-097). */
    canDelete: z.boolean(),
  })
  .openapi("SchoolClass");
export const SchoolClassListSchema = z.object({ classes: z.array(SchoolClassSchema) }).openapi("SchoolClassList");
export type SchoolClassList = z.infer<typeof SchoolClassListSchema>;

export const TerminalSchema = z.object({ id: z.string(), yearId: z.string(), name: z.string(), ordinal: z.number().int() }).openapi("Terminal");
export const TerminalListSchema = z.object({ terminals: z.array(TerminalSchema) }).openapi("TerminalList");
export type TerminalList = z.infer<typeof TerminalListSchema>;

// --- Subjects -----------------------------------------------------------------------------------------

const SubjectName = z.string().trim().min(1, "Give the subject a name").max(120, "Keep the name to 120 characters");
const SubjectCode = z.string().trim().min(1, "Give the code at least one character").max(20, "Keep the code to 20 characters");

export const CreateSubjectSchema = z.strictObject({ name: SubjectName, code: SubjectCode.nullable().optional() }).openapi("CreateSubject");
export type SubjectInput = z.input<typeof CreateSubjectSchema>;

/** `code: null` takes the code away. */
export const SubjectChangesSchema = z.strictObject({ name: SubjectName, code: SubjectCode.nullable(), archived: z.boolean() }).partial().openapi("SubjectChanges");
export type SubjectChanges = z.infer<typeof SubjectChangesSchema>;

// --- Elective groups, offerings and mark components ----------------------------------------------------

const GroupName = z.string().trim().min(1, "Give the group a name").max(60, "Keep the name to 60 characters");
const PickCount = z.number().int("How many to pick is a whole number").min(1, "Pick at least one").max(10, "Pick at most 10");

export const CreateGroupSchema = z.strictObject({ name: GroupName, pickCount: PickCount.optional() }).openapi("CreateGroup");
export type GroupInput = z.input<typeof CreateGroupSchema>;

export const GroupChangesSchema = z.strictObject({ name: GroupName, pickCount: PickCount, active: z.boolean() }).partial().openapi("GroupChanges");
export type GroupChanges = z.infer<typeof GroupChangesSchema>;

/** Credit hours in whole hundredths: 375 means 3.75. */
const Credit = z.number().int("Credit hours are whole hundredths").min(1, "Credit hours must be more than zero").max(10000, "Credit hours are at most 100");

export const CreateOfferingSchema = z
  .strictObject({ levelId: PublicIdSchema, subjectId: PublicIdSchema, creditHundredths: Credit.nullable().optional(), groupId: PublicIdSchema.nullable().optional() })
  .openapi("CreateOffering");
export type OfferingInput = z.input<typeof CreateOfferingSchema>;

/** `creditHundredths: null` takes the credit hours away, and `groupId: null` takes the subject out of its group. */
export const OfferingChangesSchema = z.strictObject({ creditHundredths: Credit.nullable(), groupId: PublicIdSchema.nullable(), active: z.boolean() }).partial().openapi("OfferingChanges");
export type OfferingChanges = z.infer<typeof OfferingChangesSchema>;

const ComponentName = z.string().trim().min(1, "Give the component a name").max(60, "Keep the name to 60 characters");
/** Maximum marks in whole hundredths: 7500 means 75. */
const MaxMarks = z.number().int("Maximum marks are whole hundredths").min(1, "The maximum must be more than zero").max(100000, "The maximum is at most 1000");

/** Theory or practical (an internal assessment counts as practical): NEB's pass mark differs between them (D-079). */
const ComponentKind = z.enum(["theory", "practical"]);

export const CreateComponentSchema = z.strictObject({ name: ComponentName, maxHundredths: MaxMarks, kind: ComponentKind.default("theory") }).openapi("CreateComponent");
export type ComponentInput = z.input<typeof CreateComponentSchema>;

export const ComponentChangesSchema = z.strictObject({ name: ComponentName, maxHundredths: MaxMarks, kind: ComponentKind, active: z.boolean() }).partial().openapi("ComponentChanges");
export type ComponentChanges = z.infer<typeof ComponentChangesSchema>;

// --- What the subject screens read -------------------------------------------------------------------

export const SubjectSchema = z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), archived: z.boolean() }).openapi("Subject");
export const SubjectListSchema = z.object({ subjects: z.array(SubjectSchema) }).openapi("SubjectList");
export type SubjectList = z.infer<typeof SubjectListSchema>;

export const CurriculumComponentSchema = z
  .object({ id: z.string(), name: z.string(), maxHundredths: z.number().int(), kind: ComponentKind, ordinal: z.number().int(), active: z.boolean() })
  .openapi("CurriculumComponent");

export const CurriculumOfferingSchema = z
  .object({
    id: z.string(),
    subject: SubjectSchema,
    /** Credit hours in whole hundredths (375 means 3.75); null when none. */
    creditHundredths: z.number().int().nullable(),
    group: z.object({ id: z.string(), name: z.string() }).nullable(),
    active: z.boolean(),
    components: z.array(CurriculumComponentSchema),
  })
  .openapi("CurriculumOffering");

export const CurriculumGroupSchema = z.object({ id: z.string(), name: z.string(), pickCount: z.number().int(), active: z.boolean() }).openapi("CurriculumGroup");

/** One level's elective groups, subjects and mark components, in one answer. */
export const CurriculumSchema = z
  .object({
    level: z.object({ id: z.string(), name: z.string(), programmeId: z.string(), programmeName: z.string() }),
    groups: z.array(CurriculumGroupSchema),
    offerings: z.array(CurriculumOfferingSchema),
  })
  .openapi("Curriculum");
export type Curriculum = z.infer<typeof CurriculumSchema>;

// --- Teaching (D-060): who teaches what in a class, and the Class Teacher --------------------------

export const AssignmentInputSchema = z.strictObject({ classId: PublicIdSchema, offeringId: PublicIdSchema, teacherId: PublicIdSchema.nullable() }).openapi("AssignmentInput");
export type AssignmentInput = z.infer<typeof AssignmentInputSchema>;

export const ClassTeacherInputSchema = z.strictObject({ teacherId: PublicIdSchema.nullable() }).openapi("ClassTeacherInput");
export type ClassTeacherInput = z.infer<typeof ClassTeacherInputSchema>;

/**
 * A person, named for a teacher picker. Deliberately not a named `.openapi()` component: registering it once
 * and calling `.nullable()` on it elsewhere merges the null into the shared component (`type: ["object", "null"]`),
 * which then makes the never-null `teachers` list wrongly nullable too. Left as a plain anonymous shape, inlined
 * wherever it is used, non-nullably here and with `.nullable()` at the two call sites that need it.
 */
const teacherShape = () => z.object({ id: z.string(), fullName: z.string() });

export const TeachingAssignmentSchema = z.object({ offeringId: z.string(), subjectName: z.string(), teacher: teacherShape().nullable() }).openapi("TeachingAssignment");

/** One class's teaching: its subjects with their current teacher, its Class Teacher, and who may be picked. */
export const TeachingSchema = z
  .object({
    classId: z.string(),
    classLabel: z.string(),
    levelName: z.string(),
    classTeacher: teacherShape().nullable(),
    assignments: z.array(TeachingAssignmentSchema),
    /** The teachers this viewer may pick from, for both dropdowns. Never contains a null entry. */
    teachers: z.array(teacherShape()),
  })
  .openapi("Teaching");
export type Teaching = z.infer<typeof TeachingSchema>;

/** Every class's teaching in one year, for reading (D-108): the subjects with their teacher and the Class Teacher. */
export const YearTeachingSchema = z
  .object({ classes: z.array(TeachingSchema.omit({ teachers: true })) })
  .openapi("YearTeaching");
export type YearTeaching = z.infer<typeof YearTeachingSchema>;

// --- Setup checklist (D-062): nothing stored, computed fresh from the data --------------------------

export const SetupChecklistSchema = z
  .object({
    year: z.boolean(),
    structure: z.boolean(),
    classes: z.boolean(),
    terminals: z.boolean(),
    subjects: z.boolean(),
    teachers: z.boolean(),
    classTeachers: z.boolean(),
  })
  .openapi("SetupChecklist");
export type SetupChecklist = z.infer<typeof SetupChecklistSchema>;
