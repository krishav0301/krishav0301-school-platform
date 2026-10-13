import { t } from "@/i18n/messages";

import styles from "./scroll.module.css";

/** An empty page in the theme's own background, told only to a screen reader: what the front page draws until it knows which layout the school uses. */
export function HomeWaiting() {
  return (
    <div className={styles.waiting} role="status" aria-busy="true">
      <span className="sr-only">{t("config.loading")}</span>
    </div>
  );
}
