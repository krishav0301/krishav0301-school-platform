"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";
import setupStyles from "@/setup/setup.module.css";

/** The Co-ordinator reviews and can walk a student straight in; the Accountant only registers and searches (D-063). */
export function AdmissionsTabs({ pathname }: { pathname: string }) {
  const { me } = useSession();
  const isCoordinator = me?.roles.some((r) => r.role === "coordinator" || r.role === "super_admin") ?? false;
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    ...(isCoordinator ? [{ href: "/portal/admissions", label: t("admissions.tab.queue") }] : []),
    { href: "/portal/admissions/register", label: t(isCoordinator ? "admissions.tab.walkIn" : "admissions.tab.register") },
    { href: "/portal/admissions/search", label: t("admissions.tab.search") },
  ];

  return (
    <nav aria-label={t("admissions.tabs")}>
      <ul className={setupStyles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} className={setupStyles.tab} aria-current={here === tab.href ? "page" : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdmissionsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <PortalShell>
      <div className={setupStyles.page}>
        <AdmissionsTabs pathname={pathname} />
        {children}
      </div>
    </PortalShell>
  );
}
