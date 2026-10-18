"use client";

import { t } from "@/i18n/messages";
import { FilterSelect, SearchBox } from "@/people/ListParts";
import accessStyles from "@/people/people-access.module.css";
import { Button } from "@/ui";

import styles from "./classes.module.css";
import { nextClassFilters, NO_CLASS_FILTERS, NO_SECTION, type classFilterOptions, type ClassFilters } from "./model";

/**
 * The search box and the four filters of the Classes page (Wing, Department, Level, Section), all on All to begin with, and
 * Clear filters once one is set. Shared by Classes and Attendance (D-181); the options come from `classFilterOptions`.
 */
export function ClassFilterBar({ filters, options, onChange }: { filters: ClassFilters; options: ReturnType<typeof classFilterOptions>; onChange: (next: ClassFilters) => void }) {
  const filtered = Object.values(filters).some(Boolean);
  const all = { value: "", label: t("content.filterAll") };
  return (
    <div className={styles.toolbar}>
      <SearchBox label="classes.search" value={filters.q} onChange={(q) => onChange({ ...filters, q })} />
      <div className={accessStyles.filters}>
        <FilterSelect label="classes.filter.wing" value={filters.wing} onChange={(v) => onChange(nextClassFilters(filters, { wing: v }))} options={[all, ...options.wings.map((w) => ({ value: w, label: w }))]} />
        <FilterSelect label="classes.filter.course" value={filters.course} onChange={(v) => onChange(nextClassFilters(filters, { course: v }))} options={[all, ...options.courses.map((c) => ({ value: c.id, label: c.name }))]} />
        <FilterSelect
          label="classes.filter.level"
          value={filters.level}
          onChange={(v) => onChange(nextClassFilters(filters, { level: v }))}
          options={[all, ...options.levels.map((l) => ({ value: l.id, label: filters.course ? l.name : t("classes.levelOf", { level: l.name, course: l.course }) }))]}
        />
        <FilterSelect
          label="classes.filter.section"
          value={filters.section}
          onChange={(v) => onChange(nextClassFilters(filters, { section: v }))}
          options={[all, ...options.sections.map((s) => ({ value: s, label: s === NO_SECTION ? t("classes.noSection") : s }))]}
        />
        {filtered ? (
          <Button variant="secondary" className={styles.clear} onClick={() => onChange(NO_CLASS_FILTERS)}>
            {t("content.clearFilters")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
