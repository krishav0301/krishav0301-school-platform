"use client";

import { useCallback, useState } from "react";

import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { OpenLink, ReadFailure, ReadTable, TableSkeleton } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Select } from "@/ui";

import { gateFailure, loadPublishedResults } from "./client";
import {
  NO_FILTERS,
  applyFilters,
  classBars,
  classLabel,
  examLabel,
  filterOptions,
  scoreTone,
  shortPercent,
  subjectBars,
  summarise,
  type Bar,
  type InsightFilters,
  type PublishedResults,
  type PublishedRow,
} from "./insights-model";
import styles from "./results-insights.module.css";

const BAND_TONES = ["bad", "warn", "primary", "ok"] as const;
const BAND_LABELS = ["results.insights.band0", "results.insights.band1", "results.insights.band2", "results.insights.band3"] as const;

/** Horizontal bars, one per class or subject: the name, a bar that grows in, the value. Every bar's value is also text. Pure. */
export function BarList({ bars, label }: { bars: readonly Bar[]; label: string }) {
  return (
    <ul className={styles.bars} aria-label={label}>
      {bars.map((b) => (
        <li key={b.key} className={styles.bar}>
          <span className={styles.barName}>{b.label}</span>
          <span className={styles.track} aria-hidden>
            <span className={styles.fill} data-tone={scoreTone(b.value)} style={{ "--s": Math.min(1, b.value / 10000) } as React.CSSProperties} />
          </span>
          <span className={styles.barValue}>{shortPercent(b.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The filters, four figures, three graphs and the list of what is published. Pure: the data comes in, nothing is fetched. */
export function ResultsInsightsView({ data, showList = true }: { data: PublishedResults; showList?: boolean }) {
  const [filters, setFilters] = useState<InsightFilters>(NO_FILTERS);
  const options = filterOptions(data.results);
  const rows = applyFilters(data.results, filters);
  const sum = summarise(rows);
  const filtered = Object.values(filters).some(Boolean);
  const classes = classBars(rows);
  const subjects = subjectBars(rows);
  const scored = sum.bands.reduce((a, b) => a + b, 0);
  const choose = (patch: Partial<InsightFilters>) => setFilters((f) => ({ ...f, ...patch }));

  if (data.results.length === 0) return <p className={styles.empty}>{t("dashboard.glance.noResults")}</p>;
  return (
    <div className={styles.root}>
      <div className={styles.filters} role="group" aria-label={t("results.insights.filters")}>
        <Select label={t("results.terminal")} value={filters.exam} onChange={(event) => choose({ exam: event.target.value })} options={[{ value: "", label: t("results.insights.allExams") }, ...options.exams]} />
        <Select
          label={t("results.insights.department")}
          value={filters.department}
          onChange={(event) => choose({ department: event.target.value, classId: "" })}
          options={[{ value: "", label: t("results.insights.allDepartments") }, ...options.departments]}
        />
        <Select
          label={t("results.sheets.class")}
          value={filters.classId}
          onChange={(event) => choose({ classId: event.target.value })}
          options={[{ value: "", label: t("results.insights.allClasses") }, ...options.classes.filter((c) => !filters.department || data.results.some((r) => r.classId === c.value && r.programmeName === filters.department))]}
        />
        {filtered ? (
          <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
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

          <div className={styles.charts}>
            <section className={styles.chart} aria-labelledby="insight-classes">
              <h3 id="insight-classes" className={styles.chartTitle}>
                {t("results.insights.byClass")}
              </h3>
              <BarList bars={classes} label={t("results.insights.byClass")} />
            </section>

            <section className={styles.chart} aria-labelledby="insight-bands">
              <h3 id="insight-bands" className={styles.chartTitle}>
                {t("results.insights.bands")}
              </h3>
              <div className={styles.split} role="img" aria-label={sum.bands.map((n, i) => `${t(BAND_LABELS[i]!)}: ${n}`).join(", ")}>
                {sum.bands.map((n, i) => (
                  <span key={BAND_TONES[i]} className={styles.slice} data-tone={BAND_TONES[i]} style={{ "--n": n } as React.CSSProperties} />
                ))}
              </div>
              <ul className={styles.legend}>
                {sum.bands.map((n, i) => (
                  <li key={BAND_TONES[i]}>
                    <span className={styles.dot} data-tone={BAND_TONES[i]} aria-hidden />
                    {t(BAND_LABELS[i]!)}
                    <strong>{scored > 0 ? `${n} · ${Math.round((n * 100) / scored)}%` : n}</strong>
                  </li>
                ))}
              </ul>
            </section>

            {subjects.length > 0 ? (
              <section className={`${styles.chart} ${styles.wide}`} aria-labelledby="insight-subjects">
                <h3 id="insight-subjects" className={styles.chartTitle}>
                  {t("results.insights.bySubject")}
                </h3>
                <BarList bars={subjects} label={t("results.insights.bySubject")} />
              </section>
            ) : null}
          </div>

          {showList ? <PublishedList rows={rows} /> : null}
        </>
      )}
    </div>
  );
}

/** Each published result, newest first, with the link to its class sheet. Pure. */
export function PublishedList({ rows }: { rows: readonly PublishedRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <ReadTable
        caption={t("results.insights.list")}
        rows={rows}
        rowKey={(r) => `${r.classId}/${r.terminal?.id ?? "final"}`}
        columns={[
          { key: "class", label: t("results.sheets.class"), primary: true, cell: (r: PublishedRow) => classLabel(r) },
          { key: "exam", label: t("results.terminal"), cell: (r) => examLabel(r) },
          { key: "when", label: t("results.insights.publishedOn"), hidePhone: true, cell: (r) => (r.publishedOnBs ? formatBsDate(r.publishedOnBs) : "–") },
          { key: "cards", label: t("results.insights.students"), align: "end", hidePhone: true, cell: (r) => r.cards },
          { key: "avg", label: t("results.insights.average"), align: "end", cell: (r) => (r.avgPercentHundredths === null ? "–" : shortPercent(r.avgPercentHundredths)) },
          {
            key: "open",
            label: t("results.review.open"),
            align: "end",
            plain: true,
            cell: (r) => <OpenLink href={`/portal/results/sheets?class=${r.classId}&terminal=${r.terminal?.id ?? "final"}`} label={t("results.insights.openNamed", { name: `${classLabel(r)}, ${examLabel(r)}` })} />,
          },
        ]}
      />
    </div>
  );
}

/** The published results, loaded: for the Principal's Results tab (`showList` off, the dashboard has no room) and the class sheets page. */
export function ResultsInsights({ showList = true }: { showList?: boolean }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadPublishedResults(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<PublishedResults>(loadNow);
  if (view.status === "loading") return <TableSkeleton rows={4} tiles={4} />;
  if (view.status === "failed" || view.status === "forbidden") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <ResultsInsightsView data={view.data} showList={showList} />;
}
