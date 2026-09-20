import type { ReactNode } from "react";

import styles from "./Table.module.css";

/**
 * A data table that scrolls sideways inside its own box on a narrow screen, so the page itself
 * never scrolls sideways. The caption names the table for screen readers; it is hidden unless
 * `showCaption` is set.
 */
export function Table({ caption, showCaption = false, children }: { caption: string; showCaption?: boolean; children: ReactNode }) {
  return (
    <div className={styles.scroll} tabIndex={0} role="region" aria-label={caption}>
      <table className={styles.table}>
        <caption className={showCaption ? styles.caption : "sr-only"}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
