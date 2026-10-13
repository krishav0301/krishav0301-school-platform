"use client";

import { t } from "@/i18n/messages";

import styles from "./scroll.module.css";
import { useReveal } from "./useReveal";

/** A full-width band with the school's own line, large, and its welcome beneath it, both centred. */
export function SchoolBand({ quote, intro }: { quote?: string; intro: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className={styles.band} aria-labelledby="school-heading">
      <h2 id="school-heading" className="sr-only">
        {t("scroll.school.heading")}
      </h2>
      <div ref={ref} className={`${styles.bandText} ${styles.reveal}`}>
        {quote ? <p className={styles.bandQuote}>{quote}</p> : null}
        <p className={quote ? styles.bandIntro : undefined}>{intro}</p>
      </div>
    </section>
  );
}
