import { z } from "@hono/zod-openapi";

const FullName = z.string().trim().min(2, "Enter the person's full name").max(120, "Keep the name to 120 characters");
/** Stored in lower case, so the same address in another letter case is the same person. */
const Email = z
  .string()
  .trim()
  .min(3, "Enter an email address")
  .max(254, "That email address is too long")
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address")
  .transform((value) => value.toLowerCase());
const Phone = z.string().trim().min(5, "That phone number is too short").max(30, "That phone number is too long").nullable().optional();
const SectionKey = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "Choose a section");

/**
 * A Co-ordinator or an Accountant, for the whole school (no section) or some sections. `sectionKeys` lists the
 * sections (D-099); `sectionKey`, one section, is kept for callers from before it. Not both. A teacher is made
 * through `CreateTeacherSchema`.
 */
export const CreateStaffSchema = z
  .strictObject({
    fullName: FullName,
    email: Email,
    phone: Phone,
    role: z.enum(["coordinator", "accountant"]),
    sectionKey: SectionKey.nullable().optional(),
    sectionKeys: z.array(SectionKey).max(20).optional(),
  })
  .refine((v) => !(v.sectionKey && v.sectionKeys), { message: "Give the sections one way", path: ["sectionKeys"] })
  .refine((v) => !v.sectionKeys || new Set(v.sectionKeys).size === v.sectionKeys.length, { message: "Choose each section once", path: ["sectionKeys"] })
  .openapi("CreateStaff");
export type StaffInput = z.input<typeof CreateStaffSchema>;

/** A teacher has a home section: it decides which Co-ordinator may manage them. */
export const CreateTeacherSchema = z.strictObject({ fullName: FullName, email: Email, phone: Phone, homeSectionKey: SectionKey }).openapi("CreateTeacher");
export type TeacherInput = z.input<typeof CreateTeacherSchema>;

export const StaffChangesSchema = z.strictObject({ active: z.boolean() }).openapi("StaffChanges");

// --- What the Staff screen reads ---------------------------------------------------------------------

export const StaffMemberSchema = z
  .object({
    id: z.string(),
    fullName: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    roles: z.array(z.object({ role: z.string(), scope: z.enum(["own", "assigned", "section", "institution"]), section: z.string().nullable() })),
    /** A teacher's home section (key); null for everyone else. */
    homeSection: z.string().nullable(),
    active: z.boolean(),
    /** True until the person has chosen a password of their own. */
    mustChangePassword: z.boolean(),
    lastSignInAt: z.string().nullable(),
  })
  .openapi("StaffMember");
export const StaffListSchema = z.object({ staff: z.array(StaffMemberSchema) }).openapi("StaffList");
export type StaffList = z.infer<typeof StaffListSchema>;

// --- The People & Access screen (D-099) ----------------------------------------------------------------

/** The two lists: people the Principal gives access to (Co-ordinators, Accountants), and the teaching staff. */
export const PeopleQuerySchema = z.object({
  group: z.enum(["admin", "teaching"]),
  /** Words in the name or email. */
  q: z.string().max(100).optional(),
  role: z.enum(["coordinator", "accountant"]).optional(),
  status: z.enum(["active", "off"]).optional(),
  /** A section key: for administrative staff, people with access to it (or to the whole school); for teachers, their home section. */
  section: SectionKey.optional(),
  /** A programme's public id: teachers who teach in it. */
  programme: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});
export type PeopleQuery = z.infer<typeof PeopleQuerySchema>;

export const PersonSchema = z
  .object({
    id: z.string(),
    fullName: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    role: z.enum(["coordinator", "accountant", "teacher"]),
    /** The sections they have access to (Co-ordinator, Accountant); empty means the whole school. A teacher: empty. */
    sections: z.array(z.object({ key: z.string(), name: z.string() })),
    /** A teacher's home section. */
    homeSection: z.object({ key: z.string(), name: z.string() }).nullable(),
    active: z.boolean(),
    mustChangePassword: z.boolean(),
    lastSignInAt: z.string().nullable(),
    /** A teacher's subjects and programmes, from their active teaching assignments. */
    subjects: z.array(z.string()),
    programmes: z.array(z.string()),
    /** Who added them, as the audit log records it: a name and role, or "Support" (`support: true`) for the build team. Null when unknown. */
    addedBy: z.object({ name: z.string().nullable(), role: z.string().nullable(), support: z.boolean() }).nullable(),
    /** Whether the person asking may switch this person off or on and give them a new temporary password. */
    canManage: z.boolean(),
  })
  .openapi("Person");
export type Person = z.infer<typeof PersonSchema>;

export const PeopleListSchema = z
  .object({
    people: z.array(PersonSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    /** Switched-on people, over everyone the person asking may see, whatever the filters. */
    counts: z.object({ teachers: z.number().int(), coordinators: z.number().int(), accountants: z.number().int() }),
    /** Every section, for the access choices and the filter. */
    sections: z.array(z.object({ key: z.string(), name: z.string(), active: z.boolean() })),
  })
  .openapi("PeopleList");
export type PeopleList = z.infer<typeof PeopleListSchema>;

/** Where a Co-ordinator's or Accountant's access reaches: the whole school (`[]`), or these sections. */
export const AccessChangesSchema = z
  .strictObject({ sectionKeys: z.array(SectionKey).max(20).refine((keys) => new Set(keys).size === keys.length, "Choose each section once") })
  .openapi("AccessChanges");
export type AccessChanges = z.infer<typeof AccessChangesSchema>;
