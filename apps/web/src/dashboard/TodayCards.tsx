"use client";

import Link from "next/link";
import { useCallback } from "react";

import { loadClasses } from "@/attendance/client";
import { loadMyToday, loadOwnActivity, loadStudentAssignments, loadTeacherAssignments } from "@/classwork/client";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Card } from "@/ui";

import styles from "./dashboard.module.css";

/**
 * Phase 5 dashboards (D-073): what matters today, one line each with the place to act on it. Each line comes from an
 * API the role already uses on its own screen, so the dashboard never shows anything the screen would not.
 */

export type Line = { key: string; text: string; href: string; action: string };

export function TodayList({ lines }: { lines: Line[] }) {
  if (lines.length === 0) return <p className={setupStyles.muted}>{t("dashboard.nothing")}</p>;
  return (
    <ul className={styles.lines}>
      {lines.map((line) => (
        <li key={line.key} className={styles.line}>
          <span>{line.text}</span>
          <Link href={line.href}>{line.action}</Link>
        </li>
      ))}
    </ul>
  );
}

const failed = { ok: false as const, reason: "failed" as const };

/** A teacher's today: their class's register, the activity log still to write, homework waiting for them. */
export function TeacherTodayCard() {
  const { api } = useSession();
  const { config } = useConfig();
  const attendanceOn = config?.modules.attendance === true;
  const homeworkOn = config?.modules.homework === true;
  const loadNow = useCallback(async () => {
    const [classes, activity, work] = await Promise.all([attendanceOn ? loadClasses(api) : null, loadMyToday(api), homeworkOn ? loadTeacherAssignments(api) : null]);
    if ((classes && !classes.ok) || !activity.ok || (work && !work.ok)) return failed;
    const lines: Line[] = [];
    for (const c of classes?.ok ? classes.data.classes.filter((x) => x.mine) : []) {
      lines.push({
        key: `register-${c.id}`,
        text: c.markedToday ? t("dashboard.register.done", { absent: c.absentToday }) : t("dashboard.register.todo"),
        href: "/portal/attendance",
        action: c.markedToday ? t("dashboard.open") : t("dashboard.register.mark"),
      });
    }
    const subjects = activity.data.subjects;
    if (subjects.length > 0) {
      const written = subjects.filter((s) => s.body !== null).length;
      lines.push({ key: "activity", text: t("dashboard.activity.progress", { written, total: subjects.length }), href: "/portal/classwork", action: written < subjects.length ? t("dashboard.activity.write") : t("dashboard.open") });
    }
    if (work?.ok) {
      const waiting = work.data.assignments.filter((a) => !a.withdrawn).reduce((sum, a) => sum + a.toReview + a.requests, 0);
      if (waiting > 0) lines.push({ key: "homework", text: t("dashboard.homework.waiting", { count: waiting }), href: "/portal/classwork/homework", action: t("dashboard.homework.review") });
    }
    return { ok: true as const, data: lines };
  }, [api, attendanceOn, homeworkOn]);
  const { view, reload } = useLoad<Line[]>(loadNow);
  return (
    <Card aria-labelledby="teacher-today-heading">
      <h2 id="teacher-today-heading" className={setupStyles.subhead}>
        {t("dashboard.today")}
      </h2>
      <Gate view={view} onRetry={() => void reload()}>
        {(lines) => <TodayList lines={lines} />}
      </Gate>
    </Card>
  );
}

/** A student's classwork at a glance: homework still to hand in, the next deadline, and today's activity log. */
export function StudentTodayCard() {
  const { api } = useSession();
  const { config } = useConfig();
  const homeworkOn = config?.modules.homework === true;
  const loadNow = useCallback(async () => {
    const [work, activity] = await Promise.all([homeworkOn ? loadStudentAssignments(api) : null, loadOwnActivity(api)]);
    if ((work && !work.ok) || !activity.ok) return failed;
    const lines: Line[] = [];
    if (work?.ok) {
      const open = work.data.assignments.filter((a) => a.submission === null || a.submission.status === "resubmit_allowed");
      if (open.length > 0) lines.push({ key: "homework", text: t("dashboard.student.homework", { count: open.length }), href: "/portal/classwork/homework", action: t("dashboard.open") });
    }
    const latest = activity.data.days[0];
    if (latest) lines.push({ key: "activity", text: t("dashboard.student.activity", { date: latest.dateBs ?? latest.date }), href: "/portal/classwork", action: t("dashboard.read") });
    return { ok: true as const, data: lines };
  }, [api, homeworkOn]);
  const { view, reload } = useLoad<Line[]>(loadNow);
  return (
    <Card aria-labelledby="student-today-heading">
      <h2 id="student-today-heading" className={setupStyles.subhead}>
        {t("dashboard.classwork")}
      </h2>
      <Gate view={view} onRetry={() => void reload()}>
        {(lines) => <TodayList lines={lines} />}
      </Gate>
    </Card>
  );
}
