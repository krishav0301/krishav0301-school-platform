import type { MessageKey } from "@/i18n/messages";

/**
 * Sorting a list of students on the screen (PM, 2026-11-17). Done in the browser: the lists are a class or a school, well
 * under 2,000 rows, so it costs no database round trip. Letters compare with `localeCompare` and `numeric`, so "Grade 2"
 * comes before "Grade 10". A student with no roll number, rank or marks goes last. Ties fall back to name, then SID, so
 * the order is the same every time.
 */
export type StudentSort = "roll" | "name" | "nameDesc" | "sid" | "rank" | "marksDesc" | "marksAsc" | "server";

export type Sortable = {
  name: string;
  sid?: string | null;
  rollNo?: number | null;
  rank?: number | null;
  /** Marks as one number (a percentage or a total); no value goes last either way. */
  marks?: number | null;
};

export const SORT_LABELS: Record<StudentSort, MessageKey> = {
  roll: "sort.roll",
  name: "sort.name",
  nameDesc: "sort.nameDesc",
  sid: "sort.sid",
  rank: "sort.rank",
  server: "sort.server",
  marksDesc: "sort.marksDesc",
  marksAsc: "sort.marksAsc",
};

const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
/** Smaller first; no value last. */
const nullsLast = (a: number | null | undefined, b: number | null | undefined) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);

export function sortStudents<T extends Sortable>(rows: readonly T[], sort: StudentSort): T[] {
  const byName = (a: T, b: T) => text(a.name, b.name) || text(a.sid ?? "", b.sid ?? "");
  const compare: Record<StudentSort, (a: T, b: T) => number> = {
    server: () => 0,
    roll: (a, b) => nullsLast(a.rollNo, b.rollNo) || byName(a, b),
    rank: (a, b) => nullsLast(a.rank, b.rank) || byName(a, b),
    marksAsc: (a, b) => nullsLast(a.marks, b.marks) || byName(a, b),
    marksDesc: (a, b) => nullsLast(a.marks == null ? null : -a.marks, b.marks == null ? null : -b.marks) || byName(a, b),
    sid: (a, b) => text(a.sid ?? "", b.sid ?? "") || text(a.name, b.name),
    nameDesc: (a, b) => -text(a.name, b.name) || text(a.sid ?? "", b.sid ?? ""),
    name: byName,
  };
  return [...rows].sort(compare[sort]);
}
