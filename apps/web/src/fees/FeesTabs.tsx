"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { PortalShell } from "@/shell/PortalShell";

/** The fee places for staff: students, structures, vouchers (the Accountant checks them), dues. A student has no tabs. */
export function FeesTabs({ pathname }: { pathname: string }) {
  const { me } = useSession();
  const roles = me?.roles.map((r) => r.role) ?? [];
  const staff = roles.some((r) => r === "accountant" || r === "admin" || r === "super_admin");
  if (!staff) return null;
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    { href: "/portal/fees", label: t("fees.tab.students"), current: here === "/portal/fees" || here.startsWith("/portal/fees/student") || here.startsWith("/portal/fees/receipt") },
    { href: "/portal/fees/structures", label: t("fees.tab.structures"), current: here.startsWith("/portal/fees/structure") },
    { href: "/portal/fees/dues", label: t("fees.tab.dues"), current: here === "/portal/fees/dues" },
    ...(roles.includes("admin") ? [{ href: "/portal/fees/discounts", label: t("fees.tab.discounts"), current: here === "/portal/fees/discounts" }] : []),
  ];
  return (
    <nav aria-label={t("fees.tabs")}>
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

export function FeesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <PortalShell>
      <div className={setupStyles.page}>
        <FeesTabs pathname={pathname} />
        {children}
      </div>
    </PortalShell>
  );
}
