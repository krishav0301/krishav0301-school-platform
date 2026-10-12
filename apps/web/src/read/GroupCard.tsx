"use client";

import { ChevronDown } from "lucide-react";
import { useId, type ReactNode } from "react";

import styles from "@/classes/classes.module.css";
import accessStyles from "@/people/people-access.module.css";

/** Each card's soft tint, in turn, from the theme's tones (never a colour of its own), as on Classes. */
export const GROUP_TONES = ["primary", "ok", "accent", "warn"] as const;

/** A column of group cards. */
export function GroupList({ children }: { children: ReactNode }) {
  return <ul className={styles.courses}>{children}</ul>;
}

/**
 * The card the Classes page groups by (the PM, 2026-10-12): a tinted head with an icon, a title and a line under it, a few
 * counts, and an arrow that opens what is inside. What is inside is only drawn while the card is open. Theme tokens only.
 */
export function GroupCard({
  title,
  subtitle,
  icon,
  tone,
  stats,
  open,
  onToggle,
  toggleLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  tone: string;
  stats: readonly { label: string; value: string | number }[];
  open: boolean;
  onToggle: () => void;
  /** What the arrow says to a screen reader, already worded for the open or closed state. */
  toggleLabel: string;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <li className={styles.course} data-tone={tone}>
      <div className={styles.courseHead}>
        <span className={accessStyles.tile} data-tone={tone} aria-hidden>
          {icon}
        </span>
        <div className={styles.courseName}>
          <h2 className={styles.courseTitle}>{title}</h2>
          {subtitle ? <p className={styles.muted}>{subtitle}</p> : null}
        </div>
        {stats.length > 0 ? (
          <dl className={styles.stats}>
            {stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={toggleLabel} onClick={onToggle}>
          <ChevronDown aria-hidden data-open={open} />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className={styles.levels}>
          {children}
        </div>
      ) : null}
    </li>
  );
}
