import Link from "next/link";

import { t } from "@/i18n/messages";
import { buttonClass } from "@/ui";

import type { SiteContent } from "./model";
import styles from "./site.module.css";

/** The admission steps in order, and the one thing to do next: get in touch. */
export function AdmissionView({ site }: { site: SiteContent }) {
  return (
    <div className={styles.stack}>
      <p className={styles.intro}>{site.admission.intro}</p>
      <ol className={styles.steps}>
        {site.admission.steps.map((step, index) => (
          <li key={index} className={styles.step}>
            <span className={styles.stepNumber}>{t("site.step", { number: index + 1 })}</span>
            <h2 className={styles.itemTitle}>{step.title}</h2>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <div>
        <Link href="/contact" className={`${buttonClass()} ${styles.wrapLabel}`}>
          {t("site.admission.contact")}
        </Link>
      </div>
    </div>
  );
}
