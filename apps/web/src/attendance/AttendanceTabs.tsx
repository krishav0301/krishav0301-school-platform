"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { PortalShell } from "@/shell/PortalShell";

/**
 * Attendance's own places: students (every role here), teachers (the Co-ordinator marks, the Admin looks) and a
 * teacher's own month. A row of one tab is not shown (D-030).
 */
export function AttendanceTabs({ pathname }: { pathname: string }) {
  const { me } = useSession();
  const { config } = useConfig();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const teacherModule = config?.modules.teacher_attendance === true;
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    { href: "/portal/attendance", label: t("attendance.tab.students"), current: here === "/portal/attendance" || here.startsWith("/portal/attendance/class") },
    ...(teacherModule && roles.some((r) => r === "coordinator" || r === "admin" || r === "super_admin")
      ? [{ href: "/portal/attendance/teachers", label: t("attendance.tab.teachers"), current: here === "/portal/attendance/teachers" }]
      : []),
    ...(teacherModule && roles.includes("teacher") ? [{ href: "/portal/attendance/mine", label: t("attendance.tab.mine"), current: here === "/portal/attendance/mine" }] : []),
  ];
  if (tabs.length < 2) return null;

  return (
    <nav aria-label={t("attendance.tabs")}>
      <ul className={setupStyles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} className={setupStyles.tab} aria-current={tab.current ? "page" : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AttendanceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <PortalShell>
      <div className={setupStyles.page}>
        <AttendanceTabs pathname={pathname} />
        {children}
      </div>
    </PortalShell>
  );
}
