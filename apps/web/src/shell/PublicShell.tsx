"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Skeleton, buttonClass } from "@/ui";

import styles from "./shell.module.css";

/**
 * The frame around public pages: the school's name, a way in, and the page. The header's "Sign in"
 * is deliberately quiet, so a page's own main action stays the only prominent button; on the
 * sign-in page itself it is left out (`showSignIn={false}`), because the form is right there.
 */
export function PublicShell({ children, showSignIn = true }: { children: ReactNode; showSignIn?: boolean }) {
  const { config } = useConfig();
  const { status } = useSession();
  const school = config?.school;

  return (
    <div className={styles.frame}>
      <a href="#main" className={styles.skip}>
        {t("shell.skipToContent")}
      </a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/" className={styles.brand}>
            {school?.shortName ?? <Skeleton width="7rem" />}
          </Link>
          <div className={styles.actions}>
            {status === "signedIn" ? (
              <Link href="/portal" className={buttonClass({ variant: "secondary" })}>
                {t("nav.dashboard")}
              </Link>
            ) : showSignIn ? (
              <Link href="/sign-in" className={buttonClass({ variant: "quiet" })}>
                {t("shell.signIn")}
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>{school ? t("shell.footer", { school: school.name }) : null}</footer>
    </div>
  );
}
