"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { t } from "@/i18n/messages";

import styles from "./SidePanel.module.css";

/**
 * A review panel at the side of a wide screen and over the whole of a phone's, after the Approvals review (D-102),
 * shared so every "open one thing and decide" looks and behaves the same (D-106). The native modal dialog keeps focus
 * inside, Escape closes it unless something is being saved, and the button that opened it gets focus back.
 */
export function SidePanel({ title, subtitle, status, lead, onClose, busy = false, children, foot }: { title: string; subtitle?: string; status?: ReactNode; lead?: ReactNode; onClose: () => void; busy?: boolean; children: ReactNode; foot?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className={styles.panel} aria-labelledby={titleId} onClose={(event) => (event.target === ref.current ? onClose() : undefined)} onCancel={(event) => (busy ? event.preventDefault() : undefined)}>
      <div className={styles.head}>
        {lead}
        <div className={styles.title}>
          <div className={styles.titleLine}>
            <h2 id={titleId}>{title}</h2>
            {status}
          </div>
          {subtitle ? <p className={styles.line}>{subtitle}</p> : null}
        </div>
        <button type="button" className={styles.iconButton} aria-label={t("read.close")} disabled={busy} onClick={() => ref.current?.close()}>
          <X aria-hidden />
        </button>
      </div>
      <div className={styles.body}>{children}</div>
      {foot ? <div className={styles.foot}>{foot}</div> : null}
    </dialog>
  );
}

/** A short list of facts, name and value on one line where they fit, stacked where they do not. */
export function Facts({ rows }: { rows: readonly { name: string; value: ReactNode }[] }) {
  return (
    <dl className={styles.facts}>
      {rows.map((row) => (
        <div key={row.name} className={styles.fact}>
          <dt>{row.name}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled part of a panel. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}
