import type { components } from "@/api/schema";
import { t, type MessageKey } from "@/i18n/messages";

export type MyMarkSheets = components["schemas"]["MyMarkSheets"];
export type MarkSheet = components["schemas"]["MarkSheet"];
export type ReviewBoard = components["schemas"]["ReviewBoard"];
export type OwnResults = components["schemas"]["OwnResults"];
export type MarksCard = components["schemas"]["MarksCard"];
export type Top20 = components["schemas"]["Top20"];
export type ClassSheet = components["schemas"]["ClassResultSheet"];
export type RecheckList = components["schemas"]["RecheckList"];
export type ClassElectives = components["schemas"]["ClassElectives"];
export type SheetStatus = MarkSheet["status"];
export type CardBody = MarksCard["body"];
export type TerminalCard = Extract<CardBody, { kind: "terminal" }>;
export type FinalCard = Extract<CardBody, { kind: "final" }>;
export type Part = MarkSheet["components"][number]["id"];

export const STATUS_LABEL: Record<SheetStatus, MessageKey> = {
  not_started: "results.status.notStarted",
  draft: "results.status.draft",
  under_review: "results.status.underReview",
  verified: "results.status.verified",
  published: "results.status.published",
};

export const RECHECK_LABEL: Record<RecheckList["rechecks"][number]["status"], MessageKey> = {
  open: "results.recheck.open",
  changed: "results.recheck.changed",
  unchanged: "results.recheck.unchanged",
};

/** A mark in whole hundredths, written the short way: 62.5, 70, 0.25. */
export function formatMarks(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const part = Math.abs(hundredths % 100);
  if (part === 0) return String(whole);
  return `${whole}.${String(part).padStart(2, "0").replace(/0$/, "")}`;
}

/** What a teacher typed into a mark box: a number with up to two decimals, "AB" for absent, or blank. Null when it is not a mark. */
export function parseMark(text: string): { valueHundredths: number | null; absent: boolean } | null {
  const trimmed = text.trim();
  if (trimmed === "") return { valueHundredths: null, absent: false };
  if (/^ab$/i.test(trimmed)) return { valueHundredths: null, absent: true };
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  return {
    valueHundredths: Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0")),
    absent: false,
  };
}

/** A mark as it sits in a box: blank, "AB", or the number. */
export const markText = (mark: { valueHundredths: number | null; absent: boolean }): string => (mark.absent ? "AB" : mark.valueHundredths === null ? "" : formatMarks(mark.valueHundredths));

/** 382 -> "3.82"; 8650 -> "86.50". */
export const hundredthsText = (n: number): string => `${Math.trunc(n / 100)}.${String(Math.abs(n % 100)).padStart(2, "0")}`;

/** A percentage in whole hundredths: 8650 -> "86.50%". */
export const percentText = (n: number): string => `${hundredthsText(n)}%`;

/** The headline of a result (D-117): its percentage. */
export const scoreText = (r: { percentHundredths: number }): string => percentText(r.percentHundredths);

export const className = (c: { programmeName: string; levelName: string; label: string }): string => [c.programmeName, c.levelName, c.label].filter(Boolean).join(" · ");

/** A part of a paper in the school's words: Theory or Practical (D-117). */
export const partName = (part: Part): string => t(part === "practical" ? "results.card.practical" : "results.card.theory");
