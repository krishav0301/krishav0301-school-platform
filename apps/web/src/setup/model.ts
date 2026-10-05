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
/** Programmes and their levels: the Admin and the Super Admin alone (D-087). */
export const canManageProgrammes = (roles: readonly RoleView[]): boolean => roles.some((r) => r.role === "admin" || r.role === "super_admin");

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
/** The levels a class can be made for: switched on, and (given a term's levels, D-110) run by that term. */
export function levelChoices(programmes: readonly Programme[], only?: readonly string[]): { value: string; label: string }[] {
  const allowed = only ? new Set(only) : null;
  return programmes
    .filter((p) => p.active)
    .flatMap((p) => p.levels.filter((l) => l.active && (!allowed || allowed.has(l.id))).map((l) => ({ value: l.id, label: `${p.name} · ${l.name}` })));
}

export const classTitle = (c: SchoolClass): string => `${c.programmeName} · ${c.levelName}${c.label ? ` (${c.label})` : ""}`;

/** The school's own words for the things setup is about (they can be renamed, so they are never in the catalog). */
export const termWords = (term: (key: string) => string) => ({
  programme: term("term.programme"),
  level: term("term.level"),
  section: term("term.section"),
  classSection: term("term.classSection"),
  terminal: term("term.terminal"),
});

export type FailReason = "forbidden" | "not_found" | "conflict" | "year_closed" | "in_use" | "code_taken" | "code_locked" | "rejected" | "failed";

export const REASON_MESSAGE: Record<FailReason, MessageKey> = {
  forbidden: "setup.error.forbidden",
  not_found: "setup.error.gone",
  conflict: "setup.error.conflict",
  year_closed: "setup.error.yearClosed",
  in_use: "setup.error.inUse",
  code_taken: "setup.error.codeTaken",
  code_locked: "setup.error.codeLocked",
  rejected: "setup.error.rejected",
  failed: "setup.error.failed",
};

// --- Subjects and the curriculum (slice 2) -----------------------------------------------------------

export type Subject = components["schemas"]["Subject"];
export type Curriculum = components["schemas"]["Curriculum"];
export type Offering = Curriculum["offerings"][number];
export type Group = Curriculum["groups"][number];
export type MarkComponent = Offering["components"][number];

/**
 * Whole hundredths from what a person typed: "3" is 300, "3.5" is 350, "3.75" is 375. Null when it is not a plain number
 * with at most two decimals ("3.756", "-1", "1e2", "3,5" and an empty box are all null). Credit hours and maximum marks
 * are stored and sent as whole hundredths, never as decimals.
 */
export function parseHundredths(text: string): number | null {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + (match[2] ? Number(match[2].padEnd(2, "0")) : 0);
}

/** Whole hundredths as a person reads them: 375 is "3.75", 300 is "3", 50 is "0.5". */
export function formatHundredths(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * What a level can still take: subjects that are not archived and not already on it. A subject whose offering is
 * switched off is still on the level, so it is not offered again (it is switched back on instead).
 */
/** The subjects a level may take: in use, not on it yet, and of the level's own wing (D-114). */
export function subjectChoices(subjects: readonly Subject[], offerings: readonly Offering[], sectionKey: string): { value: string; label: string }[] {
  const taken = new Set(offerings.map((o) => o.subject.id));
  return subjects.filter((s) => !s.archived && !taken.has(s.id) && s.sectionKey === sectionKey).map((s) => ({ value: s.id, label: s.code ? `${s.name} (${s.code})` : s.name }));
}

/**
 * A receipt code suggested from a section's name (D-102), the same as the server makes when none is given: the
 * initials of its words (a run of digits kept whole), or the first four letters of a one-word name. "Master's Degrees"
 * gives MD, "Bachelor's" BACH. Only a suggestion: the Principal may type another.
 */
export function suggestReceiptCode(name: string): string {
  const words = name.replace(/\([^)]*\)/g, " ").replace(/\+/g, " P").replace(/['’]/g, "").toUpperCase().match(/[A-Z]+|[0-9]+/g) ?? [];
  const initials = words.map((w) => (/^[0-9]/.test(w) ? w : w[0])).join("");
  const code = initials.length >= 2 ? initials : words.join("").slice(0, 4);
  return name.trim() === "" ? "" : (code.length >= 2 ? code : `${code}SEC`).slice(0, 6);
}

/** 2 to 6 letters or digits (D-102); the server stores it in capitals. */
export const isReceiptCode = (code: string): boolean => /^[A-Za-z0-9]{2,6}$/.test(code.trim());
