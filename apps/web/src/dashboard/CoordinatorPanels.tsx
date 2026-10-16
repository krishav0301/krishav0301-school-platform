"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import type { ClassHubItem } from "@/classes/model";
import { t } from "@/i18n/messages";
import { OpenLink, Panel, readStyles } from "@/read/ReadView";
import { STATUS_LABEL, type ReviewBoard, type SheetStatus } from "@/results/model";

import styles from "./coordinator.module.css";

/**
 * What the Co-ordinator's home shows beyond the day's list (the PM, 2026-10-17: make it feel alive, as the Principal's
 * does): where the marks of the exam in progress stand, department by department, and what needs the Co-ordinator now.
 * Everything is read from what their own screens already load; nothing new is asked of the server.
 */

/** The order a subject moves through, which is the order of the bar's segments. */
export const STAGES = ["published", "verified", "under_review", "draft", "not_started"] as const satisfies readonly SheetStatus[];
type Counts = Record<(typeof STAGES)[number], number>;

export interface DepartmentProgress {
  name: string;
  counts: Counts;
  total: number;
  /** Subjects verified or published. */
  done: number;
}
export interface Pipeline {
  exam: string;
  departments: DepartmentProgress[];
  classesReady: number;
  classesPublished: number;
  classesTotal: number;
}

/** The exam in progress, with each department's subjects counted by stage. Null when there is no exam or nothing to count. Pure. */
export function pipelineOf(board: ReviewBoard): Pipeline | null {
  if (!board.terminalId || board.classes.length === 0) return null;
  const departments: DepartmentProgress[] = [];
  for (const cls of board.classes) {
    let dept = departments.find((d) => d.name === cls.programmeName);
    if (!dept) departments.push((dept = { name: cls.programmeName, counts: { published: 0, verified: 0, under_review: 0, draft: 0, not_started: 0 }, total: 0, done: 0 }));
    for (const s of cls.subjects) {
      dept.counts[s.status] += 1;
      dept.total += 1;
      if (s.status === "verified" || s.status === "published") dept.done += 1;
    }
  }
  return {
    exam: board.terminals.find((x) => x.id === board.terminalId)?.name ?? "",
    departments: departments.filter((d) => d.total > 0).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    classesReady: board.classes.filter((c) => c.ready).length,
    classesPublished: board.classes.filter((c) => c.published).length,
    classesTotal: board.classes.length,
  };
}

const STAGE_TONE: Record<(typeof STAGES)[number], string> = { published: "ok", verified: "ok", under_review: "warn", draft: "primary", not_started: "none" };
const STAGE_KEY = { published: STATUS_LABEL.published, verified: STATUS_LABEL.verified, under_review: STATUS_LABEL.under_review, draft: STATUS_LABEL.draft, not_started: STATUS_LABEL.not_started } as const;

/** Each department's subjects as one bar split by stage, with how many are verified; the stages named once below. Pure. */
export function PipelinePanel({ pipeline }: { pipeline: Pipeline }) {
  return (
    <Panel title={t("coord.pipeline.title", { exam: pipeline.exam })} labelledBy="coord-pipeline" actions={<OpenLink href="/portal/results" label={t("coord.pipeline.open")} text={t("coord.pipeline.open")} />}>
      <ul className={styles.pipeline}>
        {pipeline.departments.map((d) => (
          <li key={d.name} className={styles.pipeRow}>
            <span className={styles.pipeName}>{d.name}</span>
            <div className={styles.stack} role="img" aria-label={STAGES.map((s) => `${t(STAGE_KEY[s])}: ${d.counts[s]}`).join(", ")}>
              {STAGES.map((s) => (
                <span key={s} className={styles.seg} data-tone={STAGE_TONE[s]} data-stage={s} style={{ "--n": d.counts[s] } as CSSProperties} />
              ))}
            </div>
            <span className={styles.pipeCount}>{t("coord.pipeline.verified", { done: d.done, total: d.total })}</span>
          </li>
        ))}
      </ul>
      <ul className={styles.keys}>
        {STAGES.map((s) => (
          <li key={s}>
            <span className={styles.dot} data-tone={STAGE_TONE[s]} data-stage={s} aria-hidden />
            {t(STAGE_KEY[s])}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export interface Need {
  key: string;
  text: string;
  href: string;
  tone: "warn" | "bad" | "ok";
}

/**
 * What needs the Co-ordinator, as short links to where it is fixed: applications waiting a while, classes ready to publish,
 * classes with no Class Teacher; one chip for each kind, counts not names. None means all is well. Pure.
 */
export function needsOf(d: { oldestWaitingDays: number | null; classes: readonly ClassHubItem[] | null; board: ReviewBoard | null }): Need[] {
  const needs: Need[] = [];
  if (d.oldestWaitingDays !== null && d.oldestWaitingDays >= 1) {
    needs.push({ key: "oldest", text: t(d.oldestWaitingDays === 1 ? "coord.needs.oldestOne" : "coord.needs.oldest", { count: d.oldestWaitingDays }), href: "/portal/admissions", tone: d.oldestWaitingDays >= 3 ? "bad" : "warn" });
  }
  const ready = d.board?.classes.filter((x) => x.ready).length ?? 0;
  if (ready > 0) needs.push({ key: "ready", text: t(ready === 1 ? "coord.needs.readyOne" : "coord.needs.ready", { count: ready }), href: "/portal/results", tone: "ok" });
  const open = d.classes?.filter((c) => !c.classTeacher).length ?? 0;
  if (open > 0) needs.push({ key: "teacher", text: t(open === 1 ? "coord.needs.noTeacherOne" : "coord.needs.noTeacher", { count: open }), href: "/portal/setup/teaching", tone: "warn" });
  return needs.slice(0, 6);
}

/** "Needs you": a chip for each thing, a calm line when there is none. Pure. */
export function NeedsPanel({ needs }: { needs: readonly Need[] }) {
  return (
    <Panel title={t("coord.needs.title")} labelledBy="coord-needs">
      {needs.length === 0 ? (
        <p className={readStyles.rowMeta}>{t("coord.needs.none")}</p>
      ) : (
        <ul className={styles.chips}>
          {needs.map((n) => (
            <li key={n.key}>
              <Link href={n.href} className={styles.chip} data-tone={n.tone}>
                <span className={styles.chipText}>{n.text}</span>
                <ArrowRight aria-hidden className={styles.chipArrow} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
