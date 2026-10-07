"use client";

import { CircleCheck, CircleAlert, Info, Layers, Lock, Percent, Pencil, Save, TriangleAlert } from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { Panel, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, readStyles } from "@/read/ReadView";
import { Facts, PanelSection, SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useRememberedTerm } from "@/shell/TermChoice";
import { AddDialog, Button, Field, Notice, RowMenu, Select } from "@/ui";

import { YearPicker } from "./ClassesScreen";
import { loadExamPattern, loadYears, saveExamPattern, type Loaded } from "./client";
import {
  MAX_EXAMS,
  TOTAL_WEIGHT,
  canSave,
  draftFrom,
  editability,
  examProblem,
  isDirty,
  patternState,
  remainingWeight,
  settingsProblem,
  toInput,
  totalWeight,
  typedWeight,
  withExam,
  withoutExam,
  type Draft,
  type DraftExam,
  type Editable,
  type ExamProblem,
  type PatternState,
  type Settings,
} from "./exam-pattern-model";
import styles from "./exam-pattern.module.css";
import { REASON_MESSAGE, canManageInstitution, startYearId, termWords, type ExamPattern } from "./model";
import { ReadSetupHeader, midSentence } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import setupStyles from "./setup.module.css";

/**
 * The exam pattern (D-117, redesigned D-132): one per academic term, out of 100, made by the Co-ordinator. Every class in
 * the term follows it. The screen answers "what is the exam structure for this term?": where it stands, the three figures,
 * and the exams. Adding, changing and removing an exam works on a draft; the server takes the whole pattern at once and
 * only when it adds up to 100, so the draft is saved when it does. Once marks are entered in the term the pattern is
 * locked and only read.
 */

// --- Where the pattern stands ----------------------------------------------------------------------

type CardTone = "ok" | "warn" | "bad" | "info";

interface StatusShape {
  tone: CardTone;
  title: MessageKey;
  body: MessageKey;
  icon: "ok" | "warn" | "info";
}

/** Which card to show, from the draft and what may be done. Pure. */
export function statusShape(state: PatternState, dirty: boolean, editable: boolean): StatusShape | null {
  if (state === "empty") return null;
  if (state === "over") return { tone: "bad", title: "pattern.over.title", body: "pattern.over.body", icon: "warn" };
  if (state === "incomplete") return { tone: "warn", title: "pattern.incomplete.title", body: "pattern.incomplete.body", icon: "warn" };
  if (editable && dirty) return { tone: "info", title: "pattern.unsaved.title", body: "pattern.unsaved.body", icon: "info" };
  return { tone: "ok", title: "pattern.set.title", body: "pattern.set.body", icon: "ok" };
}

const ICONS = { ok: CircleCheck, warn: TriangleAlert, info: Info } as const;

export function StatusCard({ shape, term, total, actions }: { shape: StatusShape; term: string; total: number; actions: React.ReactNode }) {
  const Icon = ICONS[shape.icon];
  return (
    <div className={styles.card} data-tone={shape.tone} role="status">
      <span className={styles.cardIcon} aria-hidden>
        <Icon strokeWidth={1.75} />
      </span>
      <div className={styles.cardText}>
        <p className={styles.cardTitle}>{t(shape.title)}</p>
        <p className={styles.cardBody}>{t(shape.body, { term, remaining: TOTAL_WEIGHT - total, total })}</p>
      </div>
      <div className={styles.cardActions}>{actions}</div>
    </div>
  );
}

// --- The three figures -----------------------------------------------------------------------------

/** Total exams, total weight and what kind of pattern this is, worked out from the draft. Pure. */
export function Overview({ exams }: { exams: readonly DraftExam[] }) {
  const figures = [
    { key: "exams", icon: Layers, tone: "primary", label: t("pattern.ov.exams"), value: String(exams.length), note: t("pattern.ov.examsNote") },
    { key: "weight", icon: Percent, tone: "accent", label: t("pattern.ov.weight"), value: String(totalWeight(exams)), note: t("pattern.ov.weightNote") },
    { key: "type", icon: CircleCheck, tone: "ok", label: t("pattern.ov.type"), value: t("pattern.ov.typeValue"), note: t("pattern.ov.typeNote") },
  ] as const;
  return (
    <Panel title={t("pattern.overview")} labelledBy="pattern-overview">
      <ul className={styles.overview}>
        {figures.map((f) => (
          <li key={f.key} className={styles.stat}>
            <span className={styles.statIcon} data-tone={f.tone} aria-hidden>
              <f.icon strokeWidth={1.75} />
            </span>
            <span className={styles.statText}>
              <span className={styles.statLabel}>{f.label}</span>
              <span className={styles.statValue}>{f.value}</span>
              <span className={styles.statNote}>{f.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// --- The exams -------------------------------------------------------------------------------------

const practicalWords = (hasPractical: boolean) => t(hasPractical ? "pattern.theoryPractical" : "pattern.theoryOnly");

/** The exams in a table, stacked as cards on a phone. Actions only while the pattern can change. Pure. */
export function ExamsTable({ exams, savedIds, editable, onEdit, onRemove }: { exams: readonly DraftExam[]; savedIds: ReadonlySet<string>; editable: boolean; onEdit: (index: number) => void; onRemove: (index: number) => void }) {
  return (
    <>
      <ReadTable
        caption={t("pattern.components")}
        rows={exams}
        rowKey={(x) => x.id ?? `new-${x.name}`}
        columns={[
          { key: "n", label: t("pattern.col.number"), hidePhone: true, cell: (_, i) => i + 1 },
          { key: "name", label: t("pattern.col.name"), primary: true, cell: (x) => x.name },
          { key: "weight", label: t("setup.pattern.weight"), align: "end", cell: (x) => t("setup.pattern.percent", { n: x.weight }) },
          { key: "practical", label: t("pattern.col.practical"), cell: (x) => practicalWords(x.hasPractical) },
          {
            key: "status",
            label: t("pattern.col.status"),
            cell: (x) => (x.id && savedIds.has(x.id) ? <StatusWord tone="ok">{t("pattern.status.active")}</StatusWord> : <StatusWord tone="warn">{t("pattern.status.unsaved")}</StatusWord>),
          },
          {
            key: "actions",
            label: t("pattern.col.actions"),
            plain: true,
            align: "end",
            cell: (x, i) =>
              editable ? (
                <RowMenu
                  label={t("pattern.row.menu", { name: x.name })}
                  actions={[
                    { key: "edit", label: t("pattern.row.edit"), onSelect: () => onEdit(i) },
                    { key: "remove", label: t("pattern.row.remove"), onSelect: () => onRemove(i) },
                  ]}
                />
              ) : (
                <span className={styles.rowLocked}>
                  <Lock aria-hidden />
                  {t("pattern.row.locked")}
                </span>
              ),
          },
        ]}
      />
      <p className={styles.total} data-state={patternState(exams)} aria-live="polite">
        {t("pattern.totalLine", { total: totalWeight(exams) })}
      </p>
    </>
  );
}

// --- Adding or changing one exam --------------------------------------------------------------------

const PROBLEM_MESSAGE = (problem: ExamProblem): { field: "name" | "weight"; text: string } => {
  if (problem.field === "name") return { field: "name", text: t(problem.reason === "required" ? "pattern.error.nameRequired" : "pattern.error.nameDuplicate") };
  switch (problem.reason) {
    case "required":
      return { field: "weight", text: t("pattern.error.weightRequired") };
    case "notWhole":
      return { field: "weight", text: t("pattern.error.weightNotWhole") };
    case "zero":
      return { field: "weight", text: t("pattern.error.weightZero") };
    case "tooMuch":
      return { field: "weight", text: t(problem.remaining === 0 ? "pattern.error.weightNone" : "pattern.error.weightTooMuch", { n: problem.remaining ?? 0 }) };
  }
};

/** The form for one exam: its name, its weight with what is left, and whether it holds the practical. */
export function ExamForm({ exams, editing, onDone }: { exams: readonly DraftExam[]; editing?: number; onDone: (exam: DraftExam, editing?: number) => void }) {
  const current = editing === undefined ? undefined : exams[editing];
  const [name, setName] = useState(current?.name ?? "");
  const [weight, setWeight] = useState(current ? String(current.weight) : "");
  const [hasPractical, setHasPractical] = useState(current?.hasPractical ?? false);
  const [attempted, setAttempted] = useState(false);
  const done = useRef(false);
  const radio = useId();

  const others = exams.filter((_, i) => i !== editing);
  const remaining = remainingWeight(others);
  const problem = examProblem(exams, { name, weight }, editing);
  const typed = typedWeight(weight);
  // Say what is wrong once the person has typed in the box, or has tried to add; an empty box is not yet an error.
  const shown = (field: "name" | "weight", value: string) => (problem && problem.field === field && (attempted || value.trim() !== "") ? PROBLEM_MESSAGE(problem).text : undefined);
  const left = typed !== null && typed <= remaining ? remaining - typed : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (problem || done.current) return;
    done.current = true; // a double click or a second Enter adds nothing more
    onDone({ name: name.trim(), weight: Number(weight), hasPractical }, editing);
  }

  return (
    <form onSubmit={submit} noValidate className={styles.examForm}>
      <p className={styles.formIntro}>{t(editing === undefined ? "pattern.exam.addSub" : "pattern.exam.editSub")}</p>
      <Field
        label={t("pattern.exam.name")}
        placeholder={t("pattern.exam.namePlaceholder")}
        hint={t("pattern.exam.nameHint")}
        maxLength={60}
        autoComplete="off"
        value={name}
        error={shown("name", name)}
        onChange={(event) => setName(event.target.value)}
      />
      <Field
        label={t("pattern.exam.weight")}
        inputMode="numeric"
        maxLength={3}
        autoComplete="off"
        value={weight}
        error={shown("weight", weight)}
        onChange={(event) => setWeight(event.target.value)}
      />
      <p className={styles.remaining} data-state={problem?.field === "weight" && problem.reason === "tooMuch" ? "bad" : undefined} aria-live="polite">
        <span className={styles.remainingRule}>{t("pattern.exam.rule")}</span>
        <span className={styles.remainingLine}>{t("pattern.exam.current", { total: totalWeight(others) })}</span>
        <span className={styles.remainingLine}>{t(left === null ? "pattern.exam.left" : "pattern.exam.leftAfter", { n: left ?? remaining })}</span>
      </p>
      <fieldset className={styles.radioGroup}>
        <legend>{t("pattern.exam.practicalLegend")}</legend>
        <label className={styles.radioCard}>
          <input type="radio" name={radio} checked={!hasPractical} onChange={() => setHasPractical(false)} />
          <span className={styles.radioTitle}>{t("pattern.exam.theoryOnlyTitle")}</span>
          <span className={styles.radioBody}>{t("pattern.exam.theoryOnlyBody")}</span>
        </label>
        <label className={styles.radioCard}>
          <input type="radio" name={radio} checked={hasPractical} onChange={() => setHasPractical(true)} />
          <span className={styles.radioTitle}>{t("pattern.exam.bothTitle")}</span>
          <span className={styles.radioBody}>{t("pattern.exam.bothBody")}</span>
        </label>
      </fieldset>
      <div className={styles.formFoot}>
        <Button type="submit" disabled={problem !== null}>
          {t(editing === undefined ? "pattern.exam.submitAdd" : "pattern.exam.submitEdit")}
        </Button>
      </div>
    </form>
  );
}

/** "Add exam": the form in a pop-up. Gone once the pattern holds as many exams as it may. */
export function AddExamDialog({ exams, label, variant = "primary", onAdd }: { exams: readonly DraftExam[]; label: string; variant?: "primary" | "secondary"; onAdd: (exam: DraftExam) => void }) {
  if (exams.length >= MAX_EXAMS) return <p className={readStyles.rowMeta}>{t("pattern.exam.tooMany", { n: MAX_EXAMS })}</p>;
  return (
    <AddDialog label={label} title={t("pattern.exam.addTitle")} variant={variant}>
      {(close) => (
        <ExamForm
          exams={exams}
          onDone={(exam) => {
            onAdd(exam);
            close();
          }}
        />
      )}
    </AddDialog>
  );
}

// --- The pattern's settings -------------------------------------------------------------------------

/** The exams as a short list with the total, for the settings panel. */
function ExamSummary({ exams }: { exams: readonly DraftExam[] }) {
  return (
    <PanelSection title={t("pattern.components")}>
      <ul className={styles.summaryList}>
        {exams.map((x) => (
          <li key={x.id ?? `new-${x.name}`} className={styles.summaryItem}>
            <span className={styles.summaryName}>{x.name}</span>
            <span className={styles.summaryMeta}>
              {t("setup.pattern.percent", { n: x.weight })} · {practicalWords(x.hasPractical)}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.total} data-state={patternState(exams)}>
        {t("pattern.totalLine", { total: totalWeight(exams) })}
      </p>
    </PanelSection>
  );
}

/** The settings as facts, with the grade ranges, when nothing can change. */
function SettingsFacts({ settings }: { settings: Settings }) {
  return (
    <>
      <Facts
        rows={[
          { name: t("setup.pattern.graded"), value: t(settings.graded ? "setup.pattern.gradedYes" : "setup.pattern.gradedNo") },
          { name: t("setup.pattern.theoryMin"), value: t("setup.pattern.percent", { n: settings.theoryMin }) },
          { name: t("setup.pattern.practicalMin"), value: t("setup.pattern.percent", { n: settings.practicalMin }) },
        ]}
      />
      {settings.graded ? (
        <PanelSection title={t("setup.pattern.bands")}>
          <Facts rows={settings.bands.map((b) => ({ name: b.grade, value: t("setup.pattern.percent", { n: b.from }) }))} />
        </PanelSection>
      ) : null}
    </>
  );
}

const whyNote = (why: Extract<Editable, { editable: false }>["why"], coordinator: string, isCoordinator: boolean): string =>
  why === "locked" ? t("setup.error.patternLocked") : why === "closed" ? t("pattern.closed") : t(isCoordinator ? "setup.institutionOnly" : "setup.read.readOnly", { coordinator });

/**
 * View pattern / Edit pattern: the term's settings (the grade system, the minimum to pass in theory and practical, and
 * the grade ranges) with the exams below them. They belong here, not in the add-exam form. Read-only when the pattern
 * cannot change, and then it says why.
 */
export function PatternPanel({
  draft,
  term,
  editable,
  saving,
  problem,
  onClose,
  onApply,
}: {
  draft: Draft;
  term: string;
  editable: Editable;
  saving: boolean;
  problem: string | null;
  onClose: () => void;
  onApply: (settings: Settings, save: boolean) => void;
}) {
  const { me } = useSession();
  const { term: words } = useConfig();
  const [settings, setSettings] = useState<Settings>(draft.settings);
  const [attempted, setAttempted] = useState(false);
  const bad = settingsProblem(settings);
  const complete = patternState(draft.exams) === "complete";
  const setBand = (i: number, change: Partial<Settings["bands"][number]>) => setSettings((s) => ({ ...s, bands: s.bands.map((b, j) => (j === i ? { ...b, ...change } : b)) }));

  if (!editable.editable) {
    return (
      <SidePanel title={t("pattern.panel.title")} subtitle={term} onClose={onClose}>
        <ReadOnlyNote>{whyNote(editable.why, words("role.coordinator"), me?.roles.some((r) => r.role === "coordinator") ?? false)}</ReadOnlyNote>
        <PanelSection title={t("pattern.settings.title")}>
          <SettingsFacts settings={draft.settings} />
        </PanelSection>
        <ExamSummary exams={draft.exams} />
      </SidePanel>
    );
  }

  return (
    <SidePanel
      title={t("pattern.panel.title")}
      subtitle={term}
      busy={saving}
      onClose={onClose}
      foot={
        <div className={styles.formFoot}>
          <Button variant="quiet" disabled={saving} onClick={onClose}>
            {t("pattern.exam.cancel")}
          </Button>
          <Button
            loading={saving}
            loadingLabel={t("setup.working")}
            onClick={() => {
              setAttempted(true);
              if (bad === null) onApply(settings, complete);
            }}
          >
            {t(complete ? "setup.pattern.save" : "pattern.settings.keep")}
          </Button>
        </div>
      }
    >
      <div className={styles.settings}>
        {problem ? <Notice tone="bad">{problem}</Notice> : null}
        {!complete ? <Notice>{t("pattern.settings.cantSave", { total: totalWeight(draft.exams) })}</Notice> : null}
        <PanelSection title={t("pattern.settings.title")}>
          <div className={setupStyles.form}>
            <Select
              label={t("setup.pattern.graded")}
              hint={t("setup.pattern.gradedHint")}
              value={settings.graded ? "yes" : "no"}
              onChange={(event) => setSettings((s) => ({ ...s, graded: event.target.value === "yes" }))}
              options={[
                { value: "no", label: t("setup.pattern.gradedNo") },
                { value: "yes", label: t("setup.pattern.gradedYes") },
              ]}
            />
            <p className={styles.settingsHead}>{t("pattern.settings.minimum")}</p>
            <div className={setupStyles.inline}>
              <Field label={t("setup.pattern.theoryMin")} inputMode="numeric" maxLength={3} autoComplete="off" value={settings.theoryMin} onChange={(event) => setSettings((s) => ({ ...s, theoryMin: event.target.value }))} />
              <Field label={t("setup.pattern.practicalMin")} inputMode="numeric" maxLength={3} autoComplete="off" value={settings.practicalMin} onChange={(event) => setSettings((s) => ({ ...s, practicalMin: event.target.value }))} />
            </div>
            {attempted && bad === "minimum" ? <Notice tone="bad">{t("setup.pattern.error.minimum")}</Notice> : null}
            <p className={readStyles.rowMeta}>{t("setup.pattern.minimumHint")}</p>
            {settings.graded ? (
              <fieldset className={setupStyles.levels}>
                <legend className={setupStyles.formTitle}>{t("setup.pattern.bands")}</legend>
                <p className={readStyles.rowMeta}>{t("setup.pattern.bandsHint")}</p>
                {settings.bands.map((b, i) => (
                  <div key={i} className={setupStyles.inline}>
                    <Field label={t("setup.pattern.gradeN", { n: i + 1 })} maxLength={8} autoComplete="off" value={b.grade} onChange={(event) => setBand(i, { grade: event.target.value })} />
                    <Field label={t("setup.pattern.from")} inputMode="numeric" maxLength={3} autoComplete="off" value={b.from} onChange={(event) => setBand(i, { from: event.target.value })} />
                    {settings.bands.length > 1 ? (
                      <Button variant="quiet" aria-label={t("setup.pattern.removeGradeItem", { n: i + 1 })} onClick={() => setSettings((s) => ({ ...s, bands: s.bands.filter((_, j) => j !== i) }))}>
                        {t("setup.pattern.remove")}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {settings.bands.length < 20 ? (
                  <Button variant="secondary" onClick={() => setSettings((s) => ({ ...s, bands: [...s.bands, { grade: "", from: "" }] }))}>
                    {t("setup.pattern.addGrade")}
                  </Button>
                ) : null}
                {attempted && bad === "band" ? <Notice tone="bad">{t("setup.pattern.error.band")}</Notice> : null}
              </fieldset>
            ) : null}
          </div>
        </PanelSection>
        <ExamSummary exams={draft.exams} />
      </div>
    </SidePanel>
  );
}

// --- The screen --------------------------------------------------------------------------------------

/** The pattern of one term, with its draft. Remounted when the saved pattern changes, so the draft starts from it. */
export function PatternBoard({ saved, canManage, onSaved }: { saved: ExamPattern; canManage: boolean; onSaved: () => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved));
  const [editing, setEditing] = useState<number | null>(null);
  const [panel, setPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const editable = editability(saved, canManage);
  const state = patternState(draft.exams);
  const total = totalWeight(draft.exams);
  const dirty = isDirty(draft, saved);
  const shape = statusShape(state, dirty, editable.editable);
  const savedIds = new Set(saved.terminals.map((x) => x.id));
  const mayAdd = editable.editable;

  const addExam = (exam: DraftExam) => setDraft((d) => ({ ...d, exams: withExam(d.exams, exam) }));

  async function save(next: Draft) {
    if (saving || !canSave(next)) return;
    setSaving(true);
    setProblem(null);
    const result = await saveExamPattern(api, saved.term.id, toInput(next));
    setSaving(false);
    if (result.ok) {
      setPanel(false);
      onSaved();
    } else setProblem("message" in result ? result.message : t(REASON_MESSAGE[result.reason]));
  }

  const actions = (
    <>
      {editable.editable && dirty ? (
        <>
          <Button variant="quiet" disabled={saving} onClick={() => setDraft(draftFrom(saved))}>
            {t("pattern.discard")}
          </Button>
          <Button loading={saving} loadingLabel={t("setup.working")} disabled={!canSave(draft)} onClick={() => void save(draft)}>
            <Save aria-hidden />
            {t("setup.pattern.save")}
          </Button>
        </>
      ) : null}
      {mayAdd && state === "incomplete" ? <AddExamDialog exams={draft.exams} label={t("pattern.add")} variant="secondary" onAdd={addExam} /> : null}
      {state !== "empty" ? (
        <Button variant="secondary" onClick={() => setPanel(true)}>
          {editable.editable ? <Pencil aria-hidden /> : null}
          {t(editable.editable ? "pattern.edit" : "pattern.view")}
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      {problem && !panel ? <Notice tone="bad">{problem}</Notice> : null}
      {shape ? <StatusCard shape={shape} term={saved.term.label} total={total} actions={actions} /> : null}
      <Overview exams={draft.exams} />
      <Panel title={t("pattern.components")} labelledBy="pattern-components" actions={mayAdd && state !== "empty" ? <AddExamDialog exams={draft.exams} label={t("pattern.add")} onAdd={addExam} /> : undefined}>
        {state === "empty" ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{t("pattern.empty.title")}</p>
            <p className={styles.emptyBody}>{mayAdd ? t("pattern.empty.body") : t("setup.pattern.none", { coordinator: term("role.coordinator") })}</p>
            {mayAdd ? <AddExamDialog exams={draft.exams} label={t("pattern.addFirst")} onAdd={addExam} /> : null}
          </div>
        ) : (
          <ExamsTable exams={draft.exams} savedIds={savedIds} editable={editable.editable} onEdit={setEditing} onRemove={(i) => setDraft((d) => ({ ...d, exams: withoutExam(d.exams, i) }))} />
        )}
      </Panel>
      <div className={styles.important}>
        <CircleAlert aria-hidden strokeWidth={1.75} />
        <div>
          <p className={styles.importantTitle}>{t("pattern.important.title")}</p>
          <p className={styles.importantBody}>{t("pattern.important.body")}</p>
        </div>
      </div>
      {editing !== null && draft.exams[editing] ? (
        <SidePanel title={t("pattern.exam.editTitle")} subtitle={draft.exams[editing]!.name} onClose={() => setEditing(null)}>
          <ExamForm
            exams={draft.exams}
            editing={editing}
            onDone={(exam, at) => {
              setDraft((d) => ({ ...d, exams: withExam(d.exams, exam, at) }));
              setEditing(null);
            }}
          />
        </SidePanel>
      ) : null}
      {panel ? (
        <PatternPanel
          draft={draft}
          term={saved.term.label}
          editable={editable}
          saving={saving}
          problem={problem}
          onClose={() => setPanel(false)}
          onApply={(settings, doSave) => {
            const next = { ...draft, settings };
            setDraft(next);
            if (doSave) void save(next);
            else setPanel(false);
          }}
        />
      ) : null}
    </>
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
            <p className={setupStyles.empty}>{t("setup.classes.noYear")}</p>
          ) : (
            <>
              <div className={styles.top}>
                <div className={styles.picker}>
                  <YearPicker
                    years={list}
                    value={yearId}
                    onChange={(id) => {
                      setSaved(false);
                      setPicked(id);
                      remember(id);
                    }}
                  />
                  <Gate view={pattern.view} onRetry={() => void pattern.reload()}>
                    {(data) => {
                      if (data === null) return null;
                      const why = editability(data, canManage);
                      return why.editable ? null : <ReadOnlyNote>{whyNote(why.why, term("role.coordinator"), roles.some((r) => r.role === "coordinator"))}</ReadOnlyNote>;
                    }}
                  </Gate>
                </div>
              </div>
              <Gate view={pattern.view} onRetry={() => void pattern.reload()}>
                {(data) =>
                  data === null ? null : (
                    <PatternBoard
                      key={`${data.term.id}-${JSON.stringify(data.pattern)}-${data.terminals.map((x) => `${x.id}:${x.name}:${x.weight}:${x.hasPractical}`).join()}`}
                      saved={data}
                      canManage={canManage}
                      onSaved={() => {
                        setSaved(true);
                        void pattern.reload();
                      }}
                    />
                  )
                }
              </Gate>
            </>
          )
        }
      </Gate>
    </>
  );
}
