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
 * Classwork's places: the activity log (everyone here), notes and question papers (teachers and students; the
 * matrix gives no one else a view) and homework (teachers and students). A school's switched-off module has no tab,
 * and a row of one tab is not shown (D-030).
 */
export function ClassworkTabs({ pathname }: { pathname: string }) {
  const { me } = useSession();
  const { config } = useConfig();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const inClass = roles.includes("teacher") || roles.includes("student");
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    { href: "/portal/classwork", label: t("classwork.tab.activity"), current: here === "/portal/classwork" || here.startsWith("/portal/classwork/class") },
    ...(inClass && config?.modules.notes === true ? [{ href: "/portal/classwork/notes", label: t("classwork.tab.notes"), current: here === "/portal/classwork/notes" }] : []),
    ...(inClass && config?.modules.homework === true ? [{ href: "/portal/classwork/homework", label: t("classwork.tab.homework"), current: here.startsWith("/portal/classwork/homework") }] : []),
  ];
  if (tabs.length < 2) return null;

  return (
    <nav aria-label={t("classwork.tabs")}>
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

export function ClassworkLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <PortalShell>
      <div className={setupStyles.page}>
        <ClassworkTabs pathname={pathname} />
        {children}
      </div>
    </PortalShell>
  );
}
