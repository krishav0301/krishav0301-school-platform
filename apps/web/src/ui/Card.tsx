import type { HTMLAttributes } from "react";

import styles from "./Card.module.css";

/** A raised surface for grouping content. Give it a heading as its first child. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section {...rest} className={[styles.card, className].filter(Boolean).join(" ")} />;
}
