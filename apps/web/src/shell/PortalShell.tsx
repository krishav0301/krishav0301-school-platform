"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { ConfigGate } from "@/config/ConfigGate";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button, Skeleton, Spinner } from "@/ui";

import { NAV_ITEMS, visibleNav, type NavItem } from "./nav";
import styles from "./shell.module.css";

/**
 * The frame around every signed-in page: header, menu, page. The layout is the same for every
 * school (CLAUDE.md rule 6); only colours, font, corner radii, names and wording differ.
 * Someone who is not signed in is sent to the sign-in page.
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

  return (
    <div className={styles.frame}>
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/portal" className={styles.brand}>
            {config?.school.shortName ?? " "}
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
        <nav className={styles.nav} aria-label={t("shell.mainNavigation")}>
          {menu.map((item) => (
            <Link key={item.id} href={item.href} className={styles.navLink} aria-current={pathname === item.href ? "page" : undefined}>
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <main id="main" className={styles.main}>
          <ConfigGate>{children}</ConfigGate>
        </main>
      </div>
      <footer className={styles.footer}>{config ? t("shell.footer", { school: config.school.name }) : null}</footer>
    </div>
  );
}
