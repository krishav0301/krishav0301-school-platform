import type { MessageKey } from "@/i18n/messages";
import type { components } from "@/api/schema";

export type OpenLevel = components["schemas"]["OpenLevel"];
export type ApplicationSummary = components["schemas"]["ApplicationSummary"];
export type ApplicationDetail = components["schemas"]["ApplicationDetail"];
export type ApplicationStatus = components["schemas"]["ApplicationStatus"];
export type StudentSummary = components["schemas"]["StudentSummary"];
export type StudentDetail = components["schemas"]["StudentDetail"];

/** What the applicant form (public, walk-in, or staff registration) collects. BS dates go in as typed; the AD day is resolved before sending. */
export interface ApplicantForm {
  firstName: string;
  middleName: string;
  lastName: string;
  dobBs: string;
  phone: string;
  email: string;
  guardianName: string;
  guardianPhone: string;
  previousSchool: string;
  referredBy: string;
  levelId: string;
}

export const emptyApplicantForm = (): ApplicantForm => ({
  firstName: "",
  middleName: "",
  lastName: "",
  dobBs: "",
  phone: "",
  email: "",
  guardianName: "",
  guardianPhone: "",
  previousSchool: "",
  referredBy: "",
  levelId: "",
});

export type ApplicantField = "firstName" | "lastName" | "dobBs" | "phone" | "email" | "guardianName" | "guardianPhone" | "levelId";
export type ApplicantErrors = Partial<Record<ApplicantField, MessageKey>>;

/** The same shape checks the server enforces (D-063), so a person is told before sending, not after. */
export function validateApplicant(values: ApplicantForm): ApplicantErrors {
  const errors: ApplicantErrors = {};
  if (!values.firstName.trim()) errors.firstName = "admissions.error.required";
  if (!values.lastName.trim()) errors.lastName = "admissions.error.required";
  if (!values.dobBs.trim()) errors.dobBs = "admissions.error.required";
  if (!/^[0-9+\-() ]{7,20}$/.test(values.phone.trim())) errors.phone = "admissions.error.phone";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "admissions.error.email";
  if (!values.guardianName.trim()) errors.guardianName = "admissions.error.required";
  if (!/^[0-9+\-() ]{7,20}$/.test(values.guardianPhone.trim())) errors.guardianPhone = "admissions.error.phone";
  if (!values.levelId) errors.levelId = "admissions.error.required";
  return errors;
}

export const firstInvalid = (errors: ApplicantErrors): ApplicantField | null => (Object.keys(errors)[0] as ApplicantField | undefined) ?? null;

export const STATUS_LABEL: Record<ApplicationStatus, MessageKey> = {
  email_unverified: "admissions.status.emailUnverified",
  pending_review: "admissions.status.pendingReview",
  needs_changes: "admissions.status.needsChanges",
  approved: "admissions.status.approved",
  rejected: "admissions.status.rejected",
  expired: "admissions.status.expired",
};

export const levelChoices = (levels: readonly OpenLevel[]): { value: string; label: string }[] =>
  levels.map((l) => ({ value: l.id, label: `${l.sectionName} · ${l.programmeName} · ${l.name}` }));
