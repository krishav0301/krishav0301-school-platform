"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";

import { PublicHeader } from "./PublicHeader";
import { SITE_LINKS } from "./site-links";
import styles from "./shell.module.css";

/**
 * The frame around public pages: a header and a footer that both link to the public pages, and the page.
 * The header's "Sign in" is deliberately quiet, so a page's own main action stays the only prominent
 * button; on the sign-in page itself it is left out (`showSignIn={false}`), because the form is right there.
 * The footer repeats the page links, so they are reachable without the header's Menu.
 */
export function PublicShell({ children, showSignIn = true }: { children: ReactNode; showSignIn?: boolean }) {
  const { config } = useConfig();
  const school = config?.school;

  return (
    <div className={styles.frame}>
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <PublicHeader showSignIn={showSignIn} />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <nav aria-label={t("site.footerNavLabel")}>
          <ul className={styles.footerLinks}>
            {SITE_LINKS.map((link) => (
              // These links repeat the header's, which already prefetches them.
              <li key={link.href}>
                <Link href={link.href} prefetch={false} className={styles.footerLink}>
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {school ? <p>{t("shell.footer", { school: school.name })}</p> : null}
      </footer>
    </div>
  );
}
