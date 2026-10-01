import { z } from "@hono/zod-openapi";

const percent = z.number().int().nullable();
const change = z.object({ total: z.number().int(), changePercent: percent });

export const DashboardOverviewSchema = z
  .object({
    asOf: z.string(),
    todayBs: z.string().nullable(),
    schoolDay: z.boolean(),
    /** on_track: nothing needs the Principal; attention: one or two kinds of thing do; several: three or more. */
    status: z.enum(["on_track", "attention", "several"]),
    students: change,
    staff: change,
    attendance: z.object({
      percent,
      present: z.number().int(),
      marked: z.number().int(),
      enrolled: z.number().int(),
      previousPercent: percent,
      trend: z.array(z.object({ date: z.string(), dateBs: z.string().nullable(), percent })),
      byProgramme: z.array(z.object({ id: z.string(), name: z.string(), percent, present: z.number().int(), marked: z.number().int(), enrolled: z.number().int() })),
    }),
    fees: z.object({
      collectedPaisa: z.number().int(),
      changePercent: percent,
      chargedPaisa: z.number().int(),
      paidPaisa: z.number().int(),
      duePaisa: z.number().int(),
      overduePaisa: z.number().int(),
    }),
    programmes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sectionName: z.string(),
        active: z.boolean(),
        levels: z.number().int(),
        classes: z.number().int(),
        students: z.number().int(),
        teachers: z.number().int(),
      }),
    ),
    results: z.object({
      publications: z.number().int(),
      lastPublishedAt: z.string().nullable(),
      byProgramme: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          policy: z.string().nullable(),
          cards: z.number().int(),
          passed: z.number().int(),
          passPercent: percent,
          avgGpaHundredths: z.number().int().nullable(),
          avgPercentHundredths: z.number().int().nullable(),
        }),
      ),
    }),
    attention: z.object({
      approvals: z.object({ count: z.number().int(), kinds: z.array(z.object({ kind: z.string(), count: z.number().int() })) }),
      feeFollowUps: z.number().int(),
      anomalies: z.object({
        count: z.number().int(),
        classes: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["low", "unmarked"]), percent })),
      }),
      websiteDrafts: z.number().int(),
    }),
    website: z.object({
      origin: z.string().nullable(),
      live: z.number().int(),
      drafts: z.number().int(),
      waiting: z.number().int(),
      lastPublishedAt: z.string().nullable(),
    }),
    activity: z.array(
      z.object({
        id: z.string(),
        at: z.string(),
        action: z.string(),
        summary: z.string(),
        actorName: z.string().nullable(),
        /** The build team: the screen shows "Support", never a name (CLAUDE.md section 5). */
        actorIsSupport: z.boolean(),
        entityType: z.string(),
        entityId: z.string().nullable(),
      }),
    ),
  })
  .openapi("DashboardOverview");

export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
