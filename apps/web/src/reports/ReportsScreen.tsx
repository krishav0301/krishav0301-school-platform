"use client";

import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  FileSpreadsheet,
  ListChecks,
  Presentation,
  School,
  Search,
  Trophy,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import setupStyles from "@/setup/setup.module.css";
import styles from "@/settings/settings.module.css";
import { termWords } from "@/setup/model";
import { Card } from "@/ui";

/** One place to look. Every entry is a page that already exists; the API decides what the person may see there (D-025). */
interface Entry {
  href: string;
  icon: LucideIcon;
  title: MessageKey;
  detail: MessageKey;
}

export const REPORT_GROUPS: { title: MessageKey; entries: Entry[] }[] = [
  {
    title: "reports.group.setup",
    entries: [
      { href: "/portal/setup", icon: CalendarRange, title: "reports.years", detail: "reports.yearsDetail" },
      { href: "/portal/setup/classes", icon: School, title: "reports.classes", detail: "reports.classesDetail" },
      { href: "/portal/setup/terminals", icon: CalendarClock, title: "reports.terminals", detail: "reports.terminalsDetail" },
      { href: "/portal/setup/subjects", icon: BookOpen, title: "reports.subjects", detail: "reports.subjectsDetail" },
      { href: "/portal/setup/curriculum", icon: ListChecks, title: "reports.curriculum", detail: "reports.curriculumDetail" },
      { href: "/portal/people/teaching", icon: Presentation, title: "reports.teaching", detail: "reports.teachingDetail" },
    ],
  },
  {
    title: "reports.group.students",
    entries: [
      { href: "/portal/admissions/search", icon: Search, title: "reports.students", detail: "reports.studentsDetail" },
      { href: "/portal/attendance", icon: CalendarDays, title: "reports.attendance", detail: "reports.attendanceDetail" },
      { href: "/portal/attendance/teachers", icon: UserCheck, title: "reports.teacherAttendance", detail: "reports.teacherAttendanceDetail" },
    ],
  },
  {
    title: "reports.group.money",
    entries: [{ href: "/portal/fees/dues", icon: Wallet, title: "reports.dues", detail: "reports.duesDetail" }],
  },
  {
    title: "reports.group.results",
    entries: [
      { href: "/portal/results/sheets", icon: FileSpreadsheet, title: "reports.sheets", detail: "reports.sheetsDetail" },
      { href: "/portal/results/top20", icon: Trophy, title: "reports.top20", detail: "reports.top20Detail" },
    ],
  },
];

/** Reports (D-091): everything the Principal reads but does not change, grouped, one tap from here. */
export function ReportsScreen() {
  const { term } = useConfig();
  const words = termWords(term);
  return (
    <div className={styles.page}>
      <h1 className={setupStyles.title}>{t("reports.title")}</h1>
      <p className={setupStyles.muted}>{t("reports.intro")}</p>
      {REPORT_GROUPS.map((group) => (
        <Card key={group.title} aria-labelledby={group.title} className={styles.card}>
          <h2 id={group.title} className={styles.heading}>
            {t(group.title)}
          </h2>
          <ul className={styles.links}>
            {group.entries.map((entry) => (
              <li key={entry.href}>
                <Link href={entry.href} className={styles.link}>
                  <entry.icon aria-hidden className={styles.linkIcon} strokeWidth={1.75} />
                  <span className={styles.linkText}>
                    <span className={styles.linkTitle}>{t(entry.title, words)}</span>
                    <span className={styles.linkDetail}>{t(entry.detail, words)}</span>
                  </span>
                  <ChevronRight aria-hidden className={styles.icon} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
