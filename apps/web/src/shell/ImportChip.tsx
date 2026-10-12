"use client";

import { useRouter } from "next/navigation";

import { useImportJob, type ImportJob } from "@/classes/import-job";
import { t } from "@/i18n/messages";

import styles from "./shell.module.css";

/** What the chip says, and how far its bar is. Pure. */
export function chipView(job: ImportJob): { text: string; share: number } {
  if (job.interrupted) return { text: t("shell.import.stopped", { class: job.className, done: job.done, total: job.total }), share: job.total > 0 ? Math.min(1, job.done / job.total) : 0 };
  return job.running
    ? { text: t("shell.import.running", { class: job.className, done: job.done, total: job.total }), share: job.total > 0 ? Math.min(1, job.done / job.total) : 0 }
    : { text: t("shell.import.done", { class: job.className }), share: 1 };
}

/**
 * The class import, minimised (the PM, 2026-10-12, D-155): while an import runs, or until its results are closed, a small
 * chip sits next to the search with its progress. Pressing it takes the person back to that class, with the import window open.
 */
export function ImportChip() {
  const { job } = useImportJob();
  const router = useRouter();
  if (!job) return null;
  const { text, share } = chipView(job);
  return (
    <button
      type="button"
      className={styles.importChip}
      aria-label={t("shell.import.open", { class: job.className })}
      onClick={() => {
        // A new number each press, so the class page opens the import window again even when it is already showing.
        router.push(`/portal/classes/class?id=${job.classId}&tab=students&import=${Date.now()}`);
      }}
    >
      <span className={styles.importChipText}>{text}</span>
      <span
        className={styles.importChipTrack}
        role="progressbar"
        aria-label={text}
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={job.running ? job.done : job.total}
      >
        <span className={styles.importChipFill} style={{ transform: `scaleX(${share})` }} />
      </span>
    </button>
  );
}
