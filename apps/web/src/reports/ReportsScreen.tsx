"use client";

import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  FilePen,
  FileSpreadsheet,
  History,
  KeyRound,
  ListChecks,
  NotebookPen,
  Presentation,
  ReceiptText,
  School,
  Search,
  Trophy,
  UserCheck,
  UserSearch,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { Panel, ReadHeader, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import styles from "@/settings/settings.module.css";
import { termWords } from "@/setup/model";

/** One place to look. Every entry is a page that already exists; the API decides what the person may see there (D-025). */
interface Entry {
  href: string;
  icon: LucideIcon;
  title: MessageKey;
  detail: MessageKey;
}

/** Who a group is for: the Co-ordinator has no fees view and no oversight pages, so those groups are the Principal's. */
const EVERYONE = ["admin", "coordinator", "super_admin"] as const;
const PRINCIPAL = ["admin", "super_admin"] as const;

export const REPORT_GROUPS: { title: MessageKey; roles: readonly string[]; entries: Entry[] }[] = [
  {
    title: "reports.group.setup",
    roles: EVERYONE,
    entries: [
      { href: "/portal/setup", icon: CalendarRange, title: "reports.years", detail: "reports.yearsDetail" },
      { href: "/portal/classes", icon: School, title: "reports.classes", detail: "reports.classesDetail" },
      { href: "/portal/setup/terminals", icon: CalendarClock, title: "reports.terminals", detail: "reports.terminalsDetail" },
      { href: "/portal/setup/subjects", icon: BookOpen, title: "reports.subjects", detail: "reports.subjectsDetail" },
      { href: "/portal/setup/curriculum", icon: ListChecks, title: "reports.curriculum", detail: "reports.curriculumDetail" },
      { href: "/portal/setup/teaching", icon: Presentation, title: "reports.teaching", detail: "reports.teachingDetail" },
    ],
  },
  {
    title: "reports.group.students",
    roles: EVERYONE,
    entries: [
      { href: "/portal/admissions/search", icon: Search, title: "reports.students", detail: "reports.studentsDetail" },
      { href: "/portal/attendance", icon: CalendarDays, title: "reports.attendance", detail: "reports.attendanceDetail" },
      { href: "/portal/attendance/teachers", icon: UserCheck, title: "reports.teacherAttendance", detail: "reports.teacherAttendanceDetail" },
      { href: "/portal/classwork", icon: NotebookPen, title: "reports.classwork", detail: "reports.classworkDetail" },
    ],
  },
  {
    title: "reports.group.money",
    roles: PRINCIPAL,
    entries: [
      { href: "/portal/fees", icon: UserSearch, title: "reports.feeAccounts", detail: "reports.feeAccountsDetail" },
      { href: "/portal/fees/structures", icon: ReceiptText, title: "reports.structures", detail: "reports.structuresDetail" },
      { href: "/portal/fees/dues", icon: Wallet, title: "reports.dues", detail: "reports.duesDetail" },
    ],
  },
  {
    title: "reports.group.results",
    roles: EVERYONE,
    entries: [
      { href: "/portal/results/rechecks", icon: FilePen, title: "reports.changes", detail: "reports.changesDetail" },
      { href: "/portal/results/sheets", icon: FileSpreadsheet, title: "reports.sheets", detail: "reports.sheetsDetail" },
      { href: "/portal/results/top20", icon: Trophy, title: "reports.top20", detail: "reports.top20Detail" },
    ],
  },
  {
    title: "reports.group.oversight",
    roles: PRINCIPAL,
    entries: [
      { href: "/portal/reports/activity", icon: History, title: "reports.activity", detail: "reports.activityDetail" },
      { href: "/portal/reports/sign-ins", icon: KeyRound, title: "reports.signIns", detail: "reports.signInsDetail" },
    ],
  },
];

/** Reports (D-091, redesigned in D-104): everything the Principal reads but does not change, grouped, one tap from here. No figures: a calm directory. */
export function ReportsScreen() {
  const { term } = useConfig();
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const words = termWords(term);
  const groups = REPORT_GROUPS.filter((group) => group.roles.some((r) => roles.includes(r)));
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("reports.title")} subtitle={t("reports.intro")} />
      <div className={readStyles.groups}>
        {groups.map((group) => (
          <Panel key={group.title} title={t(group.title)} labelledBy={group.title}>
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
          </Panel>
        ))}
      </div>
    </div>
  );
}
