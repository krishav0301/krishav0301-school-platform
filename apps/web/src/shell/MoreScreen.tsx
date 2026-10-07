"use client";

import Link from "next/link";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";

import { NAV_ITEMS, splitNav, visibleNav, type NavItem } from "./nav";
import styles from "./shell.module.css";

/**
 * The list behind the phone's "More" tab (Apple, `tab-bars.md › Avoid overflow tabs`: the trailing tab becomes More,
 * revealing the remaining items in a separate list). On a wide screen the sidebar already shows these.
 */
export function MoreScreen({ items = NAV_ITEMS }: { items?: readonly NavItem[] }) {
  const { me } = useSession();
  const { config } = useConfig();
  if (!me) return null;
  const { more } = splitNav(visibleNav(items, me.roles, config?.modules ?? {}));

  return (
    <>
      <h1 className={styles.moreTitle}>{t("more.title")}</h1>
      <ul className={styles.moreList}>
        {more.map((item) => (
          <li key={item.id}>
            <Link href={item.opensAt ?? item.href} className={styles.moreItem}>
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
