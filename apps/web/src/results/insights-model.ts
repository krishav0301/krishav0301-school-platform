import type { components } from "@/api/schema";
import { t } from "@/i18n/messages";

import { className } from "./model";

export type PublishedResults = components["schemas"]["PublishedResults"];
export type PublishedRow = PublishedResults["results"][number];

/** What the filter bar has chosen; an empty string is "all". `exam` is an exam's name, or `FINAL_KEY` for final results. */
export interface InsightFilters {
  exam: string;
  department: string;
  classId: string;
}

export const NO_FILTERS: InsightFilters = { exam: "", department: "", classId: "" };
export const FINAL_KEY = "final";

/** An exam's name keeps one filter entry across terms; every final result is one entry. */
export const examKey = (r: PublishedRow): string => (r.terminal ? `exam:${r.terminal.name}` : FINAL_KEY);
export const examLabel = (r: PublishedRow): string => (r.terminal ? r.terminal.name : t("results.sheets.final"));
export const classLabel = (r: PublishedRow): string => className(r);

const unique = <T>(items: T[], key: (item: T) => string): T[] => items.filter((item, i) => items.findIndex((other) => key(other) === key(item)) === i);

/** What each picker offers, from the published results (so nothing can be chosen that has no result). */
export function filterOptions(rows: readonly PublishedRow[]) {
  return {
    exams: unique([...rows], examKey).map((r) => ({ value: examKey(r), label: examLabel(r) })),
    departments: unique([...rows], (r) => r.programmeName).map((r) => ({ value: r.programmeName, label: r.programmeName })),
    classes: unique([...rows], (r) => r.classId).map((r) => ({ value: r.classId, label: classLabel(r) })),
  };
}

/** The results that pass every filter that is set. */
export const applyFilters = (rows: readonly PublishedRow[], f: InsightFilters): PublishedRow[] =>
  rows.filter((r) => (!f.exam || examKey(r) === f.exam) && (!f.department || r.programmeName === f.department) && (!f.classId || r.classId === f.classId));

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

/** Each class's average, best first. With several exams in view, the exam is named too. */
export function classBars(rows: readonly PublishedRow[]): Bar[] {
  const many = new Set(rows.map(examKey)).size > 1;
  return rows
    .filter((r) => r.avgPercentHundredths !== null)
    .map((r) => ({ key: `${r.classId}/${examKey(r)}`, label: many ? `${classLabel(r)} · ${examLabel(r)}` : classLabel(r), value: r.avgPercentHundredths! }))
    .sort((a, b) => b.value - a.value);
}

/** Each subject's average over the results in view, weighted by marks cards, best first. */
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

/** The tone a score is drawn in: the theme's status colours, so a low score is never mistaken for a good one. */
export const scoreTone = (hundredths: number): "ok" | "primary" | "warn" | "bad" => (hundredths >= 8000 ? "ok" : hundredths >= 6000 ? "primary" : hundredths >= 4000 ? "warn" : "bad");

/** 8650 -> "86.5%". */
export const shortPercent = (hundredths: number): string => `${(hundredths / 100).toFixed(1).replace(/\.0$/, "")}%`;
