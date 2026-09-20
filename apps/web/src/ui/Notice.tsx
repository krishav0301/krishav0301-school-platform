import type { ReactNode } from "react";

import styles from "./Notice.module.css";

type NoticeTone = "neutral" | "ok" | "bad";

/**
 * A message the person must not miss. An error is announced at once (`role="alert"`); other
 * messages are announced politely (`role="status"`).
 */
export function Notice({ tone = "neutral", title, children, className }: { tone?: NoticeTone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={[styles.notice, styles[tone], className].filter(Boolean).join(" ")}>
      {title ? <p className={styles.title}>{title}</p> : null}
      {children ? <div>{children}</div> : null}
    </div>
  );
}
