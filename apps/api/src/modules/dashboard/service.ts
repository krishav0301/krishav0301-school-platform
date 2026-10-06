import { changePercent, runParts } from "../../core/dashboard";
import { adToBsText, isWeeklyHoliday, nepalDate, todayBs } from "../../core/dates";
import { programmesDashboardPart } from "../academics";
import { studentsDashboardPart } from "../admissions";
import { approvalsDashboardPart } from "../approvals/service";
import { ATTENDANCE_ALERT_THRESHOLD, attendanceDashboardPart, attendancePercent } from "../attendance";
import { staffDashboardPart } from "../accounts/service";
import { contentDashboardPart } from "../content";
import { feesDashboardPart } from "../fees";
import { resultsDashboardPart } from "../results";
import type { DashboardOverview } from "./schema";

const DAY = 86_400_000;

/**
 * OPEN: a class with no register yet is flagged only from this hour (Nepal time) on a school day, so a morning
 * register still being taken is not an anomaly. Noon is a stated default until the school says when registers close.
 */
export const UNMARKED_FROM_HOUR = 12;

const nepalHour = (now: Date): number => new Date(now.getTime() + (5 * 60 + 45) * 60_000).getUTCHours();

/**
 * Everything the Principal's dashboard shows (D-088), in one database round trip: each module offers its own part
 * (it reads only its own tables), and this composes them. Nothing is stored or cached here: every figure is the
 * database's as of now.
 */
export async function dashboardOverview(db: D1Database, env: { SITE_ORIGIN?: string }, now = new Date()): Promise<DashboardOverview> {
  const today = nepalDate(now);
  const bsToday = todayBs(now);
  const schoolDay = !isWeeklyHoliday(bsToday);
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  const before = new Date(now.getTime() - 60 * DAY).toISOString();

  const p = await runParts(db, {
    students: studentsDashboardPart(db, since),
    staff: staffDashboardPart(db, since),
    attendance: attendanceDashboardPart(db, today),
    fees: feesDashboardPart(db, { since, before }, today),
    programmes: programmesDashboardPart(db),
    results: resultsDashboardPart(db),
    approvals: approvalsDashboardPart(db),
    content: contentDashboardPart(db),
  });

  // Attendance: today's figure, and the register day before it for comparison.
  const a = p.attendance;
  const trend = a.trend.map((d) => ({ date: d.date, dateBs: adToBsText(d.date), percent: attendancePercent(d.present, d.marked) }));
  const previousDay = [...trend].reverse().find((d) => d.date < today);

  // Anomalies: on a school day, a class below the alert threshold, or (from noon) a class with no register at all.
  type Anomaly = { id: string; name: string; kind: "low" | "unmarked"; percent: number | null };
  const anomalies: Anomaly[] = schoolDay
    ? a.byClass.flatMap((c): Anomaly[] => {
        const name = [c.programmeName, c.levelName, c.label].filter(Boolean).join(" · ");
        const percent = attendancePercent(c.present, c.marked);
        if (c.marked === 0) return nepalHour(now) >= UNMARKED_FROM_HOUR ? [{ id: c.id, name, kind: "unmarked", percent: null }] : [];
        return percent !== null && percent < ATTENDANCE_ALERT_THRESHOLD ? [{ id: c.id, name, kind: "low", percent }] : [];
      })
    : [];

  const approvalsCount = p.approvals.reduce((s, k) => s + k.count, 0);
  const attention = {
    approvals: { count: approvalsCount, kinds: p.approvals },
    feeFollowUps: p.fees.followUps,
    anomalies: { count: anomalies.length, classes: anomalies },
    websiteDrafts: p.content.drafts,
  };
  // OPEN: the status rule. Each kind of thing waiting counts once; none is "on track", one or two "attention".
  const waiting = [attention.approvals.count, attention.feeFollowUps, attention.anomalies.count, attention.websiteDrafts].filter((n) => n > 0).length;

  return {
    asOf: now.toISOString(),
    todayBs: adToBsText(today),
    schoolDay,
    status: waiting === 0 ? "on_track" : waiting <= 2 ? "attention" : "several",
    students: { total: p.students.total, changePercent: changePercent(p.students.total, p.students.previous) },
    staff: { total: p.staff.total, changePercent: changePercent(p.staff.total, p.staff.previous) },
    attendance: {
      percent: attendancePercent(a.today.present, a.today.marked),
      present: a.today.present,
      marked: a.today.marked,
      enrolled: a.today.enrolled,
      previousPercent: previousDay?.percent ?? null,
      trend,
      byProgramme: a.byProgramme.map((r) => ({ ...r, percent: attendancePercent(r.present, r.marked) })),
    },
    fees: {
      collectedPaisa: p.fees.collectedPaisa,
      changePercent: changePercent(p.fees.collectedPaisa, p.fees.previousPaisa),
      chargedPaisa: p.fees.chargedPaisa,
      paidPaisa: p.fees.paidPaisa,
      duePaisa: p.fees.duePaisa,
      overduePaisa: p.fees.overduePaisa,
    },
    programmes: p.programmes.map((r) => ({ ...r, active: r.active === 1 })),
    results: {
      publications: p.results.publications,
      lastPublishedAt: p.results.lastPublishedAt,
      byProgramme: p.results.byProgramme.map((r) => ({ ...r, passPercent: r.cards > 0 ? Math.floor((r.passed * 100) / r.cards) : null })),
    },
    attention,
    website: { origin: env.SITE_ORIGIN ?? null, live: p.content.live, drafts: p.content.drafts, waiting: p.content.waiting, lastPublishedAt: p.content.lastPublishedAt },
  };
}
