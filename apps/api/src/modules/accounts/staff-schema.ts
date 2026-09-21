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

/** A Co-ordinator or an Accountant, for the whole school (no section) or one section. A teacher is made through `CreateTeacherSchema`. */
export const CreateStaffSchema = z
  .strictObject({ fullName: FullName, email: Email, phone: Phone, role: z.enum(["coordinator", "accountant"]), sectionKey: SectionKey.nullable().optional() })
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
