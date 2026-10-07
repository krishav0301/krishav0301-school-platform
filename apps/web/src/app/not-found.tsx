"use client";

import Link from "next/link";

import { t } from "@/i18n/messages";
import { PublicShell } from "@/shell/PublicShell";
import { Illustration, buttonClass } from "@/ui";

import styles from "./not-found.module.css";

/** A page that does not exist: one picture, what happened, and the way back (X1). Open to everyone. */
export default function NotFound() {
  return (
    <PublicShell>
      <div className={styles.wrap} role="status">
        <Illustration code="X1" className={styles.art} />
        <h1 className={styles.title}>{t("notFound.title")}</h1>
        <p className={styles.body}>{t("notFound.body")}</p>
        <Link href="/" className={buttonClass()}>
          {t("notFound.home")}
        </Link>
      </div>
    </PublicShell>
  );
}
