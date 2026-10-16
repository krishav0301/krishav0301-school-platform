"use client";

import { BookOpen, ChevronDown } from "lucide-react";
import { useCallback, useId, useState } from "react";

import classStyles from "@/classes/classes.module.css";
import { bareSection, sectionBadge } from "@/classes/model";
import { t } from "@/i18n/messages";
import { EmptyLine, OpenLink, ReadFailure, ReadTable, TableSkeleton, readStyles } from "@/read/ReadView";
import accessStyles from "@/people/people-access.module.css";
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
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
/** Each department card's soft tint, in turn, from the theme's tones (as on the Classes page). */
const TONES = ["primary", "ok", "accent", "warn"] as const;

export interface SectionGroup {
  classId: string;
  label: string;
  /** Its published results, newest first. */
  results: PublishedRow[];
}
export interface LevelGroup {
  name: string;
  sections: SectionGroup[];
}
export interface DepartmentGroup {
  name: string;
  levels: LevelGroup[];
  /** Published results in all. */
  results: number;
}

/** The published results grouped as the Classes page is: department, then level, then section, in natural order. Pure. */
export function groupPublished(rows: readonly PublishedRow[]): DepartmentGroup[] {
  const sorted = [...rows].sort((a, b) => byName(a.programmeName, b.programmeName) || byName(a.levelName, b.levelName) || byName(a.label, b.label));
  const departments: DepartmentGroup[] = [];
  for (const r of sorted) {
    let dept = departments.find((d) => d.name === r.programmeName);
    if (!dept) departments.push((dept = { name: r.programmeName, levels: [], results: 0 }));
    let level = dept.levels.find((l) => l.name === r.levelName);
    if (!level) dept.levels.push((level = { name: r.levelName, sections: [] }));
    let section = level.sections.find((x) => x.classId === r.classId);
    if (!section) level.sections.push((section = { classId: r.classId, label: r.label, results: [] }));
    section.results.push(r);
    dept.results += 1;
  }
  return departments;
}

const count = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) => t(n === 1 ? one : many, { n });

/** One section: its badge and name, a link to each result published for it, and its students. Pure. */
export function SectionResults({ section }: { section: SectionGroup }) {
  const first = section.results[0]!;
  const students = Math.max(...section.results.map((r) => r.cards));
  return (
    <li className={classStyles.section}>
      <span className={classStyles.badge} aria-hidden>
        {sectionBadge(section.label)}
      </span>
      <span className={classStyles.sectionName}>{section.label ? t("classes.section", { name: bareSection(section.label) }) : t("classes.noSection")}</span>
      <span className={`${classStyles.teacher} ${readStyles.cellWords}`}>
        {section.results.map((r) => (
          <OpenLink key={sheetTerminal(r)} href={`/portal/results/sheets?class=${r.classId}&terminal=${sheetTerminal(r)}`} label={t("results.published.openNamed", { name: `${className(first)}, ${examName(r)}` })} text={examName(r)} />
        ))}
      </span>
      <span className={classStyles.students}>{count(students, "classes.studentsOne", "classes.studentsMany")}</span>
    </li>
  );
}

/** A department as a card, like the Classes page: its counts in the head, its levels and their sections inside when open. Pure apart from the open state. */
export function DepartmentResults({ dept, tone, startOpen }: { dept: DepartmentGroup; tone: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const bodyId = useId();
  return (
    <li className={classStyles.course} data-tone={tone}>
      <div className={classStyles.courseHead}>
        <span className={accessStyles.tile} data-tone={tone} aria-hidden>
          <BookOpen />
        </span>
        <div className={classStyles.courseName}>
          <h2 className={classStyles.courseTitle}>{dept.name}</h2>
        </div>
        <dl className={classStyles.stats}>
          <div>
            <dt>{t("results.published.classes")}</dt>
            <dd>{dept.levels.reduce((n, l) => n + l.sections.length, 0)}</dd>
          </div>
          <div>
            <dt>{t("results.published.count")}</dt>
            <dd>{dept.results}</dd>
          </div>
        </dl>
        <button type="button" className={classStyles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? "classes.hide" : "classes.show", { name: dept.name })} onClick={() => setOpen(!open)}>
          <ChevronDown aria-hidden data-open={open} />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className={classStyles.levels}>
          {dept.levels.map((level) => (
            <section key={level.name} className={classStyles.level} aria-label={level.name}>
              <div className={classStyles.levelHead}>
                <h3 className={classStyles.levelTitle}>{level.name}</h3>
                <span className={classStyles.levelCounts}>{count(level.sections.length, "classes.sectionsOne", "classes.sectionsMany")}</span>
              </div>
              <ul className={classStyles.sections}>
                {level.sections.map((section) => (
                  <SectionResults key={section.classId} section={section} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The published results as the Classes page shows classes: a card for each department, its levels inside, each level's
 * sections as rows with a link to each result. Every card starts closed; a filter opens the ones it leaves (the PM,
 * 2026-10-17). An exam and a department filter. Pure apart from the filters.
 */
export function PublishedList({ rows }: { rows: readonly PublishedRow[] }) {
  const [filters, setFilters] = useState<Filters>(NONE);
  const unique = (key: (r: PublishedRow) => string, label: (r: PublishedRow) => string) =>
    rows.filter((r, i) => rows.findIndex((o) => key(o) === key(r)) === i).map((r) => ({ value: key(r), label: label(r) }));
  const filtered = Boolean(filters.exam || filters.department);
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
        {filtered ? (
          <Button variant="secondary" onClick={() => setFilters(NONE)}>
            {t("content.clearFilters")}
          </Button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <EmptyLine>{t("results.published.noMatch")}</EmptyLine>
      ) : (
        // Keyed by the filters so a new filter opens (or closes) every card afresh, as on the Classes page.
        <ul key={`${filters.exam}|${filters.department}`} className={classStyles.courses}>
          {groupPublished(shown).map((dept, i) => (
            <DepartmentResults key={dept.name} dept={dept} tone={TONES[i % TONES.length]!} startOpen={filtered} />
          ))}
        </ul>
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
