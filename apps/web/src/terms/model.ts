import type { components } from "@/api/schema";
import { formatBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";

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

// --- The redesigned page (PM, 2026-10-06): Currently Active, then Other Terms ------------------------------------------

/** The wings a term's levels belong to, by name, once each, in level order. Pure. */
export function termWings(term: Pick<Term, "levels">, sections: readonly { key: string; name: string }[]): string[] {
  const keys = [...new Set(term.levels.map((l) => l.sectionKey))];
  return keys.map((key) => sections.find((s) => s.key === key)?.name ?? key);
}

/** The first `max` levels as "Course · Level" chips, and how many more there are. Pure. */
export function levelChips(term: Pick<Term, "levels">, max = 3): { chips: string[]; more: number } {
  const all = term.levels.map((l) => t("terms.chip", { course: l.programmeName, level: l.name }));
  return { chips: all.slice(0, max), more: Math.max(0, all.length - max) };
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
/** "5 months" or "12 days": whole months from 30 days on, else days. */
const span = (days: number) => (days >= 30 ? t(Math.round(days / 30) === 1 ? "terms.time.month" : "terms.time.months", { n: Math.round(days / 30) }) : t(days === 1 ? "terms.time.day" : "terms.time.days", { n: days }));

/** Where a term stands in time, in words, from today's AD day "YYYY-MM-DD" (Nepal's day). Pure. */
export function termTiming(term: Pick<Term, "status" | "startDate" | "endDate">, today: string): string {
  const untilStart = daysBetween(today, term.startDate);
  const untilEnd = daysBetween(today, term.endDate);
  if (term.status === "closed") return untilEnd < 0 ? t("terms.time.ended", { span: span(-untilEnd) }) : t("terms.time.closedEarly");
  if (untilStart > 0) return t("terms.time.startsIn", { span: span(untilStart) });
  if (term.status === "draft") return t("terms.time.notOpened");
  if (untilEnd < 0) return t("terms.time.pastEnd");
  return untilEnd === 0 ? t("terms.time.endsToday") : t("terms.time.remaining", { span: span(untilEnd) });
}

export type OtherStatus = "" | "draft" | "closed";

/** Other Terms: every term not active (the PM: "all the terms which are not active"), by status and search. Pure. */
export function otherTerms(terms: readonly Term[], q: string, status: OtherStatus): Term[] {
  const words = q.trim().toLowerCase();
  return terms.filter(
    (x) =>
      x.status !== "active" &&
      (!status || x.status === status) &&
      (!words || [x.label, x.code, ...x.levels.map((l) => `${l.programmeName} ${l.name}`)].some((text) => text.toLowerCase().includes(words))),
  );
}
