"use client";

import { ChevronDown, GraduationCap } from "lucide-react";
import { useId, useState } from "react";

import styles from "@/classes/classes.module.css";
import { t } from "@/i18n/messages";
import accessStyles from "@/people/people-access.module.css";

import { MySheetsTable, type MySheet } from "./MarkSheetScreen";

/** Each class card's soft tint, in turn, from the theme's tones (never a colour of its own), as on Classes. */
const TONES = ["primary", "ok", "accent", "warn"] as const;

export interface SheetGroup {
  classId: string;
  title: string;
  place: string;
  rows: MySheet[];
  todo: number;
  review: number;
  done: number;
}

/**
 * One terminal's sheets grouped by class (the PM, 2026-10-12): Class 8 with the subjects the teacher takes in it, then Class 9,
 * and so on. The classes run in name order (Class 8 before Class 10); inside one, the sheets keep their order, the ones that
 * need the teacher first. Pure.
 */
export function groupByClass(rows: readonly MySheet[]): SheetGroup[] {
  const groups = new Map<string, SheetGroup>();
  for (const row of rows) {
    const group = groups.get(row.classId) ?? { classId: row.classId, title: row.levelName, place: row.place, rows: [], todo: 0, review: 0, done: 0 };
    group.rows.push(row);
    if (row.status === "not_started" || row.status === "draft") group.todo++;
    else if (row.status === "under_review") group.review++;
    else group.done++;
    groups.set(row.classId, group);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }) || a.place.localeCompare(b.place, undefined, { numeric: true }));
}

/** The class that opens by itself: the first with something left to do, else the first. */
export const firstToOpen = (groups: readonly SheetGroup[]): string => (groups.find((g) => g.todo > 0) ?? groups[0])?.classId ?? "";

/**
 * A terminal's mark sheets as class cards, the same cards as Classes: a tinted head with the class, how much is left, and an
 * arrow, then the subjects inside. One card is open to begin with; the person opens the rest.
 */
export function MySheetGroups({ rows, terminalName }: { rows: readonly MySheet[]; terminalName: string }) {
  const groups = groupByClass(rows);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const first = firstToOpen(groups);
  const isOpen = (id: string) => toggled[id] ?? id === first;
  return (
    <ul className={styles.courses}>
      {groups.map((group, i) => (
        <SheetGroupCard
          key={group.classId}
          group={group}
          terminalName={terminalName}
          tone={TONES[i % TONES.length]!}
          open={isOpen(group.classId)}
          onToggle={() => setToggled((now) => ({ ...now, [group.classId]: !isOpen(group.classId) }))}
        />
      ))}
    </ul>
  );
}

function SheetGroupCard({ group, terminalName, tone, open, onToggle }: { group: SheetGroup; terminalName: string; tone: string; open: boolean; onToggle: () => void }) {
  const bodyId = useId();
  return (
    <li className={styles.course} data-tone={tone}>
      <div className={styles.courseHead}>
        <span className={accessStyles.tile} data-tone={tone} aria-hidden>
          <GraduationCap />
        </span>
        <div className={styles.courseName}>
          <h2 className={styles.courseTitle}>{group.title}</h2>
          <p className={styles.muted}>{group.place}</p>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>{t("results.mine.stat.subjects")}</dt>
            <dd>{group.rows.length}</dd>
          </div>
          <div>
            <dt>{t("results.mine.figure.todo")}</dt>
            <dd>{group.todo}</dd>
          </div>
          <div>
            <dt>{t("results.mine.figure.review")}</dt>
            <dd>{group.review}</dd>
          </div>
          <div>
            <dt>{t("results.mine.figure.done")}</dt>
            <dd>{group.done}</dd>
          </div>
        </dl>
        <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? "results.mine.hide" : "results.mine.show", { name: `${group.title}, ${group.place}` })} onClick={onToggle}>
          <ChevronDown aria-hidden data-open={open} />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className={styles.levels}>
          <MySheetsTable rows={group.rows} terminalName={terminalName} classCaption={`${group.title}, ${group.place}`} showClass={false} />
        </div>
      ) : null}
    </li>
  );
}
