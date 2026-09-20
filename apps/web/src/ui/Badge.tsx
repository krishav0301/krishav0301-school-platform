import type { HTMLAttributes } from "react";

import styles from "./Badge.module.css";

export type Tone = "neutral" | "ok" | "bad" | "primary";

/** A small label for a status or a role. Meaning is in the words, never in colour alone. */
export function Badge({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span {...rest} className={[styles.badge, styles[tone], className].filter(Boolean).join(" ")} />;
}
