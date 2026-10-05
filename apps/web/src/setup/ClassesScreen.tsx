"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import { ReadHeader, ReadOnlyNote, readStyles } from "@/read/ReadView";

import { createClass, deleteClass, loadClasses, loadProgrammes, loadYears, renameClass, setClassActive, type Loaded } from "./client";
import { REASON_MESSAGE, canManageStructure, classTitle, defaultYearId, levelChoices, termWords, type Programme, type SchoolClass, type Year } from "./model";
import { DeleteControl } from "./ProgrammesScreen";
import { ClassesTable, ReadSetupHeader } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

/** Picks the year a screen is about. Shared by the classes and terminals screens. */
export function YearPicker({ years, value, onChange }: { years: readonly Year[]; value: string | null; onChange: (id: string) => void }) {
  return <Select label={t("setup.yearPicker")} value={value ?? ""} onChange={(event) => onChange(event.target.value)} options={years.map((y) => ({ value: y.id, label: y.label }))} />;
}

/**
 * The classes of the chosen year, in the table the Principal reads, with Switch off or on, and Delete for a class
 * nothing is attached to (D-097). Switching one off keeps its history. Redesigned in D-106.
 */
export function ClassesView({
  classes,
  canManage,
  busy,
  onToggle,
  onDelete,
  onRename,
}: {
  classes: readonly SchoolClass[];
  canManage: boolean;
  busy: string | null;
  onToggle: (c: SchoolClass) => void;
  /** A new section for the class (D-114); true when saved. */
  onRename?: (c: SchoolClass, label: string) => Promise<true | string>;
  /** Only offered for a class nothing is attached to (D-097): with students it is switched off instead. */
  onDelete?: (c: SchoolClass) => Promise<boolean>;
}) {
  return (
    <ClassesTable
      classes={classes}
      action={
        canManage
          ? {
              label: t("setup.read.actions"),
              cell: (c) => {
                const title = classTitle(c);
                return (
                  <span className={styles.rowActions}>
                    {onRename ? (
                      <AddDialog label={t("structure.edit")} ariaLabel={t("structure.editItem", { name: title })} title={t("structure.editTitle", { name: title })} variant="quiet" plus={false}>
                        {(close) => (
                          <ClassSectionForm
                            initial={c.label}
                            onSave={async (label) => {
                              const saved = await onRename(c, label);
                              if (saved === true) close();
                              return saved;
                            }}
                          />
                        )}
                      </AddDialog>
                    ) : null}
                    <Button
                      variant="quiet"
                      loading={busy === c.id}
                      loadingLabel={t("setup.working")}
                      disabled={busy !== null && busy !== c.id}
                      aria-label={t(c.active ? "setup.classes.switchOffItem" : "setup.classes.switchOnItem", { name: title })}
                      onClick={() => onToggle(c)}
                    >
                      {t(c.active ? "setup.programmes.switchOff" : "setup.programmes.switchOn")}
                    </Button>
                    {onDelete && c.canDelete ? <DeleteControl name={title} canDelete inline onDelete={() => onDelete(c)} /> : null}
                  </span>
                );
              },
            }
          : undefined
      }
    />
  );
}

/** A class's section, the only thing about a class that changes (D-114): its term and level stay. */
export function ClassSectionForm({ initial, onSave }: { initial: string; onSave: (label: string) => Promise<true | string> }) {
  const [label, setLabel] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setProblem(null);
    const saved = await onSave(label.trim());
    setSaving(false);
    // Said inside the pop-up: the page's own notice is behind its backdrop (admin FUT F-01).
    if (saved !== true) setProblem(saved);
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("setup.classes.label")} hint={t("setup.classes.labelHint")} value={label} maxLength={40} autoComplete="off" onChange={(event) => setLabel(event.target.value)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("structure.saveChanges")}
      </Button>
    </form>
  );
}

/** `levelIds`: the levels the term runs (D-110); a class is only for one of them. */
export function ClassForm({ yearId, programmes, levelIds, onAdded, showTitle = true }: { yearId: string; programmes: readonly Programme[]; levelIds?: readonly string[]; onAdded: () => void; showTitle?: boolean }) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const [levelId, setLevelId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    if (!levelId) {
      setError("setup.error.levelRequired");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await createClass(api, { yearId, levelId, label: label.trim() });
    setSaving(false);
    if (result.ok) {
      setLabel("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {showTitle ? <h2 className={styles.formTitle}>{t("setup.classes.add")}</h2> : null}
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      {levelIds && levelIds.length === 0 ? <Notice>{t("setup.classes.noTermLevels")}</Notice> : null}
      <Select
        label={t("setup.classes.level", words)}
        value={levelId}
        onChange={(event) => {
          setLevelId(event.target.value);
          setError(null);
        }}
        options={[{ value: "", label: t("setup.programmes.choose") }, ...levelChoices(programmes, levelIds)]}
        error={error ? t(error, words) : undefined}
      />
      <Field label={t("setup.classes.label")} hint={t("setup.classes.labelHint")} value={label} maxLength={40} autoComplete="off" onChange={(event) => setLabel(event.target.value)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.classes.add")}
      </Button>
    </form>
  );
}

export function ClassesScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const canManage = canManageStructure(me?.roles ?? []);
  const loadYearsNow = useCallback(() => loadYears(api), [api]);
  const loadProgrammesNow = useCallback(() => loadProgrammes(api), [api]);
  const years = useLoad(loadYearsNow);
  const programmes = useLoad(loadProgrammesNow);
  const [picked, setPicked] = useState<string | null>(null);
  const yearId = picked ?? (years.view.status === "ready" ? defaultYearId(years.view.data.years) : null);
  const loadClassesNow = useCallback(
    (): Promise<Loaded<{ classes: SchoolClass[] }>> => (yearId ? loadClasses(api, yearId) : Promise.resolve({ ok: true, data: { classes: [] } })),
    [api, yearId],
  );
  const classes = useLoad(loadClassesNow);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(c: SchoolClass) {
    if (busy) return;
    setBusy(c.id);
    setFlash(null);
    const result = await setClassActive(api, c.id, !c.active);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t(c.active ? "setup.done.switchedOff" : "setup.done.switchedOn") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await classes.reload();
  }

  async function rename(c: SchoolClass, label: string): Promise<true | string> {
    const result = await renameClass(api, c.id, label);
    if (!result.ok) return t(REASON_MESSAGE[result.reason]);
    setFlash({ tone: "ok", text: t("structure.done.saved") });
    await classes.reload();
    return true;
  }

  async function remove(c: SchoolClass): Promise<boolean> {
    setFlash(null);
    const result = await deleteClass(api, c.id);
    setFlash(result.ok ? { tone: "ok", text: t("structure.done.deleted") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    if (result.ok) await classes.reload();
    return result.ok;
  }

  return (
    <>
      {canManage ? (
        <ReadHeader
          title={t("setup.classes.title")}
          subtitle={t("setup.read.classesSubtitle")}
          actions={
            yearId && programmes.view.status === "ready" ? (
              <AddDialog label={t("setup.classes.add")} title={t("setup.classes.add")}>
              {(close) => (
                <ClassForm
                  key={yearId}
                  yearId={yearId}
                  levelIds={years.view.status === "ready" ? (years.view.data.years.find((y) => y.id === yearId)?.levels.map((l) => l.id) ?? []) : []}
                  programmes={programmes.view.status === "ready" ? programmes.view.data.programmes : []}
                  showTitle={false}
                  onAdded={() => {
                    close();
                    setFlash({ tone: "ok", text: t("setup.done.added") });
                    void classes.reload();
                  }}
                />
              )}
              </AddDialog>
            ) : undefined
          }
        />
      ) : (
        <ReadSetupHeader title={t("setup.classes.title")} subtitle={t("setup.read.classesSubtitle")} />
      )}
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={years.view} onRetry={() => void years.reload()}>
        {({ years: list }) =>
          list.length === 0 ? (
            <p className={styles.empty}>{t("setup.classes.noYear")}</p>
          ) : (
            <>
              <div className={readStyles.search}>
                <YearPicker years={list} value={yearId} onChange={setPicked} />
              </div>
              <Gate view={classes.view} onRetry={() => void classes.reload()}>
                {(data) => (canManage ? <ClassesView classes={data.classes} canManage={canManage} busy={busy} onToggle={(c) => void toggle(c)} onDelete={remove} onRename={rename} /> : <ClassesTable classes={data.classes} />)}
              </Gate>
            </>
          )
        }
      </Gate>
      {canManage ? null : <ReadOnlyNote>{t("setup.read.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>}
    </>
  );
}
