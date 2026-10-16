import type { components } from "@/api/schema";
import { t } from "@/i18n/messages";

export type PublishedResults = components["schemas"]["PublishedResults"];
export type PublishedRow = PublishedResults["results"][number];

/**
 * What the filter bar has chosen. An empty string is "all" for wing, department and level; the exam is always one (an
 * exam's figures are never mixed with another's, nor with a final result's).
 */
export interface InsightFilters {
  exam: string;
  wing: string;
  department: string;
  level: string;
}

export const NO_FILTERS: InsightFilters = { exam: "", wing: "", department: "", level: "" };
export const FINAL_KEY = "final";

/** An exam's name keeps one filter entry across terms; every final result is one entry. */
export const examKey = (r: PublishedRow): string => (r.terminal ? `exam:${r.terminal.name}` : FINAL_KEY);
export const examLabel = (r: PublishedRow): string => (r.terminal ? r.terminal.name : t("results.sheets.final"));
/** The id the class sheet takes for this result: the exam's id, or "final". */
export const sheetTerminal = (r: PublishedRow): string => r.terminal?.id ?? FINAL_KEY;

const unique = <T>(items: T[], key: (item: T) => string): T[] => items.filter((item, i) => items.findIndex((other) => key(other) === key(item)) === i);
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The exam the page opens on: the one published most recently. */
export const defaultExam = (rows: readonly PublishedRow[]): string => (rows[0] ? examKey(rows[0]) : "");
export const startFilters = (rows: readonly PublishedRow[]): InsightFilters => ({ ...NO_FILTERS, exam: defaultExam(rows) });

const matchesUpTo = (r: PublishedRow, f: InsightFilters, upTo: "exam" | "wing" | "department" | "level"): boolean =>
  (!f.exam || examKey(r) === f.exam) &&
  (upTo === "exam" || !f.wing || r.wing === f.wing) &&
  (upTo === "exam" || upTo === "wing" || !f.department || r.programmeName === f.department) &&
  (upTo !== "level" || !f.level || r.levelName === f.level);

/** What each picker offers: every exam; the wings that have that exam; then the departments of the wing; then its levels. */
export function filterOptions(rows: readonly PublishedRow[], f: InsightFilters) {
  const pick = (upTo: Parameters<typeof matchesUpTo>[2], value: (r: PublishedRow) => string) =>
    unique(rows.filter((r) => matchesUpTo(r, f, upTo)), value)
      .map((r) => ({ value: value(r), label: value(r) }))
      .sort((a, b) => byName(a.label, b.label));
  return {
    exams: unique([...rows], examKey).map((r) => ({ value: examKey(r), label: examLabel(r) })),
    wings: pick("exam", (r) => r.wing),
    departments: pick("wing", (r) => r.programmeName),
    levels: pick("department", (r) => r.levelName),
  };
}

/** The results that pass every filter that is set. */
export const applyFilters = (rows: readonly PublishedRow[], f: InsightFilters): PublishedRow[] => rows.filter((r) => matchesUpTo(r, f, "level"));

export interface Summary {
  published: number;
  students: number;
  /** In whole hundredths of a percent, weighted by marks cards; null with none. */
  avgPercentHundredths: number | null;
  /** Whole percent of students who passed, over the final results only (an exam is for information, D-117); null with none. */
  passPercent: number | null;
  bands: number[];
}

export function summarise(rows: readonly PublishedRow[]): Summary {
  const students = rows.reduce((n, r) => n + r.cards, 0);
  const weighted = rows.reduce((n, r) => n + (r.avgPercentHundredths ?? 0) * r.cards, 0);
  const finals = rows.filter((r) => r.terminal === null && r.passed !== null);
  const finalCards = finals.reduce((n, r) => n + r.cards, 0);
  const bands = [0, 0, 0, 0];
  for (const r of rows) r.bands.forEach((n, i) => (bands[i] = (bands[i] ?? 0) + n));
  return {
    published: rows.length,
    students,
    avgPercentHundredths: students > 0 ? Math.round(weighted / students) : null,
    passPercent: finalCards > 0 ? Math.floor((finals.reduce((n, r) => n + (r.passed ?? 0), 0) * 100) / finalCards) : null,
    bands,
  };
}

export interface Bar {
  key: string;
  label: string;
  /** Whole hundredths of a percent. */
  value: number;
}

/** Each subject's average over the results given, weighted by marks cards, best first. Meaningful within one level, which shares its subjects. */
export function subjectBars(rows: readonly PublishedRow[]): Bar[] {
  const sums = new Map<string, { total: number; cards: number }>();
  for (const r of rows) {
    for (const s of r.subjects) {
      const now = sums.get(s.name) ?? { total: 0, cards: 0 };
      sums.set(s.name, { total: now.total + s.avgPercentHundredths * r.cards, cards: now.cards + r.cards });
    }
  }
  return [...sums.entries()].map(([name, v]) => ({ key: name, label: name, value: Math.round(v.total / v.cards) })).sort((a, b) => b.value - a.value);
}

export interface LevelGroup {
  name: string;
  /** Its classes (sections), by name. */
  classes: PublishedRow[];
  summary: Summary;
  subjects: Bar[];
}
export interface DepartmentGroup {
  name: string;
  levels: LevelGroup[];
  summary: Summary;
}
export interface WingGroup {
  name: string;
  departments: DepartmentGroup[];
}

/**
 * The results grouped the way the school is: wing, then department, then level, then class (the PM, 2026-10-17: a level
 * is what is checked together, because its classes share their subjects). Names sort naturally ("Grade 2" before "Grade 10"). Pure.
 */
export function groupInsights(rows: readonly PublishedRow[]): WingGroup[] {
  const sorted = [...rows].sort((a, b) => byName(a.wing, b.wing) || byName(a.programmeName, b.programmeName) || byName(a.levelName, b.levelName) || byName(a.label, b.label));
  const wings: WingGroup[] = [];
  for (const r of sorted) {
    let wing = wings.find((w) => w.name === r.wing);
    if (!wing) wings.push((wing = { name: r.wing, departments: [] }));
    let dept = wing.departments.find((d) => d.name === r.programmeName);
    if (!dept) wing.departments.push((dept = { name: r.programmeName, levels: [], summary: summarise([]) }));
    let level = dept.levels.find((l) => l.name === r.levelName);
    if (!level) dept.levels.push((level = { name: r.levelName, classes: [], summary: summarise([]), subjects: [] }));
    level.classes.push(r);
  }
  for (const w of wings) {
    for (const d of w.departments) {
      for (const l of d.levels) {
        l.summary = summarise(l.classes);
        l.subjects = subjectBars(l.classes);
      }
      d.summary = summarise(d.levels.flatMap((l) => l.classes));
    }
  }
  return wings;
}

/** The tone a score is drawn in: the theme's status colours, so a low score is never mistaken for a good one. */
export const scoreTone = (hundredths: number): "ok" | "primary" | "warn" | "bad" => (hundredths >= 8000 ? "ok" : hundredths >= 6000 ? "primary" : hundredths >= 4000 ? "warn" : "bad");

/** 8650 -> "86.5%". */
export const shortPercent = (hundredths: number): string => `${(hundredths / 100).toFixed(1).replace(/\.0$/, "")}%`;
