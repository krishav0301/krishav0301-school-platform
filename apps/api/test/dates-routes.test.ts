import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { adToBs, adToBsText, bsToAd, daysInMonth } from "../src/core/dates";

const app = createApp();
const call = (path: string, init: { method?: string; cookie?: string } = {}) =>
  app.request(`https://school.example${path}`, { method: init.method ?? "GET", headers: { "Sec-Fetch-Site": "same-origin", ...(init.cookie ? { Cookie: init.cookie } : {}) } }, env);

type ToAd = { ad: string; confidence: string };
type ToBs = { year: number; month: number; day: number; text: string; confidence: string };

describe("GET /api/dates/to-ad", () => {
  it("converts a BS day to AD, for anyone (no sign-in), with a known pair for Nepali New Year", async () => {
    const response = await call("/api/dates/to-ad?bs=2080-01-01");
    expect(response.status).toBe(200);
    expect((await response.json()) as ToAd).toEqual({ ad: "2023-04-14", confidence: "verified" });
    expect(((await (await call("/api/dates/to-ad?bs=2081-01-01")).json()) as ToAd).ad).toBe("2024-04-13");
  });

  it("accepts the last day of a month and refuses the day after it", async () => {
    const last = daysInMonth(2080, 2);
    expect((await call(`/api/dates/to-ad?bs=2080-02-${String(last).padStart(2, "0")}`)).status).toBe(200);
    const over = await call(`/api/dates/to-ad?bs=2080-02-${String(last + 1).padStart(2, "0")}`);
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ error: "invalid_date" });
  });

  it("refuses days that cannot exist, with 422 invalid_date", async () => {
    for (const bs of ["2080-00-10", "2080-13-01", "2080-01-00", "2080-01-40"]) {
      const response = await call(`/api/dates/to-ad?bs=${bs}`);
      expect(response.status, bs).toBe(422);
      expect(await response.json(), bs).toEqual({ error: "invalid_date" });
    }
  });

  it("refuses years whose calendar has not been verified, both sides, with 422 unverified_year", async () => {
    for (const bs of ["2084-01-01", "1999-12-30", "3000-01-01"]) {
      const response = await call(`/api/dates/to-ad?bs=${bs}`);
      expect(response.status, bs).toBe(422);
      expect(await response.json(), bs).toEqual({ error: "unverified_year" });
    }
    // The first and last verified years still convert.
    expect((await call("/api/dates/to-ad?bs=2083-12-01")).status).toBe(200);
    expect((await call("/api/dates/to-ad?bs=2000-01-01")).status).toBe(200);
  });

  it("flags the disputed stretch of BS 2062 so the screen can ask for the certificate", async () => {
    expect(((await (await call("/api/dates/to-ad?bs=2062-01-31")).json()) as ToAd).confidence).toBe("disputed");
    expect(((await (await call("/api/dates/to-ad?bs=2062-03-01")).json()) as ToAd).confidence).toBe("verified");
  });

  it("refuses a value that is not shaped YYYY-MM-DD, with 400", async () => {
    for (const bs of ["2080-1-1", "20800101", "abc", "", "2080-01-01T00:00", "2080-01-01 "]) {
      expect((await call(`/api/dates/to-ad?bs=${encodeURIComponent(bs)}`)).status, JSON.stringify(bs)).toBe(400);
    }
    expect((await call("/api/dates/to-ad")).status).toBe(400);
  });

  it("is a pure lookup that may be cached for a day, and is read-only", async () => {
    const response = await call("/api/dates/to-ad?bs=2080-01-01");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect([404, 405]).toContain((await call("/api/dates/to-ad?bs=2080-01-01", { method: "POST" })).status);
  });
});

describe("GET /api/dates/to-bs", () => {
  it("converts an AD day to BS, with the numbers and the text", async () => {
    const response = await call("/api/dates/to-bs?ad=2023-04-14");
    expect(response.status).toBe(200);
    expect((await response.json()) as ToBs).toEqual({ year: 2080, month: 1, day: 1, text: "2080-01-01", confidence: "verified" });
  });

  it("refuses AD days that do not exist (422 invalid_date) or fall outside the verified years (422 unverified_year)", async () => {
    expect(await (await call("/api/dates/to-bs?ad=2026-02-30")).json()).toEqual({ error: "invalid_date" });
    for (const ad of ["2999-01-01", "1900-01-01"]) {
      const response = await call(`/api/dates/to-bs?ad=${ad}`);
      expect(response.status, ad).toBe(422);
      expect(await response.json(), ad).toEqual({ error: "unverified_year" });
    }
  });

  it("refuses a value that is not shaped YYYY-MM-DD, with 400", async () => {
    for (const ad of ["2023-4-14", "14/04/2023", "x"]) expect((await call(`/api/dates/to-bs?ad=${encodeURIComponent(ad)}`)).status, ad).toBe(400);
  });

  it("the two directions agree on 60 days spread across the verified years, both ways round", async () => {
    for (let i = 0; i < 60; i++) {
      const year = 2001 + Math.floor((i * 82) / 60);
      const month = (i % 12) + 1;
      const day = 1 + ((i * 7) % Math.min(28, daysInMonth(year, month)));
      const bs = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const ad = ((await (await call(`/api/dates/to-ad?bs=${bs}`)).json()) as ToAd).ad;
      expect(ad, bs).toBe(bsToAd({ year, month, day }));
      expect(((await (await call(`/api/dates/to-bs?ad=${ad}`)).json()) as ToBs).text, bs).toBe(bs);
    }
  });
});

describe("adToBsText (the helper the content responses use)", () => {
  it("gives YYYY-MM-DD in BS, and null instead of throwing for a day outside the verified years", () => {
    expect(adToBsText("2023-04-14")).toBe("2080-01-01");
    expect(adToBsText("2999-01-01")).toBeNull();
    expect(adToBsText("not a date")).toBeNull();
    const bs = adToBs("2024-04-13");
    expect(adToBsText("2024-04-13")).toBe(`${bs.year}-${String(bs.month).padStart(2, "0")}-${String(bs.day).padStart(2, "0")}`);
  });
});
