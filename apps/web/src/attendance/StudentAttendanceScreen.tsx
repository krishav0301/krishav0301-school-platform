"use client";

import { CalendarCheck, Percent, UserX } from "lucide-react";
import { useCallback, useState } from "react";

import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Notice } from "@/ui";

import { loadOwn } from "./client";
import type { OwnAttendance } from "./model";

/** The year's figures: the percentage, days present and days absent. Pure. */
export function ownFigures(own: OwnAttendance): Figure[] {
  return [
    { key: "percent", icon: Percent, tone: own.below ? "bad" : "ok", value: own.percent === null ? "—" : `${own.percent}%`, label: t("attendance.own.figure.percent") },
    { key: "present", icon: CalendarCheck, tone: "ok", value: String(own.present), label: t("attendance.own.figure.present") },
    { key: "absent", icon: UserX, tone: own.absent > 0 ? "warn" : "ok", value: String(own.absent), label: t("attendance.own.figure.absent") },
  ];
}

/** The year so far, read only (D-069; redesigned in D-107): the figures, a word when below the threshold, the days absent. Pure. */
export function OwnAttendanceView({ own }: { own: OwnAttendance }) {
  if (own.percent === null) {
    return (
      <Panel>
        <EmptyLine>{t("attendance.own.nothingYet")}</EmptyLine>
      </Panel>
    );
  }
  return (
    <>
      <FigureTiles figures={ownFigures(own)} label={t("attendance.own.figures")} />
      {own.below ? <Notice tone="bad">{t("attendance.own.below", { threshold: own.threshold })}</Notice> : null}
      <Panel title={t("attendance.own.absentDays")} labelledBy="own-absent-days">
        {own.absentDays.length === 0 ? (
          <EmptyLine>{t("attendance.own.noAbsence")}</EmptyLine>
        ) : (
          <ReadTable
            caption={t("attendance.own.absentDays")}
            rows={[...own.absentDays].reverse()}
            rowKey={(d) => d.date}
            columns={[
              { key: "day", label: t("attendance.mine.day"), primary: true, cell: (d) => (d.dateBs ? formatBsDate(d.dateBs) : d.date) },
              { key: "status", label: t("attendance.class.status"), cell: () => <StatusWord tone="bad">{t("attendance.class.absent")}</StatusWord> },
            ]}
          />
        )}
      </Panel>
    </>
  );
}

/** A student's own attendance for the year (the student's "See your attendance" line). */
export function StudentAttendanceScreen() {
  const { api } = useSession();
  const [absentHere, setAbsentHere] = useState(false);
  const loadNow = useCallback(async () => {
    const result = await loadOwn(api);
    // No enrollment this year: nothing to show, rather than an error.
    setAbsentHere(!result.ok && result.reason === "not_found");
    return result.ok ? result : ({ ok: false, reason: result.reason === "forbidden" ? "forbidden" : "failed" } as const);
  }, [api]);
  const { view, reload } = useLoad<OwnAttendance>(loadNow);
  const own = view.status === "ready" ? view.data : null;
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("attendance.own.title")} subtitle={own ? t("attendance.own.subtitle", { year: own.yearLabel }) : undefined} />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={3} /> : null}
      {view.status === "failed" && absentHere ? (
        <Panel>
          <EmptyLine>{t("attendance.own.nothingYet")}</EmptyLine>
        </Panel>
      ) : null}
      {(view.status === "failed" && !absentHere) || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {own ? <OwnAttendanceView own={own} /> : null}
    </div>
  );
}
