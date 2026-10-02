import { relativeTime } from "@/dashboard/admin-model";
import { t, type MessageKey } from "@/i18n/messages";
import type { RoleView } from "@/setup/model";

import type { Person } from "./access-client";

/**
 * The People & Access screen's rules that need no browser (D-099). Words come from the catalog; the API still
 * decides what anyone may do (D-025): these only choose what to show.
 */

/** The Principal's access-control centre is for the Admin and the build team; everyone else keeps their own People screen. */
export const seesAccessCentre = (roles: readonly RoleView[]): boolean => roles.some((r) => r.role === "admin" || r.role === "super_admin");

/** Account status and sign-in are two separate facts (D-099): this is the sign-in one. */
export function signInLine(lastSignInAt: string | null, now: Date): string {
  return lastSignInAt ? t("access.lastSignedIn", { when: relativeTime(lastSignInAt, now) }) : t("access.neverSignedIn");
}

/** Where a person's access reaches, in words: the whole school, or their sections' names. */
export function scopeWords(person: Pick<Person, "sections">): string {
  return person.sections.length === 0 ? t("people.wholeSchool") : person.sections.map((s) => s.name).join(", ");
}

/** Up to two initials for the person's circle. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return ((words[0]![0] ?? "") + (words.length > 1 ? (words[words.length - 1]![0] ?? "") : "")).toUpperCase();
}

/** When they last signed in, alone, for a table column: "2 days ago", or "Never". */
export const lastSignIn = (lastSignInAt: string | null, now: Date): string => (lastSignInAt ? relativeTime(lastSignInAt, now) : t("access.never"));

export type AddStep = "role" | "details" | "access" | "review";
export const ADD_STEPS: readonly AddStep[] = ["role", "details", "access", "review"];
export const STEP_LABEL: Record<AddStep, MessageKey> = {
  role: "access.step.role",
  details: "access.step.details",
  access: "access.step.access",
  review: "access.step.review",
};

export interface AddValues {
  role: "coordinator" | "accountant" | null;
  fullName: string;
  email: string;
  phone: string;
  wholeSchool: boolean;
  sectionKeys: string[];
}
export const emptyAdd = (): AddValues => ({ role: null, fullName: "", email: "", phone: "", wholeSchool: true, sectionKeys: [] });

export type AddErrors = Partial<Record<"role" | "fullName" | "email" | "phone" | "sections", MessageKey>>;

/** What must be right before leaving a step. The server checks everything again. */
export function validateStep(step: AddStep, values: AddValues): AddErrors {
  const errors: AddErrors = {};
  if (step === "role" && values.role === null) errors.role = "access.error.roleRequired";
  if (step === "details") {
    if (values.fullName.trim().length < 2) errors.fullName = "people.error.nameRequired";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) errors.email = "people.error.emailInvalid";
    if (values.phone.trim() && values.phone.trim().length < 5) errors.phone = "people.error.phoneInvalid";
  }
  if (step === "access" && !values.wholeSchool && values.sectionKeys.length === 0) errors.sections = "access.error.sectionsRequired";
  return errors;
}

/** The sections a choice sends: none for the whole school. */
export const chosenSections = (values: Pick<AddValues, "wholeSchool" | "sectionKeys">): string[] => (values.wholeSchool ? [] : [...values.sectionKeys].sort());
