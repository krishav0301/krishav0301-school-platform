import { CalendarCheck, CalendarClock, CalendarDays, Users } from "lucide-react";

import type { components } from "@/api/schema";
import { formatBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import type { Figure } from "@/read/ReadView";

/**
 * Academic terms (D-109, D-110): any period the Principal sets, with its dates and the levels it runs. The API still
 * says "year"; the screens say "term".
 */
export type Term = components["schemas"]["AcademicYear"];
export type TermLevel = components["schemas"]["TermLevel"];
export type NextTerm = components["schemas"]["NextTerm"];
export type CloseCheck = components["schemas"]["TermCloseCheck"];
export type Programme = components["schemas"]["Programme"];

export const TERM_STATUS: Record<Term["status"], { key: MessageKey; tone: "neutral" | "ok" | "warn" }> = {
  draft: { key: "terms.status.draft", tone: "warn" },
  active: { key: "terms.status.active", tone: "ok" },
  closed: { key: "terms.status.closed", tone: "neutral" },
};

/** "1 Shrawan 2082 – 30 Poush 2082", in BS; the AD day when a day is outside the verified calendar. */
export const termDates = (term: Pick<Term, "startDate" | "endDate" | "startDateBs" | "endDateBs">): string =>
  t("terms.dates", { from: term.startDateBs ? formatBsDate(term.startDateBs) : term.startDate, until: term.endDateBs ? formatBsDate(term.endDateBs) : term.endDate });

/** "BCA: Semester 1, Semester 3 · Science: Grade 11", programme by programme, in the order the API gives. */
export function levelSummary(levels: readonly Pick<TermLevel, "programmeName" | "name">[]): string {
  if (levels.length === 0) return t("terms.noLevels");
  const byProgramme = new Map<string, string[]>();
  for (const l of levels) (byProgramme.get(l.programmeName) ?? byProgramme.set(l.programmeName, []).get(l.programmeName)!).push(l.name);
  return [...byProgramme].map(([programme, names]) => t("terms.levelsOf", { programme, levels: names.join(", ") })).join(" · ");
}

/** The page's four figures: open terms, terms not started, students in open terms, closed terms. Pure. */
export function termFigures(terms: readonly Term[]): Figure[] {
  const open = terms.filter((x) => x.status === "active");
  return [
    { key: "open", icon: CalendarCheck, tone: "ok", value: String(open.length), label: t("terms.figure.open") },
    { key: "draft", icon: CalendarClock, tone: "warn", value: String(terms.filter((x) => x.status === "draft").length), label: t("terms.figure.draft") },
    { key: "students", icon: Users, tone: "accent", value: String(open.reduce((n, x) => n + x.students, 0)), label: t("terms.figure.students") },
    { key: "closed", icon: CalendarDays, tone: "accent", value: String(terms.filter((x) => x.status === "closed").length), label: t("terms.figure.closed") },
  ];
}

/** Which open term (other than `except`) already runs each level: a level is in only one open term (D-110). */
export function levelsTaken(terms: readonly Term[], except: string | null): Map<string, string> {
  const taken = new Map<string, string>();
  for (const term of terms) if (term.status !== "closed" && term.id !== except) for (const l of term.levels) taken.set(l.id, term.label);
  return taken;
}

/** The odd-numbered levels of a programme (Semester 1, 3, 5 ...): the shortcut for an odd semester. */
export const oddLevels = (programme: Pick<Programme, "levels">): string[] => programme.levels.filter((l) => l.active && l.ordinal % 2 === 1).map((l) => l.id);

export interface TermFormValues {
  label: string;
  code: string;
  startBs: string;
  endBs: string;
  levelIds: string[];
}
export const emptyTermForm = (): TermFormValues => ({ label: "", code: "", startBs: "", endBs: "", levelIds: [] });
export type TermFormErrors = Partial<Record<keyof TermFormValues, MessageKey>>;

/** The checks that need no server. Whether a Nepali day exists, and whether its year is verified, is the server's to say. */
export function validateTermForm(values: TermFormValues): TermFormErrors {
  const errors: TermFormErrors = {};
  if (!values.label.trim()) errors.label = "terms.error.name";
  if (values.code.trim() && !/^[A-Za-z0-9]{2,10}$/.test(values.code.trim())) errors.code = "terms.error.code";
  if (!values.startBs.trim()) errors.startBs = "terms.error.start";
  if (!values.endBs.trim()) errors.endBs = "terms.error.end";
  return errors;
}

/**
 * A term's length in whole months from its BS days "YYYY-MM-DD" (D-114): the same count the server makes, so the form
 * offers what the server will accept. Null until both days are whole and the end comes after the start.
 */
export function termMonthsBs(startBs: string, endBs: string): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/;
  const s = day.exec(startBs.trim());
  const e = day.exec(endBs.trim());
  if (!s || !e) return null;
  const [sy, sm, sd] = [Number(s[1]), Number(s[2]), Number(s[3])];
  const [ey, em, ed] = [Number(e[1]), Number(e[2]), Number(e[3])];
  if (ey * 10000 + em * 100 + ed <= sy * 10000 + sm * 100 + sd) return null;
  return Math.round(ey * 12 + em - (sy * 12 + sm) + (ed - sd + 1) / 30);
}

export type LevelOffer = "ok" | "taken" | "noLength" | "otherLength" | "noDays";

/** Whether a level may be added to a term of `months` (D-114): free (D-110), with a length, and of the term's length. */
export function levelOffer(level: { id: string; usualMonths: number | null }, months: number | null, taken: ReadonlyMap<string, string>): LevelOffer {
  if (taken.has(level.id)) return "taken";
  if (months === null) return "noDays";
  if (level.usualMonths === null) return "noLength";
  return level.usualMonths === months ? "ok" : "otherLength";
}

/** An open term's levels whose length is not set or no longer matches the term's (D-114): flagged, never dropped. */
export const misfitLevels = (term: Pick<Term, "status" | "months" | "levels">): TermLevel[] =>
  term.status === "closed" || term.months === null ? [] : term.levels.filter((l) => l.usualMonths !== term.months);
