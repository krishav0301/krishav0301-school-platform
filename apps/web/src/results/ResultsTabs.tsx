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
 * The results places for staff. The Co-ordinator reviews and publishes, answers rechecks, keeps elective picks; the
 * Admin reads the class sheets and every post-publish change. A teacher and a student have one place each, so no tabs.
 */
export function ResultsTabs({ pathname }: { pathname: string }) {
  const { me } = useSession();
  const { moduleEnabled } = useConfig();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const coordinator = roles.some((r) => r === "coordinator" || r === "super_admin");
  const admin = roles.includes("admin");
  if (!coordinator && !admin) return null;
  const top20 = moduleEnabled("top20");
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    ...(coordinator
      ? [
          {
            href: "/portal/results",
            label: t("results.tab.review"),
            current: here === "/portal/results" || here.startsWith("/portal/results/review"),
          },
        ]
      : []),
    {
      href: "/portal/results/rechecks",
      label: t(coordinator ? "results.tab.rechecks" : "results.tab.changes"),
      current: here.startsWith("/portal/results/rechecks") || (!coordinator && here === "/portal/results"),
    },
    {
      href: "/portal/results/sheets",
      label: t("results.tab.sheets"),
      current: here.startsWith("/portal/results/sheets") || here.startsWith("/portal/results/card"),
    },
    ...(coordinator
      ? [
          {
            href: "/portal/results/electives",
            label: t("results.tab.electives"),
            current: here.startsWith("/portal/results/electives"),
          },
        ]
      : []),
    ...(top20
      ? [
          {
            href: "/portal/results/top20",
            label: t("results.tab.top20"),
            current: here.startsWith("/portal/results/top20"),
          },
        ]
      : []),
  ];
  return (
    <nav aria-label={t("results.tabs")}>
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

export function ResultsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <PortalShell>
      <div className={setupStyles.page}>
        <ResultsTabs pathname={pathname} />
        {children}
      </div>
    </PortalShell>
  );
}
