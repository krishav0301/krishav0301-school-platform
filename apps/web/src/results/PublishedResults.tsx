"use client";

import { useCallback, useState } from "react";

import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { EmptyLine, OpenLink, ReadFailure, ReadTable, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Select } from "@/ui";

import { gateFailure, loadPublishedResults } from "./client";
import { className, type PublishedResults } from "./model";

export type PublishedRow = PublishedResults["results"][number];

/** The id the class sheet takes for a result: the exam's id, or "final". */
export const sheetTerminal = (r: PublishedRow): string => r.terminal?.id ?? "final";
export const examName = (r: PublishedRow): string => (r.terminal ? r.terminal.name : t("results.sheets.final"));

export interface DepartmentCount {
  name: string;
  /** Classes with at least one published result. */
  classes: number;
  /** Published results: a class's exam, or its final, each one. */
  results: number;
}

/** How many classes have results out, and how many results, for each department. Pure. */
export function countByDepartment(rows: readonly PublishedRow[]): DepartmentCount[] {
  const counts = new Map<string, { classes: Set<string>; results: number }>();
  for (const r of rows) {
    const now = counts.get(r.programmeName) ?? { classes: new Set<string>(), results: 0 };
    now.classes.add(r.classId);
    now.results += 1;
    counts.set(r.programmeName, now);
  }
  return [...counts.entries()].map(([name, v]) => ({ name, classes: v.classes.size, results: v.results })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** The dashboard's Results tab: for each department, how many results are published. A plain table, no graphs. Pure. */
export function DepartmentCounts({ rows }: { rows: readonly PublishedRow[] }) {
  if (rows.length === 0) return <EmptyLine>{t("dashboard.glance.noResults")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("results.published.byDepartment")}
      rows={countByDepartment(rows)}
      rowKey={(d) => d.name}
      columns={[
        { key: "department", label: t("results.published.department"), primary: true, cell: (d: DepartmentCount) => d.name },
        { key: "classes", label: t("results.published.classes"), align: "end", cell: (d) => d.classes },
        { key: "results", label: t("results.published.count"), align: "end", cell: (d) => d.results },
      ]}
    />
  );
}

interface Filters {
  exam: string;
  department: string;
}
const NONE: Filters = { exam: "", department: "" };
const examKey = (r: PublishedRow) => (r.terminal ? `exam:${r.terminal.name}` : "final");

/** The published results to open, newest first, with a filter for the exam and the department. Pure apart from the filters. */
export function PublishedList({ rows }: { rows: readonly PublishedRow[] }) {
  const [filters, setFilters] = useState<Filters>(NONE);
  const unique = (key: (r: PublishedRow) => string, label: (r: PublishedRow) => string) =>
    rows.filter((r, i) => rows.findIndex((o) => key(o) === key(r)) === i).map((r) => ({ value: key(r), label: label(r) }));
  const shown = rows.filter((r) => (!filters.exam || examKey(r) === filters.exam) && (!filters.department || r.programmeName === filters.department));
  if (rows.length === 0) return <EmptyLine>{t("dashboard.glance.noResults")}</EmptyLine>;
  return (
    <>
      <div role="group" aria-label={t("results.published.filters")} className={`${readStyles.search} ${readStyles.searchWide}`}>
        <Select label={t("results.terminal")} value={filters.exam} onChange={(event) => setFilters((f) => ({ ...f, exam: event.target.value }))} options={[{ value: "", label: t("results.published.allExams") }, ...unique(examKey, examName)]} />
        <Select
          label={t("results.published.department")}
          value={filters.department}
          onChange={(event) => setFilters((f) => ({ ...f, department: event.target.value }))}
          options={[{ value: "", label: t("results.published.allDepartments") }, ...unique((r) => r.programmeName, (r) => r.programmeName)]}
        />
        {filters.exam || filters.department ? (
          <Button variant="secondary" onClick={() => setFilters(NONE)}>
            {t("content.clearFilters")}
          </Button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <EmptyLine>{t("results.published.noMatch")}</EmptyLine>
      ) : (
        <ReadTable
          caption={t("results.published.list")}
          rows={shown}
          rowKey={(r) => `${r.classId}/${sheetTerminal(r)}`}
          columns={[
            { key: "class", label: t("results.sheets.class"), primary: true, cell: (r: PublishedRow) => className(r) },
            { key: "exam", label: t("results.terminal"), cell: (r) => examName(r) },
            { key: "when", label: t("results.published.on"), hidePhone: true, cell: (r) => (r.publishedOnBs ? formatBsDate(r.publishedOnBs) : "–") },
            { key: "students", label: t("results.published.students"), align: "end", hidePhone: true, cell: (r) => r.cards },
            {
              key: "open",
              label: t("results.review.open"),
              align: "end",
              plain: true,
              cell: (r) => <OpenLink href={`/portal/results/sheets?class=${r.classId}&terminal=${sheetTerminal(r)}`} label={t("results.published.openNamed", { name: `${className(r)}, ${examName(r)}` })} />,
            },
          ]}
        />
      )}
    </>
  );
}

/** Loads the published results and shows them as `view`. */
export function PublishedResultsLoader({ view: render }: { view: (rows: readonly PublishedRow[]) => React.ReactNode }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadPublishedResults(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<PublishedResults>(loadNow);
  if (view.status === "loading") return <TableSkeleton rows={3} />;
  if (view.status === "failed" || view.status === "forbidden") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <>{render(view.data.results)}</>;
}
