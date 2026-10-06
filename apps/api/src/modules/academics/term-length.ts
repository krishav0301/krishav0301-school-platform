import { adToBs } from "../../core/dates";

/**
 * A term's length in whole months, on the BS calendar (D-114): the months from the start to the end, plus the days left
 * over as a fraction of 30, rounded. So Shrawan 1 to the last day of Poush is 6, and a term a few days short of 6 months
 * still counts as 6. A term accepts a level only if this equals the level's `usual_months`. Throws, as `adToBs` does,
 * for a day outside the verified calendar.
 */
export function termLengthMonths(startDate: string, endDate: string): number {
  const s = adToBs(startDate);
  const e = adToBs(endDate);
  return Math.round(e.year * 12 + e.month - (s.year * 12 + s.month) + (e.day - s.day + 1) / 30);
}

/** The words for a level that does not fit a term, or null when it does. */
export function lengthProblem(level: { name: string; usual_months: number | null }, termMonths: number): string | null {
  if (level.usual_months === null) return `Set the length of ${level.name} first, on the Academic Structure page`;
  if (level.usual_months !== termMonths) return `${level.name} runs ${months(level.usual_months)}, but this term is ${months(termMonths)}`;
  return null;
}

const months = (n: number) => (n === 1 ? "1 month" : `${n} months`);
