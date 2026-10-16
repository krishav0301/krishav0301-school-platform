"use client";

import { BookOpen, ChevronDown } from "lucide-react";
import { useCallback, useId, useState, type CSSProperties, type ReactNode } from "react";

import classStyles from "@/classes/classes.module.css";
import { bareSection, sectionBadge } from "@/classes/model";
import { t } from "@/i18n/messages";
import accessStyles from "@/people/people-access.module.css";
import { ReadFailure, TableSkeleton } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Select } from "@/ui";

import { gateFailure, loadPublishedResults } from "./client";
import {
  NO_FILTERS,
  applyFilters,
  filterOptions,
  groupInsights,
  scoreTone,
  sheetTerminal,
  shortPercent,
  startFilters,
  summarise,
  type Bar,
  type DepartmentGroup,
  type InsightFilters,
  type LevelGroup,
  type PublishedResults,
  type PublishedRow,
  type Summary,
} from "./insights-model";
import styles from "./results-insights.module.css";

const BAND_TONES = ["bad", "warn", "primary", "ok"] as const;
const BAND_LABELS = ["results.insights.band0", "results.insights.band1", "results.insights.band2", "results.insights.band3"] as const;
/** Each department card's soft tint, in turn, from the theme's tones (as on the Classes page). */
const TONES = ["primary", "ok", "accent", "warn"] as const;

/**
 * Shows one class's published sheet (its students); the screens that use this say how, so no screen imports another. A
 * view given none is a brief: graphs and figures only, nothing opens (the dashboard's Results tab, the PM 2026-10-17).
 */
export type SheetOf = (classId: string, terminalId: string) => ReactNode;

/** One score as a bar that grows in, with its value as text too. Pure. */
export function ScoreBar({ value }: { value: number }) {
  return (
    <span className={styles.scoreBar}>
      <span className={styles.track} aria-hidden>
        <span className={styles.fill} data-tone={scoreTone(value)} style={{ "--s": Math.min(1, value / 10000) } as CSSProperties} />
      </span>
      <span className={styles.barValue}>{shortPercent(value)}</span>
    </span>
  );
}

/** A level's subjects: the name, a bar, the average. Only within a level, whose classes share their subjects. Pure. */
export function BarList({ bars, label }: { bars: readonly Bar[]; label: string }) {
  return (
    <ul className={styles.bars} aria-label={label}>
      {bars.map((b) => (
        <li key={b.key} className={styles.bar}>
          <span className={styles.barName}>{b.label}</span>
          <ScoreBar value={b.value} />
        </li>
      ))}
    </ul>
  );
}

/** One bar split in four by how students scored, and what each part is. Pure. */
export function ScoreSplit({ bands, id }: { bands: readonly number[]; id: string }) {
  const total = bands.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className={styles.split} role="img" aria-labelledby={id} aria-label={bands.map((n, i) => `${t(BAND_LABELS[i]!)}: ${n}`).join(", ")}>
        {bands.map((n, i) => (
          <span key={BAND_TONES[i]} className={styles.slice} data-tone={BAND_TONES[i]} style={{ "--n": n } as CSSProperties} />
        ))}
      </div>
      <ul className={styles.legend}>
        {bands.map((n, i) => (
          <li key={BAND_TONES[i]}>
            <span className={styles.dot} data-tone={BAND_TONES[i]} aria-hidden />
            {t(BAND_LABELS[i]!)}
            <strong>{total > 0 ? `${n} · ${Math.round((n * 100) / total)}%` : n}</strong>
          </li>
        ))}
      </ul>
    </>
  );
}

const sectionName = (r: PublishedRow): string => (r.label ? t("classes.section", { name: bareSection(r.label) }) : t("classes.noSection"));

/** The facts of a group in a line: classes, students, average, and the pass rate when a final is shown. */
const facts = (s: Summary): string =>
  [
    t(s.published === 1 ? "classes.sectionsOne" : "classes.sectionsMany", { n: s.published }),
    t(s.students === 1 ? "classes.studentsOne" : "classes.studentsMany", { n: s.students }),
    s.passPercent === null ? null : t("results.insights.passedPercent", { percent: s.passPercent }),
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * One class of a level: its badge and name, its average, its students and how many passed (a final only), and a button
 * that opens the class's own sheet right here, student by student. Pure apart from the open state.
 */
export function ClassRow({ row, sheet, startOpen }: { row: PublishedRow; sheet?: SheetOf; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen ?? false);
  const bodyId = useId();
  const name = `${row.programmeName} · ${row.levelName} · ${sectionName(row)}`;
  return (
    <li className={styles.classItem}>
      <div className={styles.classRow}>
        <span className={classStyles.badge} aria-hidden>
          {sectionBadge(row.label)}
        </span>
        <span className={styles.classMain}>
          <span className={styles.className}>{sectionName(row)}</span>
          {row.avgPercentHundredths === null ? null : <ScoreBar value={row.avgPercentHundredths} />}
        </span>
        <span className={styles.classFacts}>
          {t(row.cards === 1 ? "classes.studentsOne" : "classes.studentsMany", { n: row.cards })}
          {row.passed === null ? null : <small>{t("results.insights.passedOf", { passed: row.passed, total: row.cards })}</small>}
        </span>
        {sheet ? (
          <button type="button" className={classStyles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? "results.insights.hideStudents" : "results.insights.showStudents", { name })} onClick={() => setOpen(!open)}>
            <ChevronDown aria-hidden data-open={open} />
          </button>
        ) : null}
      </div>
      {sheet && open ? (
        <div id={bodyId} className={styles.classBody}>
          {sheet(row.classId, sheetTerminal(row))}
        </div>
      ) : null}
    </li>
  );
}

function LevelBlock({ level, sheet, startOpen }: { level: LevelGroup; sheet?: SheetOf; startOpen: boolean }) {
  const id = useId();
  return (
    <section className={classStyles.level} aria-labelledby={id}>
      <div className={classStyles.levelHead}>
        <h4 id={id} className={classStyles.levelTitle}>
          {level.name}
        </h4>
        <span className={classStyles.levelCounts}>{facts(level.summary)}</span>
        {level.summary.avgPercentHundredths === null ? null : <ScoreBar value={level.summary.avgPercentHundredths} />}
      </div>
      <ul className={classStyles.sections}>
        {level.classes.map((row) => (
          <ClassRow key={row.classId} row={row} sheet={sheet} startOpen={startOpen && level.classes.length === 1} />
        ))}
      </ul>
      {sheet && level.subjects.length > 0 ? (
        <div className={styles.levelSubjects}>
          <h5 className={styles.chartTitle}>{t("results.insights.subjectsOf", { level: level.name })}</h5>
          <BarList bars={level.subjects} label={t("results.insights.subjectsOf", { level: level.name })} />
        </div>
      ) : null}
    </section>
  );
}

/** A department as a card, like the Classes page: its totals in the head, its levels inside when open. Pure apart from the open state. */
export function DepartmentCard({ dept, tone, startOpen, sheet, lone }: { dept: DepartmentGroup; tone: string; startOpen: boolean; sheet?: SheetOf; lone: boolean }) {
  const [toggled, setOpen] = useState(startOpen);
  const open = sheet ? toggled : true; // a brief has every level in view
  const bodyId = useId();
  return (
    <li className={classStyles.course} data-tone={tone}>
      <div className={classStyles.courseHead}>
        <span className={accessStyles.tile} data-tone={tone} aria-hidden>
          <BookOpen />
        </span>
        <div className={classStyles.courseName}>
          <h3 className={classStyles.courseTitle}>{dept.name}</h3>
          <p className={classStyles.muted}>{facts(dept.summary)}</p>
        </div>
        {dept.summary.avgPercentHundredths === null ? null : (
          <dl className={classStyles.stats}>
            <div>
              <dt>{t("results.insights.average")}</dt>
              <dd>{shortPercent(dept.summary.avgPercentHundredths)}</dd>
            </div>
          </dl>
        )}
        {sheet ? (
          <button type="button" className={classStyles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? "classes.hide" : "classes.show", { name: dept.name })} onClick={() => setOpen(!open)}>
            <ChevronDown aria-hidden data-open={open} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div id={bodyId} className={classStyles.levels}>
          {dept.levels.map((level) => (
            <LevelBlock key={level.name} level={level} sheet={sheet} startOpen={lone} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The published results as data, grouped as the school is (the PM, 2026-10-17): a filter bar, four figures and how
 * students scored for what is chosen, then wing, department and level, each class opening to its students. One exam at
 * a time, so figures are never mixed across exams. Pure: the data comes in, nothing is fetched.
 */
export function ResultsInsightsView({ data, sheet }: { data: PublishedResults; sheet?: SheetOf }) {
  const [filters, setFilters] = useState<InsightFilters>(() => startFilters(data.results));
  const options = filterOptions(data.results, filters);
  const rows = applyFilters(data.results, filters);
  const sum = summarise(rows);
  const wings = groupInsights(rows);
  const narrowed = Boolean(filters.wing || filters.department || filters.level);
  const choose = (patch: Partial<InsightFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const bandsId = useId();
  let index = 0;

  if (data.results.length === 0) return <p className={styles.empty}>{t("dashboard.glance.noResults")}</p>;
  return (
    <div className={styles.root}>
      <div className={styles.filters} role="group" aria-label={t("results.insights.filters")}>
        <Select label={t("results.terminal")} value={filters.exam} onChange={(event) => setFilters({ ...NO_FILTERS, exam: event.target.value })} options={options.exams} />
        {options.wings.length > 1 || filters.wing ? (
          <Select label={t("results.insights.wing")} value={filters.wing} onChange={(event) => choose({ wing: event.target.value, department: "", level: "" })} options={[{ value: "", label: t("results.insights.all") }, ...options.wings]} />
        ) : null}
        <Select
          label={t("results.insights.department")}
          value={filters.department}
          onChange={(event) => choose({ department: event.target.value, level: "" })}
          options={[{ value: "", label: t("results.insights.allDepartments") }, ...options.departments]}
        />
        <Select label={t("results.insights.level")} value={filters.level} onChange={(event) => choose({ level: event.target.value })} options={[{ value: "", label: t("results.insights.allLevels") }, ...options.levels]} />
        {narrowed ? (
          <Button variant="secondary" onClick={() => setFilters({ ...NO_FILTERS, exam: filters.exam })}>
            {t("content.clearFilters")}
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>{t("results.insights.noMatch")}</p>
      ) : (
        <>
          <dl className={styles.figures}>
            <div className={styles.figure} data-tone="accent">
              <dt>{t("results.insights.published")}</dt>
              <dd>{sum.published}</dd>
            </div>
            <div className={styles.figure}>
              <dt>{t("results.insights.students")}</dt>
              <dd>{sum.students.toLocaleString("en-IN")}</dd>
            </div>
            <div className={styles.figure} data-tone={sum.avgPercentHundredths === null ? undefined : sum.avgPercentHundredths >= 6000 ? "ok" : "warn"}>
              <dt>{t("results.insights.average")}</dt>
              <dd>{sum.avgPercentHundredths === null ? "–" : shortPercent(sum.avgPercentHundredths)}</dd>
            </div>
            <div className={styles.figure} data-tone={sum.passPercent === null ? undefined : sum.passPercent >= 80 ? "ok" : "warn"}>
              <dt>{t("results.insights.passRate")}</dt>
              <dd>
                {sum.passPercent === null ? "–" : `${sum.passPercent}%`}
                {sum.passPercent === null ? <small>{t("results.insights.passRateWhen")}</small> : null}
              </dd>
            </div>
          </dl>

          <section className={styles.chart} aria-labelledby={bandsId}>
            <h3 id={bandsId} className={styles.chartTitle}>
              {t("results.insights.bands")}
            </h3>
            <ScoreSplit bands={sum.bands} id={bandsId} />
          </section>

          {wings.map((wing) => (
            <section key={wing.name} className={styles.wing} aria-label={wing.name}>
              {wings.length > 1 ? <h3 className={styles.wingTitle}>{wing.name}</h3> : null}
              <ul className={classStyles.courses}>
                {wing.departments.map((dept) => {
                  const i = index++;
                  return <DepartmentCard key={dept.name} dept={dept} tone={TONES[i % TONES.length]!} startOpen={narrowed || i === 0} sheet={sheet} lone={rows.length === 1} />;
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/** The published results, loaded, for the Principal's Results tab and the class sheets page. */
export function ResultsInsights({ sheet }: { sheet?: SheetOf }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadPublishedResults(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<PublishedResults>(loadNow);
  if (view.status === "loading") return <TableSkeleton rows={4} tiles={4} />;
  if (view.status === "failed" || view.status === "forbidden") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <ResultsInsightsView data={view.data} sheet={sheet} />;
}
