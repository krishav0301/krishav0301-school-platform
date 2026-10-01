import { describe, expect, it } from "vitest";

import { ACTIVITY, bsDayMonth, bsLong, changeLabel, chartPoints, compactNpr, greetingKey, relativeTime } from "@/dashboard/admin-model";

/** The Principal's dashboard (D-088): the display rules, separate from the data (which the API's own tests cover). */
describe("the dashboard's display rules", () => {
  it("greets by Nepal's clock, whatever the device's time zone", () => {
    expect(greetingKey(new Date("2026-09-30T02:00:00Z"))).toBe("dashboard.greeting.morning"); // 07:45 in Nepal
    expect(greetingKey(new Date("2026-09-30T08:00:00Z"))).toBe("dashboard.greeting.afternoon"); // 13:45
    expect(greetingKey(new Date("2026-09-30T13:00:00Z"))).toBe("dashboard.greeting.evening"); // 18:45
    expect(greetingKey(new Date("2026-09-29T18:30:00Z"))).toBe("dashboard.greeting.morning"); // 00:15 the next day
  });

  it("money on a card: whole rupees below a lakh, else lakhs or crores to one decimal, Nepali grouping", () => {
    expect(compactNpr(4_500_000)).toBe("45,000"); // NPR 45,000
    expect(compactNpr(284_000_000)).toBe("28.4 L");
    expect(compactNpr(10_000_000)).toBe("1.0 L");
    expect(compactNpr(9_999_999)).toBe("1,00,000"); // just under a lakh, rounded to the rupee
    expect(compactNpr(1_250_000_000)).toBe("1.3 Cr");
    expect(compactNpr(0)).toBe("0");
  });

  it("a change is shown only when there is something to compare with", () => {
    expect(changeLabel(null)).toBeNull();
    expect(changeLabel(5)).toEqual({ text: "+5%", direction: "up" });
    expect(changeLabel(-2)).toEqual({ text: "−2%", direction: "down" });
    expect(changeLabel(0)).toEqual({ text: "0%", direction: "flat" });
  });

  it("dates in Bikram Sambat, as everywhere else", () => {
    expect(bsDayMonth("2083-06-14")).toBe("14 Ashwin");
    expect(bsLong("2083-06-14")).toBe("14 Ashwin 2083");
    expect(bsDayMonth(null)).toBe("");
  });

  it("times as people say them", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    expect(relativeTime("2026-09-30T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-09-30T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-09-30T10:00:00Z", now)).toBe("2 hours ago");
    expect(relativeTime("2026-09-29T11:00:00Z", now)).toBe("1 day ago");
  });

  it("every kind of activity the API can send has words and a place to go", () => {
    const kinds = [
      "content.published",
      "admissions.approved",
      "admissions.walkin.registered",
      "fees.payment.cash",
      "fees.payment.voucher",
      "fees.payment.online",
      "fees.refund.recorded",
      "results.published",
      "results.recheck.changed",
      "accounts.staff.created",
      "academics.programme.created",
      "approvals.request.approved",
      "approvals.request.declined",
    ];
    for (const kind of kinds) expect(ACTIVITY[kind]?.href, kind).toMatch(/^\/portal/);
  });

  it("chart points: 100% at the top, 40% at the bottom, evenly spread", () => {
    const pts = chartPoints([100, 40, 70], 200, 100, 10);
    expect(pts.map((p) => p.x)).toEqual([10, 100, 190]);
    expect(pts[0]!.y).toBe(10);
    expect(pts[1]!.y).toBe(90);
    expect(pts[2]!.y).toBe(50);
  });
});
