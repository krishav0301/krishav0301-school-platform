"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button, Skeleton, Spinner } from "@/ui";

import { MORE_HREF, NAV_ITEMS, isCurrent, showsMenu, splitNav, visibleNav, type NavItem } from "./nav";
import styles from "./shell.module.css";

/**
 * The frame around every signed-in page: header, menu, page. The layout is the same for every
 * school (CLAUDE.md rule 6); only colours, font, corner radii, names and wording differ.
 * The menu is a bottom tab bar on a phone and a sidebar on a wide screen, and is left out while
 * there is only one place to go. Someone who is not signed in is sent to the sign-in page.
 */
export function PortalShell({ children, items = NAV_ITEMS }: { children: ReactNode; items?: readonly NavItem[] }) {
  const { status, me, signOut } = useSession();
  const { config } = useConfig();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "signedOut") router.replace("/sign-in");
  }, [status, router]);

  if (status !== "signedIn" || !me) {
    return (
      <div className={styles.frame}>
        <main className={`${styles.main} ${styles.centered}`}>
          <Spinner label={t("portal.checking")} />
          <Skeleton width="12rem" />
        </main>
      </div>
    );
  }

  const menu = visibleNav(items, me.roles, config?.modules ?? {});
  const hasMenu = showsMenu(menu);
  // On a phone, entries past the tab bar's room are listed under a last "More" tab; the sidebar shows them all.
  const { more } = splitNav(menu);
  const overflow = new Set(more.map((item) => item.id));
  const inMore = pathname === MORE_HREF || more.some((item) => isCurrent(pathname, item.href));

  return (
    <div className={`${styles.frame} ${hasMenu ? styles.withTabs : ""}`}>
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/portal" className={styles.brand}>
            {config?.school.shortName ?? <Skeleton width="7rem" />}
          </Link>
          <div className={styles.actions}>
            <span className={styles.who}>{t("shell.signedInAs", { name: me.name })}</span>
            <Button variant="secondary" onClick={() => void signOut()}>
              {t("shell.signOut")}
            </Button>
          </div>
        </div>
      </header>
      <div className={styles.body}>
        {hasMenu ? (
          <nav className={styles.nav} aria-label={t("shell.mainNavigation")}>
            {menu.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={[styles.navLink, overflow.has(item.id) ? styles.overflow : ""].filter(Boolean).join(" ")}
                aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
              >
                {t(item.labelKey)}
              </Link>
            ))}
            {more.length > 0 ? (
              <Link href={MORE_HREF} className={`${styles.navLink} ${styles.moreLink}`} aria-current={inMore ? "page" : undefined}>
                {t("nav.more")}
              </Link>
            ) : null}
          </nav>
        ) : null}
        <main id="main" className={styles.main}>
          <ConfigGate>{children}</ConfigGate>
        </main>
      </div>
    </div>
  );
}
