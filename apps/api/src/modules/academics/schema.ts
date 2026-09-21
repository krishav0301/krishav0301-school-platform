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

// --- Academic years ---------------------------------------------------------------------------------

const YearLabel = z.string().trim().min(1, "Give the year a name").max(40, "Keep the name to 40 characters");

/** The whole of a year. The service checks every write against this (and against the verified calendar). */
export const YearInputSchema = z
  .strictObject({
    bsYear: z.number().int("The BS year is a whole number"),
    label: YearLabel.optional(),
    startDate: CalendarDaySchema,
    endDate: CalendarDaySchema,
  })
  .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "The year must end after it starts" });
export type YearInput = z.input<typeof YearInputSchema>;

export const CreateYearSchema = YearInputSchema.openapi("CreateYear");

/** What may change while a year is still a draft. The BS year itself is fixed. */
export const YearChangesSchema = z.strictObject({ label: YearLabel, startDate: CalendarDaySchema, endDate: CalendarDaySchema }).partial().openapi("YearChanges");
export type YearChanges = z.infer<typeof YearChangesSchema>;

// --- Programmes and levels ---------------------------------------------------------------------------

const ProgrammeName = z.string().trim().min(1, "Give the programme a name").max(120, "Keep the name to 120 characters");
const Affiliation = z.string().trim().min(1, "Give the affiliation, for example NEB").max(120, "Keep the affiliation to 120 characters");
const LevelName = z.string().trim().min(1, "Give the level a name").max(60, "Keep the name to 60 characters");

export const CreateProgrammeSchema = z
  .strictObject({ name: ProgrammeName, sectionKey: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "Choose a section"), affiliation: Affiliation })
  .openapi("CreateProgramme");
export type ProgrammeInput = z.input<typeof CreateProgrammeSchema>;

export const ProgrammeChangesSchema = z.strictObject({ name: ProgrammeName, affiliation: Affiliation, active: z.boolean() }).partial().openapi("ProgrammeChanges");
export type ProgrammeChanges = z.infer<typeof ProgrammeChangesSchema>;

export const CreateLevelSchema = z.strictObject({ name: LevelName }).openapi("CreateLevel");
export type LevelInput = z.input<typeof CreateLevelSchema>;

export const LevelChangesSchema = z.strictObject({ name: LevelName, active: z.boolean() }).partial().openapi("LevelChanges");
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

export const AcademicYearSchema = z
  .object({
    id: z.string(),
    bsYear: z.number().int(),
    label: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    /** The same days in Bikram Sambat, "YYYY-MM-DD"; null if a day is outside the verified years. */
    startDateBs: z.string().nullable(),
    endDateBs: z.string().nullable(),
    status: z.enum(["draft", "active", "closed"]),
  })
  .openapi("AcademicYear");
export const AcademicYearListSchema = z.object({ years: z.array(AcademicYearSchema) }).openapi("AcademicYearList");
export type AcademicYearList = z.infer<typeof AcademicYearListSchema>;

export const LevelSchema = z.object({ id: z.string(), ordinal: z.number().int(), name: z.string(), active: z.boolean() }).openapi("Level");
export const ProgrammeSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    section: z.object({ key: z.string(), name: z.string() }),
    affiliation: z.string(),
    active: z.boolean(),
    levels: z.array(LevelSchema),
  })
  .openapi("Programme");
export const ProgrammeListSchema = z.object({ programmes: z.array(ProgrammeSchema) }).openapi("ProgrammeList");
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
  })
  .openapi("SchoolClass");
export const SchoolClassListSchema = z.object({ classes: z.array(SchoolClassSchema) }).openapi("SchoolClassList");
export type SchoolClassList = z.infer<typeof SchoolClassListSchema>;

export const TerminalSchema = z.object({ id: z.string(), yearId: z.string(), name: z.string(), ordinal: z.number().int() }).openapi("Terminal");
export const TerminalListSchema = z.object({ terminals: z.array(TerminalSchema) }).openapi("TerminalList");
export type TerminalList = z.infer<typeof TerminalListSchema>;
