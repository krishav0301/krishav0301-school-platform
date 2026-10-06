"use client";

import { useCallback, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { ChangeDate, dayLine, EmptyLine, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, Segments, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Notice } from "@/ui";

import { gateFailure, loadDay, loadSummary } from "./client";
import { className, type AttendanceDay, type AttendanceSummary } from "./model";
import { Register } from "./Register";

/** One day's register, read only: who was present and who absent, in words. Pure, so tests draw it. */
export function DayTable({ day }: { day: AttendanceDay }) {
  if (!day.marked) return <EmptyLine>{t(day.isToday ? "attendance.class.notMarkedToday" : "attendance.class.notMarked")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("attendance.class.dayTitle")}
      rows={day.students}
      rowKey={(s) => s.enrollmentId}
      columns={[
        { key: "n", label: "#", hidePhone: true, cell: (_s, i) => <span className={readStyles.number}>{i + 1}</span> },
        { key: "name", label: t("attendance.col.name"), primary: true, cell: (s) => s.name },
        { key: "sid", label: t("attendance.col.sid"), cell: (s) => s.sid },
        {
          key: "status",
          label: t("attendance.class.status"),
          cell: (s) =>
            s.status === "absent" ? <StatusWord tone="bad">{t("attendance.class.absent")}</StatusWord> : s.status === "present" ? <StatusWord tone="ok">{t("attendance.class.present")}</StatusWord> : <StatusWord>{t("attendance.status.notMarked")}</StatusWord>,
        },
      ]}
    />
  );
}

/** Each student's year so far: days present of the days marked, the percentage, and "Below 75%" in words. Pure. */
export function YearTable({ summary }: { summary: AttendanceSummary }) {
  const flagged = summary.students.filter((s) => s.below).length;
  return (
    <>
      <p className={readStyles.subtitle}>{t("attendance.summary.intro", { threshold: summary.threshold })}</p>
      {flagged > 0 ? <Notice>{t("attendance.summary.flagged", { count: flagged, threshold: summary.threshold })}</Notice> : null}
      <ReadTable
        caption={t("attendance.summary.title")}
        rows={summary.students}
        rowKey={(s) => s.enrollmentId}
        columns={[
          { key: "n", label: "#", hidePhone: true, cell: (_s, i) => <span className={readStyles.number}>{i + 1}</span> },
          { key: "name", label: t("attendance.col.name"), primary: true, cell: (s) => s.name },
          { key: "sid", label: t("attendance.col.sid"), cell: (s) => s.sid },
          { key: "days", label: t("attendance.col.days"), cell: (s) => (s.percent === null ? t("attendance.summary.noDays") : t("attendance.summary.daysOf", { present: s.present, marked: s.present + s.absent })) },
          { key: "percent", label: t("attendance.col.percent"), align: "end", cell: (s) => (s.percent === null ? "—" : `${s.percent}%`) },
          { key: "flag", label: t("attendance.class.status"), cell: (s) => (s.below ? <StatusWord tone="bad">{t("attendance.summary.below", { threshold: summary.threshold })}</StatusWord> : s.percent === null ? "—" : <StatusWord tone="ok">{t("attendance.status.onTrack")}</StatusWord>) },
        ]}
      />
    </>
  );
}

/**
 * One class (`?id=`), redesigned in D-103 after the PM's reference. Its Class Teacher marks today here (unchanged).
 * Everyone else reads: today's register, or another day through Change date, and each student's year so far.
 */
/** `embedded`: one tab of a class page (FUT point 19): titled Attendance, without breadcrumbs. */
export function ClassAttendanceScreen({ embedded = false }: { embedded?: boolean }) {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const [date, setDate] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"day" | "year">("day");

  const loadNow = useCallback(async () => {
    if (!id) return { ok: false as const, reason: "failed" as const };
    const [day, summary] = await Promise.all([loadDay(api, id, date), loadSummary(api, id)]);
    if (!day.ok) return gateFailure(day.reason);
    if (!summary.ok) return gateFailure(summary.reason);
    return { ok: true as const, data: { day: day.data, summary: summary.data } };
  }, [api, id, date]);
  const { view, reload } = useLoad<{ day: AttendanceDay; summary: AttendanceSummary }>(loadNow);

  if (view.status === "loading") return <TableSkeleton rows={8} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const { day, summary } = view.data;
  const name = className(day.class);

  return (
    <div className={readStyles.page}>
      <ReadHeader
        level={embedded ? 2 : 1}
        title={embedded ? t("attendance.title") : name}
        subtitle={day.canMark ? undefined : t("attendance.class.readOnly")}
        crumbs={[{ label: t("attendance.title"), href: "/portal/attendance" }, { label: name }]}
        dayBs={dayLine(day.dateBs, day.isToday, day.date)}
        actions={day.canMark ? undefined : <ChangeDate onDate={setDate} />}
      />
      {day.canMark ? (
        <>
          <Register day={day} onSaved={() => void reload()} />
          <Panel title={t("attendance.summary.title")} labelledBy="year-heading">
            <YearTable summary={summary} />
          </Panel>
        </>
      ) : (
        <>
          <Segments
            label={t("attendance.class.views")}
            value={mode}
            onChange={setMode}
            options={[
              { key: "day", label: day.isToday ? t("attendance.class.todayView") : t("attendance.class.dayView") },
              { key: "year", label: t("attendance.summary.title") },
            ]}
          />
          <Panel>{mode === "day" ? <DayTable day={day} /> : <YearTable summary={summary} />}</Panel>
          <ReadOnlyNote>{t("attendance.class.readOnlyNote")}</ReadOnlyNote>
        </>
      )}
    </div>
  );
}
