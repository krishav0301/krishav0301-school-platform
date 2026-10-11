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
  Workflow,
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
  /** The module this page belongs to (or any one of several): it is left out while they are off (D-137). */
  module?: string | readonly string[];
  href: string;
  icon: LucideIcon;
  title: MessageKey;
  detail: MessageKey;
}

const isOn = (spec: string | readonly string[] | undefined, moduleEnabled: (key: string) => boolean): boolean => spec === undefined || (typeof spec === "string" ? [spec] : spec).some(moduleEnabled);

/** Who a group is for: the Co-ordinator has no fees view and no oversight pages, so those groups are the Principal's. */
const EVERYONE = ["admin", "coordinator", "super_admin"] as const;
const PRINCIPAL = ["admin", "super_admin"] as const;

export const REPORT_GROUPS: { title: MessageKey; roles: readonly string[]; /** The module this group belongs to: it is left out while the module is off (D-137). */ module?: string | readonly string[]; entries: Entry[] }[] = [
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
      { href: "/portal/setup/map", icon: Workflow, title: "reports.map", detail: "reports.mapDetail" },
    ],
  },
  {
    title: "reports.group.students",
    roles: EVERYONE,
    entries: [
      { href: "/portal/admissions/search", icon: Search, title: "reports.students", detail: "reports.studentsDetail" },
      { module: "attendance", href: "/portal/attendance", icon: CalendarDays, title: "reports.attendance", detail: "reports.attendanceDetail" },
      { module: "teacher_attendance", href: "/portal/attendance/teachers", icon: UserCheck, title: "reports.teacherAttendance", detail: "reports.teacherAttendanceDetail" },
      { module: ["activity_log", "homework", "notes"], href: "/portal/classwork", icon: NotebookPen, title: "reports.classwork", detail: "reports.classworkDetail" },
    ],
  },
  {
    title: "reports.group.money",
    roles: PRINCIPAL,
    module: "fees",
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
      { module: "top20", href: "/portal/results/top20", icon: Trophy, title: "reports.top20", detail: "reports.top20Detail" },
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
  const { term, moduleEnabled } = useConfig();
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const words = termWords(term);
  const groups = REPORT_GROUPS.filter((group) => group.roles.some((r) => roles.includes(r)) && isOn(group.module, moduleEnabled))
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => isOn(entry.module, moduleEnabled)) }))
    .filter((group) => group.entries.length > 0)
    // A school with no attendance and no classwork has only students here, so the group says so (the PM, 2026-10-11).
    .map((group) => (group.title === "reports.group.students" && group.entries.every((entry) => entry.module === undefined) ? { ...group, title: "reports.group.studentsOnly" as MessageKey } : group));
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
