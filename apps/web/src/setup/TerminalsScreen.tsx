"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, Panel, ReadHeader, ReadOnlyNote, ReadTable, readStyles } from "@/read/ReadView";
import { Facts } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useRememberedTerm } from "@/shell/TermChoice";
import { Button, Checkbox, Field, Notice, Select } from "@/ui";

import { YearPicker } from "./ClassesScreen";
import { loadExamPattern, loadYears, saveExamPattern, type ExamPatternInput, type Loaded } from "./client";
import { REASON_MESSAGE, canManageInstitution, startYearId, termWords, type ExamPattern, type Terminal } from "./model";
import { ReadSetupHeader, TerminalsTable, midSentence } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

/**
 * The exam pattern (D-117): one per academic term, out of 100, made by the Co-ordinator. Every class in the term follows
 * it. It asks the PM's questions (Grade system? the minimum % for theory and practical; the grade ranges when graded)
 * and lists the term's exams with their weights, adding up to 100, and whether each holds the practical. Once marks are
 * entered in the term it is locked and only read.
 */

/** The term's exams in order, with their weights and the practical (the Principal's read, and the locked pattern). */
export function TerminalsView({ terminals }: { terminals: readonly Terminal[] }) {
  const { term } = useConfig();
  return <TerminalsTable terminals={terminals} words={termWords(term)} />;
}

/** The pattern's answers as facts, and its grade ranges. */
export function PatternView({ pattern }: { pattern: ExamPattern }) {
  const { term } = useConfig();
  const p = pattern.pattern;
  if (!p) return <EmptyLine>{t("setup.pattern.none", { coordinator: term("role.coordinator") })}</EmptyLine>;
  return (
    <>
      <Panel title={t("setup.pattern.answers")} labelledBy="pattern-answers">
        <Facts
          rows={[
            { name: t("setup.pattern.graded"), value: t(p.graded ? "setup.pattern.gradedYes" : "setup.pattern.gradedNo") },
            { name: t("setup.pattern.theoryMin"), value: t("setup.pattern.percent", { n: p.theoryMinPercent }) },
            { name: t("setup.pattern.practicalMin"), value: t("setup.pattern.percent", { n: p.practicalMinPercent }) },
          ]}
        />
      </Panel>
      <TerminalsView terminals={pattern.terminals} />
      {p.graded && p.gradeBands ? (
        <Panel>
          <ReadTable
            caption={t("setup.pattern.bands")}
            rows={p.gradeBands}
            rowKey={(b) => b.grade}
            columns={[
              { key: "grade", label: t("setup.pattern.grade"), primary: true, cell: (b) => b.grade },
              { key: "from", label: t("setup.pattern.from"), align: "end", cell: (b) => t("setup.pattern.percent", { n: b.from }) },
            ]}
          />
        </Panel>
      ) : null}
    </>
  );
}

interface Row {
  id?: string;
  name: string;
  weight: string;
  hasPractical: boolean;
}
interface Band {
  grade: string;
  from: string;
}

const wholePercent = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) && Number(text.trim()) <= 100 ? Number(text.trim()) : null);

/** The form, filled from the pattern when there is one. One primary action: Save. */
export function PatternForm({ yearId, pattern, onSaved }: { yearId: string; pattern: ExamPattern; onSaved: () => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const p = pattern.pattern;
  const [graded, setGraded] = useState(p?.graded ?? false);
  const [theoryMin, setTheoryMin] = useState(String(p?.theoryMinPercent ?? 35));
  const [practicalMin, setPracticalMin] = useState(String(p?.practicalMinPercent ?? 40));
  const [rows, setRows] = useState<Row[]>(
    pattern.terminals.length > 0
      ? pattern.terminals.map((x) => ({ id: x.id, name: x.name, weight: x.weight === null ? "" : String(x.weight), hasPractical: x.hasPractical }))
      : [{ name: "", weight: "100", hasPractical: false }],
  );
  const [bands, setBands] = useState<Band[]>(p?.gradeBands ? p.gradeBands.map((b) => ({ grade: b.grade, from: String(b.from) })) : [{ grade: "", from: "" }]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const total = rows.reduce((sum, r) => sum + (wholePercent(r.weight) ?? 0), 0);
  const setRow = (i: number, change: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const setBand = (i: number, change: Partial<Band>) => setBands((all) => all.map((b, j) => (j === i ? { ...b, ...change } : b)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    const theory = wholePercent(theoryMin);
    const practical = wholePercent(practicalMin);
    const problemKey: MessageKey | null =
      theory === null || practical === null
        ? "setup.pattern.error.minimum"
        : rows.some((r) => !r.name.trim() || wholePercent(r.weight) === null || wholePercent(r.weight) === 0)
          ? "setup.pattern.error.terminal"
          : total !== 100
            ? "setup.pattern.error.total"
            : graded && bands.some((b) => !b.grade.trim() || wholePercent(b.from) === null)
              ? "setup.pattern.error.band"
              : null;
    if (problemKey) {
      setProblem(t(problemKey, { ...words, total }));
      return;
    }
    const body: ExamPatternInput = {
      graded,
      theoryMinPercent: theory!,
      practicalMinPercent: practical!,
      gradeBands: graded ? bands.map((b) => ({ grade: b.grade.trim(), from: wholePercent(b.from)! })) : null,
      terminals: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), weight: wholePercent(r.weight)!, hasPractical: r.hasPractical })),
    };
    setSaving(true);
    const result = await saveExamPattern(api, yearId, body);
    setSaving(false);
    if (result.ok) onSaved();
    else setProblem("message" in result ? result.message : t(REASON_MESSAGE[result.reason]));
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form} aria-label={t("setup.pattern.title")}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Select
        label={t("setup.pattern.graded")}
        hint={t("setup.pattern.gradedHint")}
        value={graded ? "yes" : "no"}
        onChange={(event) => setGraded(event.target.value === "yes")}
        options={[
          { value: "no", label: t("setup.pattern.gradedNo") },
          { value: "yes", label: t("setup.pattern.gradedYes") },
        ]}
      />
      <div className={styles.inline}>
        <Field label={t("setup.pattern.theoryMin")} inputMode="numeric" maxLength={3} autoComplete="off" value={theoryMin} onChange={(event) => setTheoryMin(event.target.value)} />
        <Field label={t("setup.pattern.practicalMin")} inputMode="numeric" maxLength={3} autoComplete="off" value={practicalMin} onChange={(event) => setPracticalMin(event.target.value)} />
      </div>
      <p className={readStyles.rowMeta}>{t("setup.pattern.minimumHint")}</p>

      <fieldset className={styles.levels}>
        <legend className={styles.formTitle}>{t("setup.pattern.terminals", words)}</legend>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className={styles.inline}>
            <Field label={t("setup.pattern.terminalName", { ...words, n: i + 1 })} maxLength={60} autoComplete="off" value={r.name} onChange={(event) => setRow(i, { name: event.target.value })} />
            <Field label={t("setup.pattern.weight")} inputMode="numeric" maxLength={3} autoComplete="off" value={r.weight} onChange={(event) => setRow(i, { weight: event.target.value })} />
            <Checkbox className={styles.wholeLine} label={t("setup.pattern.practical")} checked={r.hasPractical} onChange={(event) => setRow(i, { hasPractical: event.target.checked })} />
            {rows.length > 1 ? (
              <Button variant="quiet" aria-label={t("setup.pattern.removeTerminalItem", { ...words, n: i + 1 })} onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
                {t("setup.pattern.remove")}
              </Button>
            ) : null}
          </div>
        ))}
        <p className={readStyles.rowMeta} aria-live="polite">
          {t("setup.pattern.total", { total })}
        </p>
        {rows.length < 12 ? (
          <Button variant="secondary" onClick={() => setRows((all) => [...all, { name: "", weight: "", hasPractical: false }])}>
            {t("setup.pattern.addTerminal", words)}
          </Button>
        ) : null}
      </fieldset>

      {graded ? (
        <fieldset className={styles.levels}>
          <legend className={styles.formTitle}>{t("setup.pattern.bands")}</legend>
          <p className={readStyles.rowMeta}>{t("setup.pattern.bandsHint")}</p>
          {bands.map((b, i) => (
            <div key={i} className={styles.inline}>
              <Field label={t("setup.pattern.gradeN", { n: i + 1 })} maxLength={8} autoComplete="off" value={b.grade} onChange={(event) => setBand(i, { grade: event.target.value })} />
              <Field label={t("setup.pattern.from")} inputMode="numeric" maxLength={3} autoComplete="off" value={b.from} onChange={(event) => setBand(i, { from: event.target.value })} />
              {bands.length > 1 ? (
                <Button variant="quiet" aria-label={t("setup.pattern.removeGradeItem", { n: i + 1 })} onClick={() => setBands((all) => all.filter((_, j) => j !== i))}>
                  {t("setup.pattern.remove")}
                </Button>
              ) : null}
            </div>
          ))}
          {bands.length < 20 ? (
            <Button variant="secondary" onClick={() => setBands((all) => [...all, { grade: "", from: "" }])}>
              {t("setup.pattern.addGrade")}
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.pattern.save")}
      </Button>
    </form>
  );
}

export function TerminalsScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const roles = me?.roles ?? [];
  const canManage = canManageInstitution(roles);
  const words = termWords(term);
  const loadYearsNow = useCallback(() => loadYears(api), [api]);
  const years = useLoad(loadYearsNow);
  // Starts on the term remembered from the top bar (D-127) when it is one of these; choosing here remembers it.
  const { remembered, remember } = useRememberedTerm();
  const [picked, setPicked] = useState<string | null>(null);
  const yearId = picked ?? (years.view.status === "ready" ? startYearId(years.view.data.years, remembered) : null);
  const loadPatternNow = useCallback((): Promise<Loaded<ExamPattern | null>> => (yearId ? loadExamPattern(api, yearId) : Promise.resolve({ ok: true, data: null })), [api, yearId]);
  const pattern = useLoad(loadPatternNow);
  const [saved, setSaved] = useState(false);

  return (
    <>
      {canManage ? (
        <ReadHeader title={t("setup.pattern.title")} subtitle={t("setup.pattern.subtitle", midSentence(words))} />
      ) : (
        <ReadSetupHeader title={t("setup.pattern.title")} subtitle={t("setup.pattern.subtitle", midSentence(words))} />
      )}
      {saved ? <Notice tone="ok">{t("setup.pattern.saved")}</Notice> : null}
      <Gate view={years.view} onRetry={() => void years.reload()}>
        {({ years: list }) =>
          list.length === 0 ? (
            <p className={styles.empty}>{t("setup.classes.noYear")}</p>
          ) : (
            <>
              <div className={readStyles.search}>
                <YearPicker
                  years={list}
                  value={yearId}
                  onChange={(id) => {
                    setSaved(false);
                    setPicked(id);
                    remember(id);
                  }}
                />
              </div>
              <Gate view={pattern.view} onRetry={() => void pattern.reload()}>
                {(data) =>
                  data === null ? null : canManage && !data.locked && data.term.status !== "closed" ? (
                    <PatternForm
                      key={`${data.term.id}-${JSON.stringify(data.pattern)}-${data.terminals.map((x) => x.id).join()}`}
                      yearId={data.term.id}
                      pattern={data}
                      onSaved={() => {
                        setSaved(true);
                        void pattern.reload();
                      }}
                    />
                  ) : (
                    <>
                      {data.locked ? <ReadOnlyNote>{t("setup.error.patternLocked")}</ReadOnlyNote> : null}
                      <PatternView pattern={data} />
                    </>
                  )
                }
              </Gate>
            </>
          )
        }
      </Gate>
      {canManage ? null : <ReadOnlyNote>{t(roles.some((r) => r.role === "coordinator") ? "setup.institutionOnly" : "setup.read.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>}
    </>
  );
}
