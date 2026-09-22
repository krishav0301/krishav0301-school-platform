"use client";

import Link from "next/link";

import { t } from "@/i18n/messages";
import setupStyles from "@/setup/setup.module.css";

/** The two People screens. Exactly one is marked current; a trailing slash in the address makes no difference. */
export function PeopleTabs({ pathname }: { pathname: string }) {
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const tabs = [
    { href: "/portal/people", label: t("people.tab.staff") },
    { href: "/portal/people/teaching", label: t("people.tab.teaching") },
  ];

  return (
    <nav aria-label={t("people.tabs")}>
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
