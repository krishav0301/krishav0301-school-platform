import { z } from "@hono/zod-openapi";

import {
  adToBs,
  bsToAd,
  bsToText,
  conversionConfidence,
  InvalidAdDateError,
  InvalidBsDateError,
  UnverifiedCalendarYearError,
} from "../../core/dates";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const Confidence = z.enum(["verified", "disputed"]).describe("`disputed` means public calendars disagree on this day: confirm it against the certificate.");
const DayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD");
const FailureSchema = z.object({ error: z.enum(["invalid_date", "unverified_year"]) }).openapi("DateConversionFailure");

/** A conversion depends only on its input, so it may be cached for a day. */
const CACHE = "public, max-age=86400";

function failure(error: unknown): "invalid_date" | "unverified_year" {
  if (error instanceof UnverifiedCalendarYearError) return "unverified_year";
  if (error instanceof InvalidBsDateError || error instanceof InvalidAdDateError) return "invalid_date";
  throw error;
}

/**
 * Date conversion for screens. The web app never converts dates itself (D-014): it asks here, and
 * the date module gives the answer, or refuses a day outside the verified years.
 */
export function registerDates(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/dates/to-ad",
      operationId: "bs_to_ad",
      tags: ["dates"],
      description: "Converts a Bikram Sambat day (YYYY-MM-DD, month as a number) to AD. Refuses a day that does not exist and any year outside BS 2000 to 2083.",
      access: { public: true },
      request: { query: z.object({ bs: DayText }) },
      responses: {
        200: { description: "The AD day", content: json(z.object({ ad: z.string(), confidence: Confidence })) },
        422: { description: "Not a real day, or a year that has not been verified", content: json(FailureSchema) },
      },
    },
    async (c) => {
      const [year, month, day] = c.req.valid("query").bs.split("-").map(Number) as [number, number, number];
      try {
        const ad = bsToAd({ year, month, day });
        c.header("Cache-Control", CACHE);
        return c.json({ ad, confidence: conversionConfidence({ year, month, day }) }, 200);
      } catch (error) {
        return c.json({ error: failure(error) }, 422);
      }
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/dates/to-bs",
      operationId: "ad_to_bs",
      tags: ["dates"],
      description: "Converts an AD day (YYYY-MM-DD) to Bikram Sambat. Refuses a day that does not exist and any day outside BS 2000 to 2083.",
      access: { public: true },
      request: { query: z.object({ ad: DayText }) },
      responses: {
        200: {
          description: "The BS day",
          content: json(z.object({ year: z.number(), month: z.number(), day: z.number(), text: z.string(), confidence: Confidence })),
        },
        422: { description: "Not a real day, or outside the verified years", content: json(FailureSchema) },
      },
    },
    async (c) => {
      try {
        const bs = adToBs(c.req.valid("query").ad);
        c.header("Cache-Control", CACHE);
        return c.json({ ...bs, text: bsToText(bs), confidence: conversionConfidence(bs) }, 200);
      } catch (error) {
        return c.json({ error: failure(error) }, 422);
      }
    },
  );
}
