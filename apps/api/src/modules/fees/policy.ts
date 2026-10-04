import { adToBs, bsToAd } from "../../core/dates";

/**
 * The billing-schedule policy (an extension point, CLAUDE.md section 2: "fee billing schedule"). Seam before builder:
 * one default now. It turns a fee item into the charges a student owes for a year: each a billing period and the AD
 * day it falls due. The period is part of the charge's identity, so a charge is never made twice.
 *
 * OPEN: the client's real schedule and what "course-wise" means (build plan, Phase 6 needs). Defaults:
 *  - one-time and yearly ("once a term" since D-110): one charge, due on the term's first day;
 *  - monthly: one charge per BS month the term spans, due on its first day (or the term's first day, if later), from
 *    the month the student enrolled in on (a student admitted mid-term is not billed for months before they joined);
 *  - whole course: one charge, only in the student's first year of the programme.
 */

export type Frequency = "one_time" | "monthly" | "yearly" | "whole_course";

export interface BillingYear {
  bsYear: number;
  /** The term's first day, AD. */
  startDate: string;
  /**
   * The term's last day, AD (D-110: a term can be any length). Without it, monthly billing covers the twelve months of
   * `bsYear`, as before terms.
   */
  endDate?: string;
}

/** The BS months a term spans, as [year, month] pairs, first to last. */
export function termMonths(startDate: string, endDate: string): [number, number][] {
  const start = adToBs(startDate);
  const end = adToBs(endDate);
  const months: [number, number][] = [];
  for (let index = start.year * 12 + start.month - 1; index <= end.year * 12 + end.month - 1; index++) months.push([Math.floor(index / 12), (index % 12) + 1]);
  return months;
}

export interface BillingStudent {
  /** The AD day the student's enrollment began (their admission day, or the year's first day, whichever is later). */
  enrolledOn: string;
  /** No earlier enrollment in the same programme. */
  firstInProgramme: boolean;
}

export function billingSchedule(item: { frequency: Frequency }, year: BillingYear, student: BillingStudent): { period: string; dueOn: string }[] {
  switch (item.frequency) {
    case "one_time":
      return [{ period: "once", dueOn: year.startDate }];
    case "yearly":
      return [{ period: "year", dueOn: year.startDate }];
    case "whole_course":
      return student.firstInProgramme ? [{ period: "course", dueOn: year.startDate }] : [];
    case "monthly": {
      const joined = student.enrolledOn > year.startDate ? adToBs(student.enrolledOn) : null;
      const span: [number, number][] = year.endDate ? termMonths(year.startDate, year.endDate) : Array.from({ length: 12 }, (_, i): [number, number] => [year.bsYear, i + 1]);
      const months: { period: string; dueOn: string }[] = [];
      for (const [y, month] of span) {
        if (joined && y * 12 + month < joined.year * 12 + joined.month) continue;
        const first = bsToAd({ year: y, month, day: 1 });
        months.push({ period: `${y}-${String(month).padStart(2, "0")}`, dueOn: first < year.startDate ? year.startDate : first });
      }
      return months;
    }
  }
}

/** One item's total for the term, for the structure's summary: once per month the term spans (twelve by default), or once. */
export const yearlyAmount = (item: { frequency: Frequency; amountPaisa: number }, months = 12): number => (item.frequency === "monthly" ? item.amountPaisa * months : item.amountPaisa);
