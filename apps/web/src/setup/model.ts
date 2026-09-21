import type { components } from "@/api/schema";
import type { MessageKey } from "@/i18n/messages";

export type Year = components["schemas"]["AcademicYear"];
export type Programme = components["schemas"]["Programme"];
export type Level = components["schemas"]["Level"];
export type SchoolClass = components["schemas"]["SchoolClass"];
export type Terminal = components["schemas"]["Terminal"];

export interface RoleView {
  role: string;
  scope: string;
  section?: string | undefined;
}

/**
 * Who sees the change controls. Only tidiness: the API decides what a person may actually do (D-025), and
 * shows the Admin the same data, read-only.
 */
export const canManageStructure = (roles: readonly RoleView[]): boolean => roles.some((r) => r.role === "super_admin" || r.role === "coordinator");

/** Years and terminals belong to the whole school: a section-scoped Co-ordinator does not change them. */
export const canManageInstitution = (roles: readonly RoleView[]): boolean =>
  roles.some((r) => r.role === "super_admin" || (r.role === "coordinator" && r.scope === "institution"));

/** The sections a person may add programmes to: every section, or only their own. */
export function manageableSections<S extends { key: string }>(roles: readonly RoleView[], sections: readonly S[]): S[] {
  if (canManageInstitution(roles)) return [...sections];
  const own = new Set(roles.filter((r) => r.role === "coordinator" && r.scope === "section" && r.section).map((r) => r.section));
  return sections.filter((s) => own.has(s.key));
}

/** The year a screen starts on: the current one, else the newest (the API lists newest first). */
export function defaultYearId(years: readonly Year[]): string | null {
  return years.find((y) => y.status === "active")?.id ?? years[0]?.id ?? null;
}

/** What a class picker offers: the active levels of active programmes, named with their programme. */
export function levelChoices(programmes: readonly Programme[]): { value: string; label: string }[] {
  return programmes.filter((p) => p.active).flatMap((p) => p.levels.filter((l) => l.active).map((l) => ({ value: l.id, label: `${p.name} · ${l.name}` })));
}

export const classTitle = (c: SchoolClass): string => `${c.programmeName} · ${c.levelName}${c.label ? ` (${c.label})` : ""}`;

/** The school's own words for the things setup is about (they can be renamed, so they are never in the catalog). */
export const termWords = (term: (key: string) => string) => ({
  programme: term("term.programme"),
  level: term("term.level"),
  section: term("term.section"),
  terminal: term("term.terminal"),
});

export const YEAR_STATUS_LABEL: Record<Year["status"], MessageKey> = {
  draft: "setup.status.draft",
  active: "setup.status.active",
  closed: "setup.status.closed",
};

export type FailReason = "forbidden" | "not_found" | "conflict" | "year_closed" | "another_active" | "rejected" | "failed";

export const REASON_MESSAGE: Record<FailReason, MessageKey> = {
  forbidden: "setup.error.forbidden",
  not_found: "setup.error.gone",
  conflict: "setup.error.conflict",
  year_closed: "setup.error.yearClosed",
  another_active: "setup.error.anotherActive",
  rejected: "setup.error.rejected",
  failed: "setup.error.failed",
};

export interface YearFormValues {
  bsYear: string;
  startBs: string;
  endBs: string;
}
export const emptyYearForm = (): YearFormValues => ({ bsYear: "", startBs: "", endBs: "" });
export type YearFormErrors = Partial<Record<keyof YearFormValues, MessageKey>>;

/** The checks that need no server. Whether a Nepali day exists, and whether its year is verified, is the server's to say. */
export function validateYearForm(values: YearFormValues): YearFormErrors {
  const errors: YearFormErrors = {};
  if (!/^\d{4}$/.test(values.bsYear.trim())) errors.bsYear = "setup.error.bsYear";
  if (!values.startBs.trim()) errors.startBs = "setup.error.startRequired";
  if (!values.endBs.trim()) errors.endBs = "setup.error.endRequired";
  return errors;
}
