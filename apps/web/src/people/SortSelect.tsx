"use client";

import { t } from "@/i18n/messages";

import { FilterSelect } from "./ListParts";
import styles from "./people-access.module.css";
import { SORT_LABELS, type StudentSort } from "./student-sort";

/** "Sort by" for a list of students: the caller says which orders make sense for its rows. */
export function SortSelect({
  value,
  onChange,
  options,
}: {
  value: StudentSort;
  onChange: (next: StudentSort) => void;
  options: readonly StudentSort[];
}) {
  return (
    <div className={styles.sortRow}>
      <FilterSelect
        label="sort.label"
        value={value}
        onChange={(v) => onChange(v as StudentSort)}
        options={options.map((o) => ({ value: o, label: t(SORT_LABELS[o]) }))}
      />
    </div>
  );
}
