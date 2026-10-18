"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";

import { PublicHeader } from "./PublicHeader";
import styles from "./shell.module.css";

/**
 * The frame around the public pages that are left (notices, privacy, reset password): a header with the school's name and Sign
 * in, and a footer with the privacy notice. The header's "Sign in" is deliberately quiet, so a page's own main action stays the
 * only prominent button; on the sign-in page itself it is left out (`showSignIn={false}`), because the form is right there.
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
        {school ? <p>{t("shell.footer", { school: school.name })}</p> : null}
        <p>
          <Link href="/privacy" prefetch={false} className={styles.footerLink}>
            {t("shell.privacy")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
