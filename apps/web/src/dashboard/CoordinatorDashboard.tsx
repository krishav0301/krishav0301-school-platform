"use client";

import { CalendarCheck, ClipboardCheck, ClipboardList, ListChecks } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { loadQueue } from "@/admissions/client";
import { loadClasses, loadTeacherDay } from "@/attendance/client";
import { loadActivityClasses } from "@/classwork/client";
import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { FigureTiles, OpenLink, Panel, ReadFailure, ReadHeader, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { OVERVIEW_ART } from "@/ui";
import { loadBoard } from "@/results/client";
import { useSession, type RoleClaim } from "@/session/SessionProvider";
import { loadChecklist, type Checklist } from "@/setup/checklist-client";
import { useLoad } from "@/setup/useLoad";

import { bsLong, greetingKey } from "./admin-model";
import { RoleBriefLinks } from "./RoleBrief";
import { DayList, type DayRow } from "./RoleDashboards";

export type { DayRow };

/** The seven setup facts, in their fixed order, each with the page where it is fixed (D-062). */
export const CHECKLIST: { key: keyof Checklist; label: MessageKey; href: string }[] = [
  { key: "year", label: "portal.checklist.year", href: "/portal/setup" },
  { key: "structure", label: "portal.checklist.structure", href: "/portal/setup/programmes" },
  { key: "classes", label: "portal.checklist.classes", href: "/portal/setup/classes" },
  { key: "terminals", label: "portal.checklist.terminals", href: "/portal/setup/terminals" },
  { key: "subjects", label: "portal.checklist.subjects", href: "/portal/setup/curriculum" },
  { key: "teachers", label: "portal.checklist.teachers", href: "/portal/people" },
  { key: "classTeachers", label: "portal.checklist.classTeachers", href: "/portal/setup/teaching" },
];

/** What the Co-ordinator's home needs, each from an API their own screens already use; null when a module is off. */
export interface SchoolDay {
  todayBs: string | null;
  waiting: number;
  registers: { marked: number; total: number } | null;
  teachersSaved: boolean | null;
  logs: { complete: number; total: number } | null;
  toVerify: number | null;
  checklist: Checklist;
}

const done = (c: Checklist) => CHECKLIST.filter((item) => c[item.key]).length;

/** Four figures: applications waiting, registers marked, marks to verify, setup done. Only what the lines below say. */
export function dayFigures(d: SchoolDay): Figure[] {
  const figures: Figure[] = [{ key: "waiting", icon: ClipboardList, tone: d.waiting > 0 ? "warn" : "ok", value: String(d.waiting), label: t("coord.figure.waiting") }];
  if (d.registers && d.registers.total > 0) figures.push({ key: "registers", icon: CalendarCheck, tone: d.registers.marked < d.registers.total ? "warn" : "ok", value: t("coord.ofTotal", { done: d.registers.marked, total: d.registers.total }), label: t("coord.figure.registers") });
  if (d.toVerify !== null) figures.push({ key: "verify", icon: ClipboardCheck, tone: d.toVerify > 0 ? "warn" : "ok", value: String(d.toVerify), label: t("coord.figure.verify") });
  figures.push({ key: "setup", icon: ListChecks, tone: done(d.checklist) < CHECKLIST.length ? "accent" : "ok", value: t("coord.ofTotal", { done: done(d.checklist), total: CHECKLIST.length }), label: t("coord.figure.setup") });
  return figures;
}

/** Today's work, one row each: what it is, where it stands in words, and the page to act on it. Pure. */
export function dayRows(d: SchoolDay): DayRow[] {
  const rows: DayRow[] = [
    {
      key: "applications",
      title: t("coord.today.applications"),
      meta: d.waiting > 0 ? t("coord.today.applicationsWaiting", { count: d.waiting }) : t("coord.today.applicationsNone"),
      todo: d.waiting > 0,
      href: "/portal/admissions",
      action: d.waiting > 0 ? t("admissions.queue.review") : t("dashboard.open"),
    },
  ];
  if (d.registers && d.registers.total > 0) {
    rows.push({ key: "registers", title: t("coord.today.registers"), meta: t("coord.today.registersMeta", { marked: d.registers.marked, total: d.registers.total }), todo: d.registers.marked < d.registers.total, href: "/portal/attendance", action: t("dashboard.open") });
  }
  if (d.teachersSaved !== null) {
    rows.push({
      key: "teachers",
      title: t("coord.today.teachers"),
      meta: t(d.teachersSaved ? "dashboard.school.teachersDone" : "dashboard.school.teachersTodo"),
      todo: !d.teachersSaved,
      href: "/portal/attendance/teachers",
      action: d.teachersSaved ? t("dashboard.open") : t("dashboard.school.markTeachers"),
    });
  }
  if (d.logs && d.logs.total > 0) {
    rows.push({ key: "logs", title: t("coord.today.logs"), meta: t("coord.today.logsMeta", { complete: d.logs.complete, total: d.logs.total }), todo: d.logs.complete < d.logs.total, href: "/portal/classwork", action: t("dashboard.open") });
  }
  if (d.toVerify !== null) {
    rows.push({
      key: "verify",
      title: t("coord.today.marks"),
      meta: d.toVerify > 0 ? t("coord.today.marksWaiting", { count: d.toVerify }) : t("coord.today.marksNone"),
      todo: d.toVerify > 0,
      href: "/portal/results/review",
      action: d.toVerify > 0 ? t("coord.today.verify") : t("dashboard.open"),
    });
  }
  return rows;
}

/** The setup checklist: the steps still to do first; once all are done, one calm line instead of seven ticks. Pure. */
export function SetupList({ checklist }: { checklist: Checklist }) {
  if (done(checklist) === CHECKLIST.length) {
    return (
      <div className={readStyles.rowHead}>
        <p className={readStyles.rowMeta}>{t("coord.setup.complete")}</p>
        <OpenLink href="/portal/setup" label={t("coord.setup.open")} text={t("dashboard.open")} />
      </div>
    );
  }
  const ordered = [...CHECKLIST.filter((i) => !checklist[i.key]), ...CHECKLIST.filter((i) => checklist[i.key])];
  return (
    <ul className={readStyles.rows}>
      {ordered.map((item) => (
        <li key={item.key} className={readStyles.rowItem}>
          <div className={readStyles.rowHead}>
            <h3 className={readStyles.rowTitle}>{t(item.label)}</h3>
            <span className={readStyles.cellWords}>
              <StatusWord tone={checklist[item.key] ? "ok" : "warn"}>{t(checklist[item.key] ? "portal.checklist.done" : "portal.checklist.notDone")}</StatusWord>
              <OpenLink href={item.href} label={t(item.label)} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The figures and lists under the greeting. */
export function CoordinatorDayView({ day, extra }: { day: SchoolDay; extra?: ReactNode }) {
  return (
    <>
      <FigureTiles figures={dayFigures(day)} label={t("coord.figures")} />
      <Panel title={t("coord.today.title")} labelledBy="coord-today">
        <DayList rows={dayRows(day)} />
      </Panel>
      <Panel title={t("portal.checklist.title")} labelledBy="coord-setup" actions={<span className={readStyles.rowMeta}>{t("coord.setup.progress", { done: done(day.checklist), total: CHECKLIST.length })}</span>}>
        <SetupList checklist={day.checklist} />
      </Panel>
      {extra}
      <RoleBriefLinks role="coordinator" />
    </>
  );
}

/** The Co-ordinator's home (D-106), after the Principal's dashboard: today's work and what is left to set up. */
export function CoordinatorDashboard({ extra }: { extra?: ReactNode } = {}) {
  const { api, me } = useSession();
  const { config, term } = useConfig();
  const attendanceOn = config?.modules.attendance === true;
  const teachersOn = config?.modules.teacher_attendance === true;
  const resultsOn = config?.modules.results !== false;
  const [now] = useState(() => new Date());

  const loadNow = useCallback(async (): Promise<{ ok: true; data: SchoolDay } | { ok: false; reason: "failed" | "forbidden" }> => {
    const [queue, checklist, classes, teachers, activity, board] = await Promise.all([
      loadQueue(api),
      loadChecklist(api),
      attendanceOn ? loadClasses(api) : null,
      teachersOn ? loadTeacherDay(api) : null,
      loadActivityClasses(api),
      resultsOn ? loadBoard(api) : null,
    ]);
    if (!queue.ok || !checklist.ok || (classes && !classes.ok) || (teachers && !teachers.ok) || !activity.ok) return { ok: false, reason: "failed" };
    const staffed = activity.data.classes.filter((c) => c.expected > 0);
    return {
      ok: true,
      data: {
        todayBs: classes?.ok ? classes.data.todayBs : activity.data.dateBs,
        waiting: queue.data.filter((a) => a.status === "pending_review").length,
        registers: classes?.ok ? { marked: classes.data.classes.filter((c) => c.markedToday).length, total: classes.data.classes.length } : null,
        teachersSaved: teachers?.ok && teachers.data.teachers.length > 0 ? teachers.data.marked : null,
        logs: { complete: staffed.filter((c) => c.written >= c.expected).length, total: staffed.length },
        // The board is a help, not the page: if it cannot be read (no terminal yet), the line is simply left out.
        toVerify: board?.ok ? board.data.classes.flatMap((c) => c.subjects).filter((s) => s.status === "under_review").length : null,
        checklist: checklist.data,
      },
    };
  }, [api, attendanceOn, teachersOn, resultsOn]);
  const { view, reload } = useLoad<SchoolDay>(loadNow);

  if (!me) return null;
  const claim = me.roles.find((r) => r.role === "coordinator") as RoleClaim | undefined;
  const scope = !claim || claim.scope === "institution" ? t("portal.scopeInstitution") : t("portal.scopeSection", { section: config?.sections.find((s) => s.key === claim.section)?.name ?? claim.section ?? "" });
  // The greeting needs nothing from the server, so it is there at once; the day fills in below it.
  return (
    <div className={readStyles.page}>
      <ReadHeader art={OVERVIEW_ART.coordinator} title={t(greetingKey(now), { name: me.name })} subtitle={`${term("role.coordinator")} · ${scope}`} dayBs={view.status === "ready" && view.data.todayBs ? bsLong(view.data.todayBs) : null} />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? <CoordinatorDayView day={view.data} extra={extra} /> : null}
    </div>
  );
}
