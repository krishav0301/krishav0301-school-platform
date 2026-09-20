"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { buttonClass } from "@/ui";

import styles from "./shell.module.css";

/** The frame around public pages: the school's name, a way in, and the page. */
export function PublicShell({ children }: { children: ReactNode }) {
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
            {school?.shortName ?? " "}
          </Link>
          <div className={styles.actions}>
            {status === "signedIn" ? null : (
              <Link href="/sign-in" className={buttonClass({ variant: "primary" })}>
                {t("shell.signIn")}
              </Link>
            )}
            {status === "signedIn" ? (
              <Link href="/portal" className={buttonClass({ variant: "secondary" })}>
                {t("nav.dashboard")}
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
