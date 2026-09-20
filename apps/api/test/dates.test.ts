import { describe, expect, it } from "vitest";

import {
  BS_MONTH_NAMES,
  InvalidBsDateError,
  UnverifiedCalendarYearError,
  VERIFIED_BS_YEARS,
  adToBs,
  bsToAd,
  conversionConfidence,
  daysInMonth,
  formatBs,
  isWeeklyHoliday,
  nepalDate,
  todayBs,
  weekday,
} from "../src/core/dates";
import golden from "./fixtures/bs-golden.json";

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

describe("golden calendar, BS 2000 to 2083", () => {
  it("the verified range is exactly what the golden data covers", () => {
    expect(VERIFIED_BS_YEARS).toEqual({ from: golden.years[0]!.year, to: golden.years.at(-1)!.year });
  });

  it("every year starts on the golden AD date and has the golden month lengths", () => {
    for (const { year, startAd, months } of golden.years) {
      expect(bsToAd({ year, month: 1, day: 1 }), `1 Baisakh ${year}`).toBe(startAd);
      expect(months.map((_, i) => daysInMonth(year, i + 1)), `month lengths ${year}`).toEqual(months);
    }
  });

  it("every single day converts to the golden BS date and back (30,681 days)", () => {
    let days = 0;
    for (const { year, startAd, months } of golden.years) {
      let offset = 0;
      months.forEach((length, monthIndex) => {
        for (let day = 1; day <= length; day++) {
          const ad = addDays(startAd, offset++);
          const bs = { year, month: monthIndex + 1, day };
          expect(adToBs(ad), `AD ${ad}`).toEqual(bs);
          expect(bsToAd(bs), `BS ${year}-${monthIndex + 1}-${day}`).toBe(ad);
          days++;
        }
      });
    }
    expect(days).toBe(30681);
  });
});

describe("dates the project documents rely on", () => {
  it("1 Ashwin 2083 is 17 Sep 2026 and 3 Ashwin 2083 is 19 Sep 2026", () => {
    expect(bsToAd({ year: 2083, month: 6, day: 1 })).toBe("2026-09-17");
    expect(bsToAd({ year: 2083, month: 6, day: 3 })).toBe("2026-09-19");
  });

  it("Sunday 4 Ashwin 2083 is 20 Sep 2026", () => {
    expect(adToBs("2026-09-20")).toEqual({ year: 2083, month: 6, day: 4 });
    expect(weekday({ year: 2083, month: 6, day: 4 })).toBe(0); // Sunday
  });

  it("Saturday is the weekly holiday, Sunday is a working day", () => {
    expect(isWeeklyHoliday(adToBs("2026-09-19"))).toBe(true); // Saturday
    expect(isWeeklyHoliday(adToBs("2026-09-20"))).toBe(false); // Sunday
    expect(isWeeklyHoliday(adToBs("2026-09-25"))).toBe(false); // Friday
  });

  it("formats with the month names used in the requirements", () => {
    expect(formatBs({ year: 2083, month: 6, day: 4 })).toBe("4 Ashwin 2083");
    expect(BS_MONTH_NAMES).toEqual([
      "Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Ashwin",
      "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
    ]);
  });
});

describe("only verified years convert (D-014)", () => {
  it("refuses the day after the last verified day", () => {
    expect(adToBs("2027-04-13")).toEqual({ year: 2083, month: 12, day: 30 });
    expect(() => adToBs("2027-04-14")).toThrow(UnverifiedCalendarYearError);
  });

  it("refuses BS 2084, whose calendar has not been published", () => {
    expect(() => bsToAd({ year: 2084, month: 1, day: 1 })).toThrow(UnverifiedCalendarYearError);
    expect(() => daysInMonth(2084, 1)).toThrow(UnverifiedCalendarYearError);
  });

  it("refuses years before the verified range", () => {
    expect(() => bsToAd({ year: 1999, month: 12, day: 30 })).toThrow(UnverifiedCalendarYearError);
    expect(() => adToBs("1943-04-13")).toThrow(UnverifiedCalendarYearError);
  });
});

describe("invalid input", () => {
  it.each([
    [{ year: 2083, month: 13, day: 1 }, "month 13"],
    [{ year: 2083, month: 0, day: 1 }, "month 0"],
    [{ year: 2083, month: 6, day: 0 }, "day 0"],
    [{ year: 2083, month: 12, day: 31 }, "31 Chaitra 2083 (has 30 days)"],
    [{ year: 2083, month: 1.5, day: 1 }, "fractional month"],
  ])("rejects %j (%s)", (bs) => {
    expect(() => bsToAd(bs)).toThrow(InvalidBsDateError);
  });

  it.each(["2026-9-19", "19-09-2026", "not a date", "2026-02-30", ""])("rejects the AD text %j", (text) => {
    expect(() => adToBs(text)).toThrow();
  });
});

describe("a disputed stretch is flagged, not hidden", () => {
  it("BS 2062 Baisakh 31 to Jestha 31 (14 May to 14 June 2005) is marked disputed", () => {
    // Hamro Patro and ashesh.com.np agree with us; englishnepalidate.com and seven npm libraries
    // put the month boundary a day earlier. See docs/spikes/bs-dates.md.
    expect(conversionConfidence(adToBs("2005-05-13"))).toBe("verified");
    expect(conversionConfidence(adToBs("2005-05-14"))).toBe("disputed");
    expect(conversionConfidence(adToBs("2005-06-14"))).toBe("disputed");
    expect(conversionConfidence(adToBs("2005-06-15"))).toBe("verified");
  });

  it("an ordinary date is verified", () => {
    expect(conversionConfidence({ year: 2083, month: 6, day: 4 })).toBe("verified");
  });
});

describe("Nepal time (UTC+5:45) decides the day", () => {
  it("the day changes at Nepal midnight, which is 18:15 UTC", () => {
    expect(nepalDate(new Date("2026-09-19T18:14:59Z"))).toBe("2026-09-19");
    expect(nepalDate(new Date("2026-09-19T18:15:00Z"))).toBe("2026-09-20");
  });

  it("todayBs uses the Nepal date, not the server's", () => {
    expect(todayBs(new Date("2026-09-19T20:00:00Z"))).toEqual({ year: 2083, month: 6, day: 4 });
    expect(todayBs(new Date("2026-09-19T12:00:00Z"))).toEqual({ year: 2083, month: 6, day: 3 });
  });
});
