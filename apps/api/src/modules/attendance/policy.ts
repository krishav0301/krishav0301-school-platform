/**
 * The attendance rules a school may one day set for itself (an extension point, "attendance rules", CLAUDE.md
 * section 2). Seam before builder: one default now, no settings screen until a second school needs one.
 */

/** OPEN: the alert threshold. 75% is the stated placeholder (CLAUDE.md section 9) until the client confirms. */
export const ATTENDANCE_ALERT_THRESHOLD = 75;

/**
 * A day on which this share of a group (all students, or all teachers) has no Present mark is a holiday for that group
 * (the PM, 2026-10-17, D-176): nobody is marked Absent, and the few who did tap keep their Present.
 */
export const HOLIDAY_ABSENT_PERCENT = 98;

/** OPEN: when the day closes and the people with no mark are marked Absent (Nepal time, 24-hour). 18:00 is a placeholder until the school gives its hours. */
export const DAY_CLOSES_AT = "18:00";

/** Whether `present` of `expected` makes the day a holiday for the group. Whole numbers only, so 98 of 100 absent is exactly on the line. An empty group is never a holiday: there is nobody to mark. */
export function isHolidayFor(expected: number, present: number, percent = HOLIDAY_ABSENT_PERCENT): boolean {
  return expected > 0 && (expected - present) * 100 >= percent * expected;
}

/** Present days over marked days, rounded down to a whole percent. No marked days: no percentage, not 0% or 100%. */
export function attendancePercent(present: number, marked: number): number | null {
  if (marked <= 0) return null;
  return Math.floor((present * 100) / marked);
}

/** Below the threshold (never exactly at it). A student with nothing marked yet is not flagged. */
export function belowThreshold(percent: number | null, threshold = ATTENDANCE_ALERT_THRESHOLD): boolean {
  return percent !== null && percent < threshold;
}
