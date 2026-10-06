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

export const ProgrammeChangesSchema = z
  .strictObject({ name: ProgrammeName, affiliation: Affiliation, active: z.boolean() })
  .partial()
  .openapi("ProgrammeChanges");
export type ProgrammeChanges = z.infer<typeof ProgrammeChangesSchema>;

/** How long a level usually runs, in months (D-110): fills in the next term's end date. */
const UsualMonths = z.number().int("Use whole months").min(1, "At least 1 month").max(60, "At most 60 months");

// A level's length is asked when it is added and may be changed, never cleared: a term takes only levels of its length (D-114).
export const CreateLevelSchema = z.strictObject({ name: LevelName, usualMonths: UsualMonths }).openapi("CreateLevel");
export type LevelInput = z.input<typeof CreateLevelSchema>;

export const LevelChangesSchema = z.strictObject({ name: LevelName, active: z.boolean(), usualMonths: UsualMonths }).partial().openapi("LevelChanges");
export type LevelChanges = z.infer<typeof LevelChangesSchema>;

// --- Classes and terminals ---------------------------------------------------------------------------

const ClassLabel = z.string().trim().max(40, "Keep the label to 40 characters");
const TerminalName = z.string().trim().min(1, "Give the terminal a name").max(60, "Keep the name to 60 characters");

/** A class is a level in a year. The programme is the level's own, so it is never sent. */
export const CreateClassSchema = z.strictObject({ yearId: PublicIdSchema, levelId: PublicIdSchema, label: ClassLabel.default("") }).openapi("CreateClass");
export type ClassInput = z.input<typeof CreateClassSchema>;

export const ClassChangesSchema = z.strictObject({ label: ClassLabel, active: z.boolean() }).partial().openapi("ClassChanges");
export type ClassChanges = z.infer<typeof ClassChangesSchema>;

// --- The exam pattern (D-117): one per term, out of 100 -------------------------------------------------

const WholePercent = (what: string) => z.number().int(`${what} is a whole number`).min(0, `${what} is at least 0`).max(100, `${what} is at most 100`);

export const GradeBandSchema = z.strictObject({
  grade: z.string().trim().min(1, "Give each grade a letter").max(8, "Keep a grade to 8 characters"),
  from: WholePercent("A grade's starting %"),
});

/**
 * The whole pattern, saved at once: the questions (Grade system? the minimum % for theory and practical, the grade
 * ranges when graded) and the terminals in order. A terminal with an `id` keeps it; one without is new; one left out
 * is removed. Refused once marks have been entered in the term.
 */
export const ExamPatternInputSchema = z
  .strictObject({
    graded: z.boolean(),
    theoryMinPercent: WholePercent("The theory minimum"),
    practicalMinPercent: WholePercent("The practical minimum"),
    gradeBands: z.array(GradeBandSchema).max(20, "At most 20 grades").nullable(),
    terminals: z
      .array(
        z.strictObject({
          id: PublicIdSchema.optional(),
          name: TerminalName,
          weight: z.number().int("A weight is a whole number").min(1, "A weight is at least 1").max(100, "A weight is at most 100"),
          hasPractical: z.boolean(),
        }),
      )
      .max(12, "A term can have at most 12 terminals"),
  })
  .openapi("ExamPatternInput");
export type ExamPatternInput = z.infer<typeof ExamPatternInputSchema>;

// --- What the screens read ---------------------------------------------------------------------------

export const TermLevelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    ordinal: z.number().int(),
    programmeId: z.string(),
    programmeName: z.string(),
    sectionKey: z.string(),
    /** How long the level runs, in months; null until the Admin sets it (D-114). */
    usualMonths: z.number().int().nullable(),
  })
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
    /** Its length in whole months on the BS calendar (D-114); null if a day is outside the verified years. */
    months: z.number().int().nullable(),
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

export const TerminalSchema = z
  .object({
    id: z.string(),
    yearId: z.string(),
    name: z.string(),
    ordinal: z.number().int(),
    /** Whole percent of the final result; null for a terminal made before D-117 and not yet in a pattern. */
    weight: z.number().int().nullable(),
    hasPractical: z.boolean(),
  })
  .openapi("Terminal");
export const TerminalListSchema = z.object({ terminals: z.array(TerminalSchema) }).openapi("TerminalList");
export type TerminalList = z.infer<typeof TerminalListSchema>;

export const ExamPatternSchema = z
  .object({
    term: z.object({ id: z.string(), label: z.string(), status: z.enum(["draft", "active", "closed"]) }),
    /** Null until the Co-ordinator creates it. */
    pattern: z
      .object({
        graded: z.boolean(),
        theoryMinPercent: z.number().int(),
        practicalMinPercent: z.number().int(),
        gradeBands: z.array(z.object({ grade: z.string(), from: z.number().int() })).nullable(),
      })
      .nullable(),
    terminals: z.array(TerminalSchema),
    /** Marks have been entered in this term, so the pattern can no longer change. */
    locked: z.boolean(),
  })
  .openapi("ExamPattern");
export type ExamPattern = z.infer<typeof ExamPatternSchema>;

// --- Subjects -----------------------------------------------------------------------------------------

const SubjectName = z.string().trim().min(1, "Give the subject a name").max(120, "Keep the name to 120 characters");
const SubjectCode = z.string().trim().min(1, "Give the code at least one character").max(20, "Keep the code to 20 characters");

const WingKey = z.string().trim().min(1, "Choose a wing").max(60);
/** A subject belongs to one wing (D-114): +2's English and Bachelor's English are two subjects. */
export const CreateSubjectSchema = z.strictObject({ name: SubjectName, code: SubjectCode.nullable().optional(), sectionKey: WingKey }).openapi("CreateSubject");
export type SubjectInput = z.input<typeof CreateSubjectSchema>;

/** `code: null` takes the code away. */
// `sectionKey` gives an old subject its wing (D-114); a subject that has one keeps it.
export const SubjectChangesSchema = z.strictObject({ name: SubjectName, code: SubjectCode.nullable(), archived: z.boolean(), sectionKey: WingKey }).partial().openapi("SubjectChanges");
export type SubjectChanges = z.infer<typeof SubjectChangesSchema>;

// --- Elective groups and offerings ----------------------------------------------------

const GroupName = z.string().trim().min(1, "Give the group a name").max(60, "Keep the name to 60 characters");
const PickCount = z.number().int("How many to pick is a whole number").min(1, "Pick at least one").max(10, "Pick at most 10");

export const CreateGroupSchema = z.strictObject({ name: GroupName, pickCount: PickCount.optional() }).openapi("CreateGroup");
export type GroupInput = z.input<typeof CreateGroupSchema>;

export const GroupChangesSchema = z.strictObject({ name: GroupName, pickCount: PickCount, active: z.boolean() }).partial().openapi("GroupChanges");
export type GroupChanges = z.infer<typeof GroupChangesSchema>;

/** Credit hours in whole hundredths: 375 means 3.75. */
const Credit = z.number().int("Credit hours are whole hundredths").min(1, "Credit hours must be more than zero").max(10000, "Credit hours are at most 100");

/** Marks in whole hundredths: 7500 means 75. A paper's full marks; the practical's share of them. */
const FullMarks = z.number().int("Marks are whole hundredths").min(100, "Full marks are at least 1").max(100000, "Full marks are at most 1000");
const PracticalMarks = z.number().int("Marks are whole hundredths").min(100, "The practical is at least 1 mark");

const practicalFits = (b: { fullMarksHundredths?: number; practicalHundredths?: number | null }) =>
  b.practicalHundredths === null || b.practicalHundredths === undefined || b.practicalHundredths < (b.fullMarksHundredths ?? 10_000);

export const CreateOfferingSchema = z
  .strictObject({
    levelId: PublicIdSchema,
    subjectId: PublicIdSchema,
    creditHundredths: Credit.nullable().optional(),
    groupId: PublicIdSchema.nullable().optional(),
    /** The paper's full marks (default 100). */
    fullMarksHundredths: FullMarks.optional(),
    /** "This subject has a practical": the practical's share of the full marks (75/25 is 2500). Null or absent: none. */
    practicalHundredths: PracticalMarks.nullable().optional(),
  })
  .refine(practicalFits, { message: "The practical must be less than the full marks", path: ["practicalHundredths"] })
  .openapi("CreateOffering");
export type OfferingInput = z.input<typeof CreateOfferingSchema>;

/**
 * `creditHundredths: null` takes the credit hours away, `groupId: null` takes the subject out of its group, and
 * `practicalHundredths: null` takes the practical away. The full marks and the practical are checked together by the service.
 */
export const OfferingChangesSchema = z
  .strictObject({ creditHundredths: Credit.nullable(), groupId: PublicIdSchema.nullable(), active: z.boolean(), fullMarksHundredths: FullMarks, practicalHundredths: PracticalMarks.nullable() })
  .partial()
  .openapi("OfferingChanges");
export type OfferingChanges = z.infer<typeof OfferingChangesSchema>;

// --- What the subject screens read -------------------------------------------------------------------

export const SubjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string().nullable(),
    archived: z.boolean(),
    /** Its wing (D-114); null for an old subject not given one yet. */
    sectionKey: z.string().nullable(),
    /** Some level's curriculum uses it: its wing is then fixed (FUT point 17). */
    inCurriculum: z.boolean(),
  })
  .openapi("Subject");
export const SubjectListSchema = z.object({ subjects: z.array(SubjectSchema) }).openapi("SubjectList");
export type SubjectList = z.infer<typeof SubjectListSchema>;

export const CurriculumOfferingSchema = z
  .object({
    id: z.string(),
    subject: SubjectSchema,
    /** Credit hours in whole hundredths (375 means 3.75); null when none. */
    creditHundredths: z.number().int().nullable(),
    group: z.object({ id: z.string(), name: z.string() }).nullable(),
    active: z.boolean(),
    /** The paper's full marks, whole hundredths. */
    fullMarksHundredths: z.number().int(),
    /** The practical's share of the full marks; null when the subject has no practical. */
    practicalHundredths: z.number().int().nullable(),
  })
  .openapi("CurriculumOffering");

export const CurriculumGroupSchema = z.object({ id: z.string(), name: z.string(), pickCount: z.number().int(), active: z.boolean() }).openapi("CurriculumGroup");

/** One level's elective groups and subjects (each with its paper), in one answer. */
export const CurriculumSchema = z
  .object({
    /** `sectionKey`: the level's wing; only that wing's subjects may join (D-114). */
    level: z.object({ id: z.string(), name: z.string(), programmeId: z.string(), programmeName: z.string(), sectionKey: z.string() }),
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

// --- A class as one page (FUT point 19, D-116) --------------------------------------------------------

const ClassPlaceSchema = z.object({
  id: z.string(),
  termLabel: z.string(),
  wing: z.string(),
  course: z.string(),
  level: z.string(),
  /** Its section, such as A or Morning; empty when it has none. */
  section: z.string(),
  classTeacher: z.string().nullable(),
  students: z.number().int(),
});
export const ClassHubListSchema = z.object({ classes: z.array(ClassPlaceSchema.extend({ isClassTeacher: z.boolean() })) }).openapi("ClassHubList");
export type ClassHubList = z.infer<typeof ClassHubListSchema>;

const HubSubjectSchema = z.object({ offeringId: z.string(), name: z.string() });
export const ClassHubSchema = z
  .object({
    class: ClassPlaceSchema,
    /** What the person sees: everything (the Class Teacher, the Co-ordinator, the Principal) or a subject teacher's part. */
    /** `staff`: the Principal, a Co-ordinator or Support, who reach the class as a whole (not by teaching in it). */
    viewer: z.object({ seesAll: z.boolean(), attendance: z.boolean(), isClassTeacher: z.boolean(), staff: z.boolean() }),
    subjects: z.array(HubSubjectSchema),
    /** The subjects whose marks the person sees: every one (published, for a Class Teacher), or a subject teacher's own. */
    mySubjects: z.array(HubSubjectSchema),
    /** The subjects the person teaches in this class: their classwork and their marks to enter. */
    taughtSubjects: z.array(HubSubjectSchema),
    /** The term's exams, and whether this class's results are published for each. */
    terminals: z.array(z.object({ id: z.string(), name: z.string(), published: z.boolean() })),
    /** The students, by roll number. `sid` and `studentId` are null for a subject teacher (names only). */
    students: z.array(z.object({ enrollmentId: z.string(), rollNo: z.number().int().nullable(), name: z.string(), sid: z.string().nullable(), studentId: z.string().nullable() })),
  })
  .openapi("ClassHub");
export type ClassHub = z.infer<typeof ClassHubSchema>;
