"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Skeleton, buttonClass } from "@/ui";

import styles from "./shell.module.css";

/**
 * The public header, drawn from its state so every case can be checked without a browser: the school's name, and Sign in.
 * There is no menu of pages (PM, 2026-10-18, D-177: the old public pages are gone). Sign in is quiet on purpose, so a page's
 * own main action stays the only prominent button.
 */
export function PublicHeaderView({ brand, signedIn, showSignIn }: { brand: ReactNode; signedIn: boolean; showSignIn: boolean }) {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link href="/" className={styles.brand}>
          {brand}
        </Link>
        <div className={styles.actions}>
          {signedIn ? (
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
  );
}

export function PublicHeader({ showSignIn }: { showSignIn: boolean }) {
  const { config } = useConfig();
  const { status } = useSession();
  return <PublicHeaderView brand={config?.school.shortName ?? <Skeleton width="7rem" />} signedIn={status === "signedIn"} showSignIn={showSignIn} />;
}
