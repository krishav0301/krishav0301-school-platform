import { adToBs, bsToAd } from "../../core/dates";

/**
 * The billing-schedule policy (an extension point, CLAUDE.md section 2: "fee billing schedule"). Seam before builder:
 * one default now. It turns a fee item into the charges a student owes for a year: each a billing period and the AD
 * day it falls due. The period is part of the charge's identity, so a charge is never made twice.
 *
 * OPEN: the client's real schedule and what "course-wise" means (build plan, Phase 6 needs). Defaults:
 *  - one-time and yearly: one charge, due on the year's first day;
 *  - monthly: one charge per BS month of the year, due on its first day, from the month the student enrolled in on
 *    (a student admitted mid-year is not billed for months before they joined);
 *  - whole course: one charge, only in the student's first year of the programme.
 */

export type Frequency = "one_time" | "monthly" | "yearly" | "whole_course";

export interface BillingYear {
  bsYear: number;
  /** The year's first day, AD. */
  startDate: string;
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
      const fromMonth = joined && joined.year === year.bsYear ? joined.month : 1;
      const months: { period: string; dueOn: string }[] = [];
      for (let month = fromMonth; month <= 12; month++) {
        months.push({ period: `${year.bsYear}-${String(month).padStart(2, "0")}`, dueOn: bsToAd({ year: year.bsYear, month, day: 1 }) });
      }
      return months;
    }
  }
}

/** One item's yearly total, for the structure's summary: twelve months, or once. */
export const yearlyAmount = (item: { frequency: Frequency; amountPaisa: number }): number => (item.frequency === "monthly" ? item.amountPaisa * 12 : item.amountPaisa);
