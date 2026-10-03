"use client";

import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Globe,
  NotebookPen,
  PencilLine,
  Receipt,
  School,
  Search,
  UserCheck,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { useConfig } from "@/config/ConfigProvider";
import { Panel } from "@/read/ReadView";
import { t, type MessageKey } from "@/i18n/messages";
import styles from "@/settings/settings.module.css";
import { Card } from "@/ui";

/**
 * "What you can do" on each role's home page (the PM, 2026-10-01: every person should see and understand their role).
 * Each line is a page that exists and that role uses; the API still decides what they may do there (D-025). A line
 * for a module the school has switched off is left out. The Principal's home is the dashboard (D-088), so not here.
 */
interface Line {
  href: string;
  icon: LucideIcon;
  title: MessageKey;
  module?: string;
}

export const ROLE_BRIEFS: Record<"coordinator" | "accountant" | "teacher" | "student", { intro: MessageKey; lines: Line[] }> = {
  coordinator: {
    intro: "brief.coordinator",
    lines: [
      { href: "/portal/setup", icon: School, title: "brief.coordinator.setup" },
      { href: "/portal/people", icon: UserPlus, title: "brief.coordinator.teachers" },
      { href: "/portal/admissions", icon: ClipboardList, title: "brief.coordinator.admissions" },
      { href: "/portal/attendance/teachers", icon: UserCheck, title: "brief.coordinator.teacherAttendance", module: "attendance" },
      { href: "/portal/results/review", icon: ClipboardCheck, title: "brief.coordinator.results", module: "results" },
      { href: "/portal/content", icon: Globe, title: "brief.coordinator.website" },
    ],
  },
  accountant: {
    intro: "brief.accountant",
    lines: [
      { href: "/portal/fees/structures", icon: FileText, title: "brief.accountant.structures", module: "fees" },
      { href: "/portal/fees", icon: Wallet, title: "brief.accountant.payments", module: "fees" },
      { href: "/portal/fees/vouchers", icon: Receipt, title: "brief.accountant.vouchers", module: "fees" },
      { href: "/portal/fees/dues", icon: Search, title: "brief.accountant.dues", module: "fees" },
      { href: "/portal/admissions/register", icon: ClipboardList, title: "brief.accountant.register" },
    ],
  },
  teacher: {
    intro: "brief.teacher",
    lines: [
      { href: "/portal/attendance", icon: CalendarCheck, title: "brief.teacher.attendance", module: "attendance" },
      { href: "/portal/classwork", icon: PencilLine, title: "brief.teacher.activity" },
      { href: "/portal/classwork/notes", icon: BookOpen, title: "brief.teacher.notes", module: "notes" },
      { href: "/portal/classwork/homework", icon: NotebookPen, title: "brief.teacher.homework", module: "homework" },
      { href: "/portal/results", icon: ClipboardCheck, title: "brief.teacher.marks", module: "results" },
    ],
  },
  student: {
    intro: "brief.student",
    lines: [
      { href: "/portal/attendance/mine", icon: CalendarDays, title: "brief.student.attendance", module: "attendance" },
      { href: "/portal/classwork/homework", icon: NotebookPen, title: "brief.student.homework", module: "homework" },
      { href: "/portal/fees", icon: Wallet, title: "brief.student.fees", module: "fees" },
      { href: "/portal/results", icon: ClipboardCheck, title: "brief.student.results", module: "results" },
    ],
  },
};

function BriefLinks({ role }: { role: keyof typeof ROLE_BRIEFS }) {
  const { config } = useConfig();
  // Same rule as the menu: a module this school uses; an unlisted one counts as on only when the config says so.
  const lines = ROLE_BRIEFS[role].lines.filter((line) => !line.module || config?.modules[line.module] !== false);
  return (
    <ul className={styles.links}>
      {lines.map((line) => (
        <li key={line.href + line.title}>
          <Link href={line.href} className={styles.link}>
            <line.icon aria-hidden className={styles.linkIcon} strokeWidth={1.75} />
            <span className={styles.linkText}>
              <span className={styles.linkTitle}>{t(line.title)}</span>
            </span>
            <ChevronRight aria-hidden className={styles.icon} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RoleBrief({ role }: { role: keyof typeof ROLE_BRIEFS }) {
  const { term } = useConfig();
  const id = `brief-${role}`;
  return (
    <Card aria-labelledby={id} className={styles.card}>
      <h2 id={id} className={styles.heading}>
        {t("brief.title", { role: term(`role.${role}`) })}
      </h2>
      <p className={styles.linkDetail}>{t(ROLE_BRIEFS[role].intro)}</p>
      <BriefLinks role={role} />
    </Card>
  );
}

/** The same brief as a card among the read patterns (the Co-ordinator's home, D-106). */
export function RoleBriefLinks({ role }: { role: keyof typeof ROLE_BRIEFS }) {
  const { term } = useConfig();
  return (
    <Panel title={t("brief.title", { role: term(`role.${role}`) })} labelledBy={`brief-${role}`}>
      <p className={styles.linkDetail}>{t(ROLE_BRIEFS[role].intro)}</p>
      <BriefLinks role={role} />
    </Panel>
  );
}
