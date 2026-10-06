"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { BsDateField } from "@/content/BsDateField";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Column } from "@/read/ReadView";
import { Facts, PanelSection, SidePanel } from "@/read/SidePanel";
import { useConfig } from "@/config/ConfigProvider";
import { useSession } from "@/session/SessionProvider";
import { coursesOf, levelsOf, settle, wingsOf, type KeepLevel } from "@/setup/structure-picker";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Checkbox, Field, Notice, Select } from "@/ui";

import { FAIL_MESSAGE, closeTerm, createTerm, loadCloseCheck, loadNextTerm, loadProgrammes, loadTerms, openTerm, updateTerm, type Fail, type FormResult } from "./client";
import {
  TERM_STATUS,
  emptyTermForm,
  levelOffer,
  levelSummary,
  levelsTaken,
  misfitLevels,
  oddLevels,
  termDates,
  termMonthsBs,
  type CloseCheck,
  type Programme,
  type Term,
  type TermFormErrors,
  type TermFormValues,
} from "./model";
import { ActiveTerms, OtherTerms, TermsBanner, type Manage, type TermStart } from "./TermsBoard";
import styles from "./terms.module.css";

/** Today's AD day in Nepal (UTC+5:45), "YYYY-MM-DD". */
const nepalToday = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);

const failText = (fail: Fail): string => (fail.reason === "rule" ? fail.message : t(FAIL_MESSAGE[fail.reason]));

/** The terms, open ones first, in the Principal's table (D-103). An action column only where something can be done. Pure. */
export function TermsTable({ terms, onOpen }: { terms: readonly Term[]; onOpen?: (term: Term) => void }) {
  if (terms.length === 0) return <EmptyLine>{t(onOpen ? "terms.empty" : "terms.emptyReadOnly")}</EmptyLine>;
  const columns: Column<Term>[] = [
    {
      key: "term",
      label: t("terms.col.term"),
      primary: true,
      cell: (x) => (
        <span className={styles.cellStack}>
          <span>{x.label}</span>
          <span className={styles.meta}>{t("terms.receiptCode", { code: x.code })}</span>
        </span>
      ),
    },
    { key: "dates", label: t("terms.col.dates"), cell: (x) => termDates(x) },
    {
      key: "levels",
      label: t("terms.col.levels"),
      cell: (x) => {
        const misfits = misfitLevels(x);
        return misfits.length === 0 ? (
          levelSummary(x.levels)
        ) : (
          <span className={styles.cellStack}>
            <span>{levelSummary(x.levels)}</span>
            <span className={styles.meta}>{t("terms.misfit", { levels: misfits.map((l) => `${l.programmeName} · ${l.name}`).join(", "), months: x.months ?? 0 })}</span>
          </span>
        );
      },
    },
    { key: "classes", label: t("terms.col.classes"), align: "end", cell: (x) => String(x.classes) },
    { key: "students", label: t("terms.col.students"), align: "end", cell: (x) => String(x.students) },
    { key: "status", label: t("terms.col.status"), plain: true, cell: (x) => <StatusWord tone={TERM_STATUS[x.status].tone}>{t(TERM_STATUS[x.status].key)}</StatusWord> },
  ];
  if (onOpen) {
    columns.push({
      key: "open",
      label: t("terms.col.action"),
      align: "end",
      plain: true,
      cell: (x) => (
        <Button variant="quiet" onClick={() => onOpen(x)} aria-label={t("terms.manageNamed", { name: x.label })}>
          {t("terms.manage")}
        </Button>
      ),
    });
  }
  return <ReadTable caption={t("terms.caption")} columns={columns} rows={terms} rowKey={(x) => x.id} />;
}

/**
 * The levels a term runs (D-114, FUT points 4 to 6): first the wing, then each of its courses with the levels that may
 * join. A level is offered only if it is free (no other open term runs it, D-110) and runs as many months as the term.
 * Levels the term already runs (`kept`) stay, flagged if their length no longer matches. What was hidden is counted.
 */
export function LevelPicker({
  programmes,
  taken,
  months,
  value,
  kept = [],
  onChange,
  error,
}: {
  programmes: readonly Programme[];
  taken: ReadonlyMap<string, string>;
  /** The term's length from its days; null until both are entered. */
  months: number | null;
  value: readonly string[];
  /** The levels the term runs now (an existing term). */
  kept?: readonly string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const { term } = useConfig();
  const [wingKey, setWingKey] = useState<string | null>(null);
  const chosen = new Set(value);
  const keptSet = new Set(kept);
  const offered = (level: { id: string; usualMonths: number | null }) => keptSet.has(level.id) || levelOffer(level, months, taken) === "ok";
  const keep: KeepLevel = (level) => offered(level);

  if (months === null && kept.length === 0) {
    return (
      <fieldset className={styles.picker}>
        <legend>{t("terms.form.levels")}</legend>
        <EmptyLine>{t("terms.form.daysFirst")}</EmptyLine>
      </fieldset>
    );
  }

  const hidden = { taken: 0, otherLength: 0, noLength: 0 };
  for (const p of programmes) {
    if (!p.active) continue;
    for (const l of p.levels) {
      if (!l.active || offered(l)) continue;
      const why = levelOffer(l, months, taken);
      if (why === "taken" || why === "otherLength" || why === "noLength") hidden[why] += 1;
    }
  }
  const hiddenTotal = hidden.taken + hidden.otherLength + hidden.noLength;
  const wings = wingsOf(programmes, keep);
  const wing = settle(programmes, { sectionKey: wingKey, programmeId: null, levelId: null }, keep).sectionKey;
  const courses = wing ? coursesOf(programmes, wing, keep) : [];
  const elsewhere = programmes.filter((p) => p.section.key !== wing).flatMap((p) => p.levels.filter((l) => chosen.has(l.id)).map((l) => ({ programmeName: p.name, name: l.name })));
  const set = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange([...next]);
  };

  return (
    <fieldset className={styles.picker}>
      <legend>{t("terms.form.levels")}</legend>
      <p className={styles.meta}>{t("terms.form.levelsHint")}</p>
      {wings.length === 0 ? <EmptyLine>{t("terms.form.noneFits", { months: months ?? 0 })}</EmptyLine> : null}
      {wings.length > 1 ? (
        <Select
          label={term("term.section")}
          value={wing ?? ""}
          options={[{ value: "", label: t("setup.programmes.choose") }, ...wings.map((w) => ({ value: w.key, label: w.name }))]}
          onChange={(event) => setWingKey(event.target.value || null)}
        />
      ) : wings.length === 1 ? (
        <p className={styles.meta}>{wings[0]!.name}</p>
      ) : null}
      {courses.map((programme) => {
        const levels = levelsOf(programme, keep);
        const free = levels.filter((l) => levelOffer(l, months, taken) === "ok").map((l) => l.id);
        return (
          <div key={programme.id} className={styles.programme}>
            <div className={styles.programmeHead}>
              <h3 className={styles.programmeName}>{programme.name}</h3>
              {free.length > 1 ? (
                <div className={styles.shortcuts}>
                  <Button variant="quiet" onClick={() => set(free, true)} aria-label={t("terms.form.allNamed", { name: programme.name })}>
                    {t("terms.form.all")}
                  </Button>
                  <Button variant="quiet" onClick={() => onChange([...value.filter((id) => !programme.levels.some((l) => l.id === id)), ...oddLevels(programme).filter((id) => free.includes(id))])} aria-label={t("terms.form.oddNamed", { name: programme.name })}>
                    {t("terms.form.odd")}
                  </Button>
                </div>
              ) : null}
            </div>
            <div className={styles.levels}>
              {levels.map((level) => (
                <Checkbox
                  key={level.id}
                  label={level.name}
                  hint={keptSet.has(level.id) && months !== null && level.usualMonths !== months ? (level.usualMonths === null ? t("terms.form.noLength") : t("terms.form.runsMonths", { count: level.usualMonths })) : undefined}
                  checked={chosen.has(level.id)}
                  onChange={(event) => set([level.id], event.target.checked)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {elsewhere.length > 0 ? <p className={styles.meta}>{t("terms.form.alsoChosen", { levels: levelSummary(elsewhere) })}</p> : null}
      {hiddenTotal > 0 ? <p className={styles.meta}>{hiddenLine(hidden, hiddenTotal)}</p> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </fieldset>
  );
}

/** "4 levels are not offered: 1 in another open term, 2 of another length, 1 with no length set." */
function hiddenLine(hidden: { taken: number; otherLength: number; noLength: number }, total: number): string {
  const parts = [
    hidden.taken ? t("terms.form.hiddenTaken", { count: hidden.taken }) : null,
    hidden.otherLength ? t("terms.form.hiddenOtherLength", { count: hidden.otherLength }) : null,
    hidden.noLength ? t("terms.form.hiddenNoLength", { count: hidden.noLength }) : null,
  ].filter(Boolean);
  return t(total === 1 ? "terms.form.hiddenOne" : "terms.form.hidden", { count: total, why: parts.join(", ") });
}

/**
 * A term's name, receipt code, days and levels. `mode`: a new term; a draft's whole details; or an open term's levels
 * only (its name and days are fixed once it is open).
 */
export function TermForm({
  initial,
  programmes,
  terms,
  termId = null,
  mode,
  submitLabel,
  onSaved,
}: {
  initial: TermFormValues;
  programmes: readonly Programme[];
  terms: readonly Term[];
  termId?: string | null;
  mode: "create" | "edit" | "levels";
  submitLabel: string;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const [values, setValues] = useState<TermFormValues>(initial);
  const [errors, setErrors] = useState<TermFormErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key) : undefined);
  const change = (patch: Partial<TermFormValues>, field: keyof TermFormValues) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    setSaving(true);
    const result: FormResult = mode === "create" ? await createTerm(api, values) : await updateTerm(api, termId!, values, mode === "levels");
    setSaving(false);
    if (result.ok) onSaved();
    else if (result.reason === "fields") setErrors(result.errors);
    else setProblem(failText(result));
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      {mode !== "levels" ? (
        <>
          <Field label={t("terms.form.name")} hint={t("terms.form.nameHint")} value={values.label} maxLength={60} autoComplete="off" onChange={(e) => change({ label: e.target.value }, "label")} error={say(errors.label)} />
          <Field label={t("terms.form.code")} hint={t("terms.form.codeHint")} value={values.code} maxLength={10} autoComplete="off" onChange={(e) => change({ code: e.target.value }, "code")} error={say(errors.code)} />
          <div className={styles.dates}>
            <BsDateField legend={t("terms.form.start")} value={values.startBs} onChange={(startBs) => change({ startBs }, "startBs")} error={say(errors.startBs)} />
            <BsDateField legend={t("terms.form.end")} value={values.endBs} onChange={(endBs) => change({ endBs }, "endBs")} error={say(errors.endBs)} />
          </div>
        </>
      ) : null}
      <LevelPicker
        programmes={programmes}
        taken={levelsTaken(terms, termId)}
        months={termMonthsBs(values.startBs, values.endBs)}
        value={values.levelIds}
        kept={initial.levelIds}
        onChange={(levelIds) => change({ levelIds }, "levelIds")}
      />
      <Button type="submit" loading={saving} loadingLabel={t("terms.saving")}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** The form values of an existing term. */
const valuesOf = (term: Term): TermFormValues => ({ label: term.label, code: term.code, startBs: term.startDateBs ?? "", endBs: term.endDateBs ?? "", levelIds: term.levels.map((l) => l.id) });

type Step = { kind: "view" } | { kind: "edit" } | { kind: "close"; check: CloseCheck | null } | { kind: "next"; values: TermFormValues | null };

/** One term, opened at the side: its facts, and what the Principal can do with it now. */
function TermPanel({ term, programmes, terms, start = "view", onClose, onDone }: { term: Term; programmes: readonly Programme[]; terms: readonly Term[]; start?: TermStart; onClose: () => void; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [step, setStep] = useState<Step>(() => (start === "edit" ? { kind: "edit" } : start === "close" ? { kind: "close", check: null } : start === "next" ? { kind: "next", values: null } : { kind: "view" }));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    const result = await openTerm(api, term.id);
    setBusy(false);
    if (result.ok) onDone(t("terms.done.opened", { name: term.label }));
    else setProblem(failText(result));
  }
  async function startClose() {
    setProblem(null);
    setStep({ kind: "close", check: null });
    await fetchCloseCheck();
  }
  async function fetchCloseCheck() {
    const loaded = await loadCloseCheck(api, term.id);
    if (loaded.ok) setStep({ kind: "close", check: loaded.data });
    else setProblem(t("terms.error.failed"));
  }
  async function close() {
    setBusy(true);
    const result = await closeTerm(api, term.id);
    setBusy(false);
    if (result.ok) onDone(t("terms.done.closed", { name: term.label }));
    else if (result.reason === "not_ready") setStep({ kind: "close", check: result.check });
    else setProblem(failText(result));
  }
  async function startNext() {
    setProblem(null);
    setStep({ kind: "next", values: null });
    await fetchNext();
  }
  async function fetchNext() {
    const loaded = await loadNextTerm(api, term.id);
    if (!loaded.ok) {
      setProblem(t("terms.error.failed"));
      return;
    }
    const n = loaded.data;
    setStep({ kind: "next", values: { label: n.label, code: n.code, startBs: n.startDateBs ?? "", endBs: n.endDateBs ?? "", levelIds: n.levels.filter((l) => !l.takenBy).map((l) => l.id) } });
  }

  // Opened from a menu on Close or Next: fetch what that step shows, once.
  useEffect(() => {
    if (start === "close") void fetchCloseCheck();
    if (start === "next") void fetchNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only for the step the panel opened on
  }, []);

  const status = TERM_STATUS[term.status];
  const foot =
    step.kind === "view" ? (
      <div className={styles.actions}>
        {term.status !== "closed" ? (
          <Button variant="quiet" className={styles.wrapLabel} onClick={() => setStep({ kind: "edit" })} disabled={busy}>
            {t(term.status === "draft" ? "terms.edit" : "terms.changeLevels")}
          </Button>
        ) : null}
        {term.status === "active" ? (
          <Button variant="quiet" className={styles.wrapLabel} onClick={() => void startNext()} disabled={busy}>
            {t("terms.next")}
          </Button>
        ) : null}
        {term.status === "draft" ? (
          <Button className={styles.wrapLabel} onClick={() => void open()} loading={busy} loadingLabel={t("terms.saving")}>
            {t("terms.open")}
          </Button>
        ) : null}
        {term.status === "active" ? (
          <Button className={styles.wrapLabel} onClick={() => void startClose()} disabled={busy}>
            {t("terms.close")}
          </Button>
        ) : null}
        {term.status === "closed" ? (
          <Button className={styles.wrapLabel} onClick={() => void startNext()} disabled={busy}>
            {t("terms.next")}
          </Button>
        ) : null}
      </div>
    ) : step.kind === "close" && step.check?.ready ? (
      <Button fullWidth onClick={() => void close()} loading={busy} loadingLabel={t("terms.saving")}>
        {t("terms.closeNow")}
      </Button>
    ) : undefined;

  return (
    <SidePanel title={term.label} subtitle={termDates(term)} status={<StatusWord tone={status.tone}>{t(status.key)}</StatusWord>} busy={busy} onClose={onClose} foot={foot}>
      <div className={styles.form}>
        {problem ? <Notice tone="bad">{problem}</Notice> : null}
        {step.kind === "view" ? (
          <>
            <Facts
              rows={[
                { name: t("terms.col.dates"), value: termDates(term) },
                { name: t("terms.form.code"), value: term.code },
                { name: t("terms.col.classes"), value: String(term.classes) },
                { name: t("terms.col.students"), value: String(term.students) },
              ]}
            />
            <PanelSection title={t("terms.col.levels")}>
              <p className={styles.meta}>{levelSummary(term.levels)}</p>
              {misfitLevels(term).length > 0 ? <Notice>{t("terms.misfit", { levels: misfitLevels(term).map((l) => `${l.programmeName} · ${l.name}`).join(", "), months: term.months ?? 0 })}</Notice> : null}
            </PanelSection>
            <p className={styles.meta}>{t(term.status === "draft" ? "terms.hint.draft" : term.status === "active" ? "terms.hint.active" : "terms.hint.closed")}</p>
          </>
        ) : null}
        {step.kind === "edit" ? (
          <TermForm initial={valuesOf(term)} programmes={programmes} terms={terms} termId={term.id} mode={term.status === "draft" ? "edit" : "levels"} submitLabel={t("terms.save")} onSaved={() => onDone(t("terms.done.saved", { name: term.label }))} />
        ) : null}
        {step.kind === "close" ? <CloseCheckView check={step.check} /> : null}
        {step.kind === "next" ? (
          step.values ? (
            <>
              <p className={styles.meta}>{t("terms.nextIntro")}</p>
              <TermForm initial={step.values} programmes={programmes} terms={terms} mode="create" submitLabel={t("terms.createNext")} onSaved={() => onDone(t("terms.done.created"))} />
            </>
          ) : (
            <TableSkeleton rows={3} />
          )
        ) : null}
      </div>
    </SidePanel>
  );
}

/** What still stops the term from closing, class by class and exam by exam; or that it is ready. */
export function CloseCheckView({ check }: { check: CloseCheck | null }) {
  if (!check) return <TableSkeleton rows={3} />;
  if (check.ready) return <Notice tone="ok">{t("terms.closeReady", { classes: check.classes })}</Notice>;
  return (
    <PanelSection title={t("terms.closeMissing")}>
      <p className={styles.meta}>{t("terms.closeMissingHint")}</p>
      <ul className={styles.missing}>
        {check.missing.map((m) => (
          <li key={`${m.classId}-${m.examId ?? "none"}`}>{m.examName ? t("terms.missingExam", { className: m.className, exam: m.examName }) : t("terms.missingNoExam", { className: m.className })}</li>
        ))}
      </ul>
    </PanelSection>
  );
}

/** The Principal's academic terms (D-109, D-110): every term with its levels, and the one place to make, open and close them. */
export function TermsScreen() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const [terms, programmes] = await Promise.all([loadTerms(api), loadProgrammes(api)]);
    if (!terms.ok) return terms;
    if (!programmes.ok) return programmes;
    return { ok: true as const, data: { terms: terms.data.years, programmes: programmes.data.programmes } };
  }, [api]);
  const { view, reload } = useLoad(loadNow);
  const [open, setOpen] = useState<{ term: Term; start: TermStart } | null>(null);
  const today = nepalToday();
  const manage: Manage = (term, start) => {
    setDone(null);
    setOpen({ term, start });
  };
  const [done, setDone] = useState<string | null>(null);
  const data = view.status === "ready" ? view.data : null;

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("terms.title")}
        subtitle={t("terms.pageSubtitle")}
        actions={
          data ? (
            <AddDialog label={t("terms.add")} title={t("terms.add")}>
              {(close) => (
                <TermForm
                  initial={emptyTermForm()}
                  programmes={data.programmes}
                  terms={data.terms}
                  mode="create"
                  submitLabel={t("terms.add")}
                  onSaved={() => {
                    close();
                    setDone(t("terms.done.created"));
                    void reload();
                  }}
                />
              )}
            </AddDialog>
          ) : null
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {done ? <Notice tone="ok">{done}</Notice> : null}
      {data ? (
        <>
          <TermsBanner />
          <ActiveTerms terms={data.terms} today={today} manage={manage} />
          <OtherTerms terms={data.terms} today={today} manage={manage} />
          {open ? (
            <TermPanel
              key={`${open.term.id}-${open.start}`}
              term={open.term}
              start={open.start}
              programmes={data.programmes}
              terms={data.terms}
              onClose={() => setOpen(null)}
              onDone={(text) => {
                setOpen(null);
                setDone(text);
                void reload();
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
