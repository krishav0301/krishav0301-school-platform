import type { components } from "@/api/schema";
import type { MessageKey } from "@/i18n/messages";
import type { RoleView } from "@/setup/model";

export type StaffMember = components["schemas"]["StaffMember"];
export type AddableRole = "coordinator" | "accountant" | "teacher";

/**
 * What a person may add: the Admin adds Co-ordinators and Accountants, a Co-ordinator adds teachers, the Super Admin all three.
 * Only tidiness: the API decides what a person may actually do (D-025).
 */
export function addableRoles(roles: readonly RoleView[]): AddableRole[] {
  if (roles.some((r) => r.role === "super_admin")) return ["coordinator", "accountant", "teacher"];
  const out: AddableRole[] = [];
  if (roles.some((r) => r.role === "admin")) out.push("coordinator", "accountant");
  if (roles.some((r) => r.role === "coordinator")) out.push("teacher");
  return out;
}

export const canManagePeople = (roles: readonly RoleView[]): boolean => addableRoles(roles).length > 0;

/** May this viewer switch this person off, or give them a new temporary password? Mirrors the API's rule, for tidiness. */
export function canManageMember(roles: readonly RoleView[], member: StaffMember): boolean {
  if (roles.some((r) => r.role === "super_admin")) return true;
  const has = (role: string) => member.roles.some((r) => r.role === role);
  if (roles.some((r) => r.role === "admin") && (has("coordinator") || has("accountant"))) return true;
  const coordinator = roles.filter((r) => r.role === "coordinator");
  if (coordinator.length > 0 && has("teacher")) {
    return coordinator.some((r) => r.scope === "institution" || (r.scope === "section" && r.section !== undefined && r.section === member.homeSection));
  }
  return false;
}

export interface StaffFormValues {
  fullName: string;
  email: string;
  phone: string;
  role: AddableRole;
  /** A Co-ordinator's or Accountant's section ("" is the whole school), or a teacher's home section (required). */
  sectionKey: string;
}
export type StaffFormErrors = Partial<Record<"fullName" | "email" | "phone" | "sectionKey", MessageKey>>;

/** The checks that need no server. Whether the email is already used is the server's to say. */
export function validateStaffForm(values: StaffFormValues): StaffFormErrors {
  const errors: StaffFormErrors = {};
  if (values.fullName.trim().length < 2) errors.fullName = "people.error.nameRequired";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) errors.email = "people.error.emailInvalid";
  if (values.phone.trim() && values.phone.trim().length < 5) errors.phone = "people.error.phoneInvalid";
  if (values.role === "teacher" && !values.sectionKey) errors.sectionKey = "people.error.homeSectionRequired";
  return errors;
}

export type FailReason = "forbidden" | "not_found" | "email_taken" | "rejected" | "failed";

export const REASON_MESSAGE: Record<FailReason, MessageKey> = {
  forbidden: "people.error.forbidden",
  not_found: "people.error.gone",
  email_taken: "people.error.emailTaken",
  rejected: "people.error.rejected",
  failed: "people.error.failed",
};
