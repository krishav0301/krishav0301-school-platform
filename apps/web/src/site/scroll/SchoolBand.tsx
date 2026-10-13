"use client";

import { t } from "@/i18n/messages";

import styles from "./scroll.module.css";
import { useReveal } from "./useReveal";

/** A full-width band with the school's own line, large (one line of it per row), and its welcome beneath it, both centred. */
export function SchoolBand({ quote, intro }: { quote?: string; intro: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className={styles.band} aria-labelledby="school-heading">
      <h2 id="school-heading" className="sr-only">
        {t("scroll.school.heading")}
      </h2>
      <div ref={ref} className={`${styles.bandText} ${styles.reveal}`}>
        {quote ? (
          <p className={styles.bandQuote}>
            {quote.split("\n").map((line) => (
              <span key={line} className={styles.bandQuoteLine}>
                {line}
              </span>
            ))}
          </p>
        ) : null}
        <p className={quote ? styles.bandIntro : undefined}>{intro}</p>
      </div>
    </section>
  );
}
