"use client";

import { t } from "@/i18n/messages";

import styles from "./scroll.module.css";
import { useReveal } from "./useReveal";

/**
 * The class groups, in two columns on a wide screen: the heading stays in view on the left while a card for each
 * group scrolls past on the right. On a phone the columns stack and nothing sticks. Shows nothing when there are none.
 */
export function Batches({ batches }: { batches: { title: string; note?: string }[] }) {
  if (batches.length === 0) return null;
  return (
    <section className={styles.batches} aria-labelledby="batches-title">
      <div className={styles.batchesPin}>
        <h2 id="batches-title" className={styles.sectionTitle}>
          {t("scroll.batches.title")}
        </h2>
        <p className={styles.sectionLead}>{t("scroll.batches.lead")}</p>
      </div>
      <ol className={styles.batchList}>
        {batches.map((batch, i) => (
          <BatchCard key={batch.title} number={i + 1} title={batch.title} note={batch.note} />
        ))}
      </ol>
    </section>
  );
}

function BatchCard({ number, title, note }: { number: number; title: string; note?: string }) {
  const ref = useReveal<HTMLLIElement>();
  return (
    <li ref={ref} className={`${styles.batchCard} ${styles.reveal}`}>
      <span className={styles.batchNumber} aria-hidden>
        {String(number).padStart(2, "0")}
      </span>
      <h3 className={styles.batchTitle}>{title}</h3>
      {note ? <p className={styles.muted}>{note}</p> : null}
    </li>
  );
}
