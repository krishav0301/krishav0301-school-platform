"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";
import setupStyles from "@/setup/setup.module.css";

/**
 * The Co-ordinator reviews and can walk a student straight in; the Accountant registers and searches (D-063); the
 * Principal only searches, so is offered neither form (admin FUT F-08). A menu of one entry is not shown (D-030).
 */
export function AdmissionsTabs({ pathname }: { pathname: string }) {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const isCoordinator = roles.some((r) => r === "coordinator" || r === "super_admin");
  const mayRegister = isCoordinator || roles.includes("accountant");
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    ...(isCoordinator ? [{ href: "/portal/admissions", label: t("admissions.tab.queue") }] : []),
    ...(mayRegister ? [{ href: "/portal/admissions/register", label: t(isCoordinator ? "admissions.tab.walkIn" : "admissions.tab.register") }] : []),
    { href: "/portal/admissions/search", label: t("admissions.tab.search") },
  ];
  if (tabs.length < 2) return null;

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
