"use client";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { Select } from "@/ui";

import type { Programme } from "./model";
import { coursesOf, levelsOf, settle, wingsOf, type KeepLevel, type StructureChoice } from "./structure-picker";
import styles from "./setup.module.css";

/** A step with one choice, said in its place rather than offered as a menu of one entry (D-030): "Wing: +2". Still used by the admissions form; the Curriculum picker keeps menus. */
export function GivenStep({ label, value }: { label: string; value: string }) {
  return <p className={styles.pickerGiven}>{t("setup.picker.given", { label, value })}</p>;
}

/**
 * One level, chosen by Wing, then Course, then Level (D-114), in the school's own words. A step with a single choice is
 * made for the person and not shown (D-030); what is chosen is always the settled choice, so `onChange` gets a level
 * only when it is clear. With nothing to offer, it says so.
 */
export function StructurePicker({
  programmes,
  keep,
  value,
  onChange,
  error,
  empty,
}: {
  programmes: readonly Programme[];
  keep?: KeepLevel;
  value: StructureChoice;
  onChange: (choice: StructureChoice) => void;
  error?: string;
  /** What to say when no level can be offered. */
  empty: string;
}) {
  const { term } = useConfig();
  const choice = settle(programmes, value, keep);
  const wings = wingsOf(programmes, keep);
  if (wings.length === 0) return <p className={styles.empty}>{empty}</p>;
  const courses = choice.sectionKey ? coursesOf(programmes, choice.sectionKey, keep) : [];
  const course = courses.find((p) => p.id === choice.programmeId);
  const levels = course ? levelsOf(course, keep) : [];
  const choose = { value: "", label: t("setup.programmes.choose") };
  const change = (next: StructureChoice) => onChange(settle(programmes, next, keep));
  // A problem is said at the first step still to choose.
  const errorAt = !choice.sectionKey ? "wing" : !choice.programmeId ? "course" : "level";

  return (
    <div className={styles.picker}>
      {/* Wing, Department and Level stay menus even with one entry, so the screen does not change shape (PM, 2026-10-09). */}
      {wings.length >= 1 ? (
        <Select
          label={term("term.section")}
          value={choice.sectionKey ?? ""}
          options={[choose, ...wings.map((w) => ({ value: w.key, label: w.name }))]}
          onChange={(event) => change({ sectionKey: event.target.value || null, programmeId: null, levelId: null })}
          error={errorAt === "wing" ? error : undefined}
        />
      ) : null}
      {courses.length >= 1 ? (
        <Select
          label={term("term.programme")}
          value={choice.programmeId ?? ""}
          options={[choose, ...courses.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(event) => change({ ...choice, programmeId: event.target.value || null, levelId: null })}
          error={errorAt === "course" ? error : undefined}
        />
      ) : null}
      {levels.length >= 1 ? (
        <Select
          label={term("term.level")}
          value={choice.levelId ?? ""}
          options={[choose, ...levels.map((l) => ({ value: l.id, label: l.name }))]}
          onChange={(event) => change({ ...choice, levelId: event.target.value || null })}
          error={errorAt === "level" ? error : undefined}
        />
      ) : null}
    </div>
  );
}
