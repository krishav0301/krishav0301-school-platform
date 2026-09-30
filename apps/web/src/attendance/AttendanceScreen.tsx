"use client";

import Link from "next/link";
import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Notice } from "@/ui";

import { gateFailure, loadClasses, loadDay } from "./client";
import { className, type AttendanceClassList, type AttendanceDay } from "./model";
import { Register } from "./Register";

type Screen = { list: AttendanceClassList; mine: AttendanceDay[] };


/**
 * Attendance (D-069). A Class Teacher gets today's register for their class first. A Co-ordinator or Admin gets the
 * active year's classes, each with today's state, to open one.
 */
export function AttendanceScreen() {
  const { api, me } = useSession();
  // Staff who look at every class see "no classes yet"; a teacher sees why they have no register.
  const overseer = me?.roles.some((r) => r.role !== "teacher" && r.role !== "student") ?? false;
  const loadNow = useCallback(async () => {
    const list = await loadClasses(api);
    if (!list.ok) return gateFailure(list.reason);
    const mine = list.data.classes.filter((c) => c.mine);
    const days = await Promise.all(mine.map((c) => loadDay(api, c.id)));
    const failed = days.find((d) => !d.ok);
    if (failed && !failed.ok) return gateFailure(failed.reason);
    return { ok: true as const, data: { list: list.data, mine: days.flatMap((d) => (d.ok ? [d.data] : [])) } };
  }, [api]);
  const { view, reload } = useLoad<Screen>(loadNow);

  return (
    <div className={setupStyles.page}>
      <h1 className={setupStyles.title}>{t("attendance.title")}</h1>
      <Gate view={view} onRetry={() => void reload()}>
        {({ list, mine }) => {
          const others = list.classes.filter((c) => !c.mine);
          return (
            <>
              {mine.map((day) => (
                <Register key={day.class.id} day={day} />
              ))}
              {others.length > 0 ? (
                <section aria-labelledby="attendance-classes" className={setupStyles.page}>
                  <div>
                    <h2 id="attendance-classes" className={setupStyles.subhead}>
                      {t("attendance.classes.title")}
                    </h2>
                    <p className={setupStyles.muted}>{t("attendance.today", { date: list.todayBs ?? list.today })}</p>
                  </div>
                  <ul className={setupStyles.list}>
                    {others.map((c) => (
                      <li key={c.id} className={setupStyles.item}>
                        <h3 className={setupStyles.itemTitle}>
                          <Link href={`/portal/attendance/class?id=${c.id}`} aria-label={t("attendance.classes.open", { name: className(c) })}>
                            {className(c)}
                          </Link>
                        </h3>
                        <div className={setupStyles.badges}>
                          {c.markedToday ? <Badge tone="ok">{t("attendance.classes.marked", { absent: c.absentToday, students: c.students })}</Badge> : <Badge>{t("attendance.classes.notMarked")}</Badge>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {list.classes.length === 0 ? <Notice>{overseer ? t("attendance.classes.empty") : t("attendance.classes.none")}</Notice> : null}
            </>
          );
        }}
      </Gate>
    </div>
  );
}
