import type { HTMLAttributes } from "react";

import styles from "./Badge.module.css";

export type Tone = "neutral" | "ok" | "bad";

/**
 * A small label for a status or a role. Meaning is in the words, never in colour alone. There is
 * deliberately no brand-coloured badge: the brand colour means "you can act on this" (buttons and
 * links), so a label must not look like one.
 */
export function Badge({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span {...rest} className={[styles.badge, styles[tone], className].filter(Boolean).join(" ")} />;
}
