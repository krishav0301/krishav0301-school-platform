/**
 * The one place that converts between AD and BS (D-014). No screen or module converts dates itself.
 *
 * Conversion is done by `@inicrea/bikram-sambat-core`, pinned to an exact version. This module
 * adds three things the library does not:
 *  1. A verified-years gate. Only BS 2000 to 2083 convert. Beyond 2083 no official calendar
 *     exists yet, and libraries disagree, so we refuse rather than guess.
 *  2. A disputed-window flag for the one stretch where public sources disagree.
 *  3. Nepal time. A day starts at Nepal midnight (18:15 UTC), never the server's midnight.
 *
 * `test/fixtures/bs-golden.json` holds every month length for the verified years, and a test
 * fails if a library upgrade changes any answer.
 */
import * as bikram from "@inicrea/bikram-sambat-core";

export interface BsDate {
  year: number;
  month: number; // 1 = Baisakh ... 12 = Chaitra
  day: number;
}

/** BS years whose calendar has been checked. Extend only after checking the official calendar. */
export const VERIFIED_BS_YEARS = { from: 2000, to: 2083 } as const;

export const BS_MONTH_NAMES = [
  "Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
] as const;

/**
 * Stretches where public calendars disagree. Conversions here are flagged so the screen can ask
 * for confirmation against the certificate. Hamro Patro and ashesh.com.np agree with this
 * module; englishnepalidate.com and seven npm libraries place the Baisakh/Jestha boundary a day
 * earlier. See docs/spikes/bs-dates.md.
 */
const DISPUTED_WINDOWS: readonly { from: BsDate; to: BsDate }[] = [
  { from: { year: 2062, month: 1, day: 31 }, to: { year: 2062, month: 2, day: 31 } },
];

export class UnverifiedCalendarYearError extends Error {
  constructor(detail: string) {
    super(
      `Calendar data for ${detail} has not been verified. Only BS ${VERIFIED_BS_YEARS.from} to ` +
        `${VERIFIED_BS_YEARS.to} can be converted.`,
    );
    this.name = "UnverifiedCalendarYearError";
  }
}

export class InvalidBsDateError extends Error {
  constructor(detail: string) {
    super(`Invalid BS date: ${detail}`);
    this.name = "InvalidBsDateError";
  }
}

export class InvalidAdDateError extends Error {
  constructor(detail: string) {
    super(`Invalid AD date: ${detail}`);
    this.name = "InvalidAdDateError";
  }
}

export function isVerifiedBsYear(year: number): boolean {
  return Number.isInteger(year) && year >= VERIFIED_BS_YEARS.from && year <= VERIFIED_BS_YEARS.to;
}

function assertVerifiedYear(year: number): void {
  if (!isVerifiedBsYear(year)) throw new UnverifiedCalendarYearError(`BS ${year}`);
}

const AD_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" and rejects impossible dates such as 2026-02-30. */
function parseAdIso(text: string): { year: number; month: number; day: number } {
  const match = AD_ISO.exec(text);
  if (!match) throw new InvalidAdDateError(`"${text}" is not YYYY-MM-DD`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new InvalidAdDateError(`"${text}" does not exist`);
  }
  return { year, month, day };
}

function assertShape(bs: BsDate): void {
  if (!Number.isInteger(bs.year) || !Number.isInteger(bs.month) || !Number.isInteger(bs.day)) {
    throw new InvalidBsDateError("year, month and day must be whole numbers");
  }
  if (bs.month < 1 || bs.month > 12) throw new InvalidBsDateError(`month ${bs.month} is not 1 to 12`);
}

export function daysInMonth(year: number, month: number): number {
  assertVerifiedYear(year);
  assertShape({ year, month, day: 1 });
  return bikram.daysInBsMonth(year, month);
}

/** AD "YYYY-MM-DD" to BS. */
export function adToBs(ad: string): BsDate {
  parseAdIso(ad);
  let bs: BsDate;
  try {
    bs = bikram.adToBs(ad);
  } catch (error) {
    if (error instanceof bikram.BikramRangeError) throw new UnverifiedCalendarYearError(`AD ${ad}`);
    throw error;
  }
  assertVerifiedYear(bs.year);
  return { year: bs.year, month: bs.month, day: bs.day };
}

/** BS to AD "YYYY-MM-DD". */
export function bsToAd(bs: BsDate): string {
  assertShape(bs);
  assertVerifiedYear(bs.year);
  const length = bikram.daysInBsMonth(bs.year, bs.month);
  if (bs.day < 1 || bs.day > length) {
    throw new InvalidBsDateError(`${bs.year}-${bs.month} has ${length} days, not day ${bs.day}`);
  }
  return bikram.bsToAdIso(bs);
}

/** 0 = Sunday ... 6 = Saturday. Taken from the AD date, so it does not depend on the library. */
export function weekday(bs: BsDate): number {
  const { year, month, day } = parseAdIso(bsToAd(bs));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Saturday is Nepal's weekly holiday. The working week is Sunday to Friday. */
export function isWeeklyHoliday(bs: BsDate): boolean {
  return weekday(bs) === 6;
}

export function formatBs(bs: BsDate): string {
  assertShape(bs);
  return `${bs.day} ${BS_MONTH_NAMES[bs.month - 1]} ${bs.year}`;
}

const compare = (a: BsDate, b: BsDate): number =>
  a.year - b.year || a.month - b.month || a.day - b.day;

/** "disputed" means public sources disagree on this day. Ask the user to confirm it. */
export function conversionConfidence(bs: BsDate): "verified" | "disputed" {
  return DISPUTED_WINDOWS.some((w) => compare(bs, w.from) >= 0 && compare(bs, w.to) <= 0)
    ? "disputed"
    : "verified";
}

const NEPAL_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kathmandu",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in Nepal (UTC+5:45) at an instant, as AD "YYYY-MM-DD". */
export function nepalDate(instant: Date): string {
  return NEPAL_DAY.format(instant);
}

/** Today in BS, by Nepal's clock. Pass `now` in tests. */
export function todayBs(now: Date = new Date()): BsDate {
  return adToBs(nepalDate(now));
}
