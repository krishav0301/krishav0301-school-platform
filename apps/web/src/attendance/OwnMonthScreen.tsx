"use client";

import { CalendarCheck, CalendarOff, UserX } from "lucide-react";
import { useCallback, useState } from "react";

import { MONTH_LABEL, formatBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button } from "@/ui";

import styles from "./attendance.module.css";
import { gateFailure, loadOwnMonth } from "./client";
import { TEACHER_STATUS_LABEL, shiftMonth, type OwnTeacherMonth } from "./model";

const WEEKDAYS: readonly MessageKey[] = ["weekday.0", "weekday.1", "weekday.2", "weekday.3", "weekday.4", "weekday.5", "weekday.6"];

/** "Ashwin 2083" from "2083-06". The text as it is when it is not a month. */
export function monthName(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const label = match ? MONTH_LABEL[Number(match[2]) - 1] : undefined;
  return match && label ? `${t(label)} ${match[1]}` : month;
}

export function monthFigures(m: OwnTeacherMonth): Figure[] {
  return [
    { key: "present", icon: CalendarCheck, tone: "ok", value: String(m.present), label: t("attendance.teachers.figure.present") },
    { key: "absent", icon: UserX, tone: m.absent > 0 ? "bad" : "ok", value: String(m.absent), label: t("attendance.teachers.figure.absent") },
    { key: "leave", icon: CalendarOff, tone: "warn", value: String(m.leave), label: t("attendance.teachers.figure.leave") },
  ];
}

/** A teacher's own month, read only (D-070; redesigned in D-107): the figures, then every day with its status in words. Pure. */
export function OwnMonthView({ month }: { month: OwnTeacherMonth }) {
  return (
    <>
      <FigureTiles figures={monthFigures(month)} label={t("attendance.mine.figures")} />
      <Panel title={monthName(month.month)} labelledBy="own-month">
        {month.days.length === 0 ? (
          <EmptyLine>{t("attendance.mine.empty")}</EmptyLine>
        ) : (
          <ReadTable
            caption={monthName(month.month)}
            rows={month.days}
            rowKey={(d) => d.date}
            columns={[
              { key: "day", label: t("attendance.mine.day"), primary: true, cell: (d) => formatBsDate(d.dateBs) },
              { key: "weekday", label: t("attendance.mine.weekday"), hidePhone: true, cell: (d) => t(WEEKDAYS[d.weekday]!) },
              {
                key: "status",
                label: t("attendance.class.status"),
                cell: (d) =>
                  d.status === null ? (
                    <StatusWord>{t("attendance.status.notMarked")}</StatusWord>
                  ) : (
                    <StatusWord tone={d.status === "present" ? "ok" : d.status === "absent" ? "bad" : "warn"}>{t(TEACHER_STATUS_LABEL[d.status])}</StatusWord>
                  ),
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}

/** A teacher's own attendance, one BS month at a time, read only (source 6.2). */
export function OwnMonthScreen() {
  const { api } = useSession();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const loadNow = useCallback(async () => {
    const result = await loadOwnMonth(api, month);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, month]);
  const { view, reload } = useLoad<OwnTeacherMonth>(loadNow);
  const data = view.status === "ready" ? view.data : null;

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("attendance.mine.title")}
        subtitle={t("attendance.mine.subtitle")}
        actions={
          data ? (
            <div className={styles.monthNav}>
              <Button variant="secondary" onClick={() => setMonth(shiftMonth(data.month, -1))}>
                {t("attendance.mine.previous")}
              </Button>
              <Button variant="secondary" onClick={() => setMonth(shiftMonth(data.month, 1))}>
                {t("attendance.mine.next")}
              </Button>
            </div>
          ) : null
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={8} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {data ? <OwnMonthView month={data} /> : null}
    </div>
  );
}
