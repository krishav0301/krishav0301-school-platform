"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";

import { termWords } from "./model";
import styles from "./setup.module.css";

/** The setup screens, in the order a term is set up (D-114: Teaching after the curriculum). Exactly one is marked current; a trailing slash in the address makes no difference. */
export function SetupTabs({ pathname }: { pathname: string }) {
  const { term } = useConfig();
  const words = termWords(term);
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    { href: "/portal/setup", label: t("setup.tab.years") },
    { href: "/portal/setup/programmes", label: t("setup.tab.programmes", words) },
    { href: "/portal/setup/classes", label: t("setup.tab.classes") },
    { href: "/portal/setup/terminals", label: t("setup.tab.terminals", words) },
    { href: "/portal/setup/subjects", label: t("setup.tab.subjects") },
    { href: "/portal/setup/curriculum", label: t("setup.tab.curriculum") },
    { href: "/portal/setup/teaching", label: t("setup.tab.teaching") },
    { href: "/portal/setup/promotion", label: t("setup.tab.promotion") },
  ];

  return (
    <nav aria-label={t("setup.tabs")}>
      <ul className={styles.tabs}>
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} className={styles.tab} aria-current={here === tab.href ? "page" : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The portal frame, the sub-menu, and the screen. Who may see or change what is decided by the API. */
export function SetupLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me } = useSession();
  // The Principal (Admin) manages programmes only (D-087); the rest of setup they read from Reports (D-091), so no tabs.
  const programmesOnly = me?.roles.some((r) => r.role === "admin") && !me.roles.some((r) => r.role === "coordinator" || r.role === "super_admin");
  return (
    <PortalShell>
      <div className={styles.page}>
        {programmesOnly ? null : <SetupTabs pathname={pathname} />}
        {children}
      </div>
    </PortalShell>
  );
}
