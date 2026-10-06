"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import { ReadHeader, ReadOnlyNote } from "@/read/ReadView";

import { createSubject, loadSubjects, setSubjectArchived, updateSubject } from "./client";
import { REASON_MESSAGE, canManageInstitution, canManageStructure, manageableSections, type Subject } from "./model";
import { ReadSetupHeader, SubjectsTable } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

/**
 * The school's subjects, in the table the Principal reads, with Archive or Restore for a whole-school Co-ordinator
 * (D-106). Archiving hides a subject from the level pickers and keeps everything that used it.
 */
export function SubjectsView({
  subjects,
  canArchive,
  busy,
  onToggle,
  canAdd = false,
  wings = [],
  onEdit,
}: {
  subjects: readonly Subject[];
  canArchive: boolean;
  busy: string | null;
  onToggle: (subject: Subject) => void;
  canAdd?: boolean;
  wings?: readonly { key: string; name: string }[];
  /** Saves a subject's name, code and wing (FUT point 17): a whole-school Co-ordinator's. True, or what went wrong. */
  onEdit?: (subject: Subject, input: { name: string; code: string; sectionKey: string }) => Promise<true | string>;
}) {
  return (
    <SubjectsTable
      subjects={subjects}
      wings={wings}
      empty={canAdd ? "setup.subjects.empty" : "setup.subjects.emptyReadOnly"}
      action={
        canArchive
          ? {
              label: t("setup.read.actions"),
              cell: (subject) => (
                <span className={styles.rowActions}>
                {onEdit ? (
                  <AddDialog label={t("structure.edit")} ariaLabel={t("structure.editItem", { name: subject.name })} title={t("structure.editTitle", { name: subject.name })} variant="quiet" plus={false}>
                    {(close) => (
                      <SubjectEditForm
                        subject={subject}
                        wings={wings}
                        onSave={async (input) => {
                          const saved = await onEdit(subject, input);
                          if (saved === true) close();
                          return saved;
                        }}
                      />
                    )}
                  </AddDialog>
                ) : null}
                <Button
                  variant="quiet"
                  loading={busy === subject.id}
                  loadingLabel={t("setup.working")}
                  disabled={busy !== null && busy !== subject.id}
                  aria-label={t(subject.archived ? "setup.subjects.restoreItem" : "setup.subjects.archiveItem", { name: subject.name })}
                  onClick={() => onToggle(subject)}
                >
                  {t(subject.archived ? "setup.subjects.restore" : "setup.subjects.archive")}
                </Button>
                </span>
              ),
            }
          : undefined
      }
    />
  );
}

/**
 * Editing a subject (FUT point 17): its name, its code (empty for none) and its wing. The wing is fixed once a curriculum
 * uses the subject, and the field says so; the server checks the same as it saves. A failure is said inside the pop-up
 * (admin FUT F-01).
 */
export function SubjectEditForm({ subject, wings, onSave }: { subject: Subject; wings: readonly { key: string; name: string }[]; onSave: (input: { name: string; code: string; sectionKey: string }) => Promise<true | string> }) {
  const [name, setName] = useState(subject.name);
  const [code, setCode] = useState(subject.code ?? "");
  const [wing, setWing] = useState(subject.sectionKey ?? "");
  const [errors, setErrors] = useState<{ name?: string; wing?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found = { name: name.trim() ? undefined : t("setup.error.nameRequired"), wing: wing ? undefined : t("setup.subjects.wingRequired") };
    setErrors(found);
    if (found.name || found.wing) return;
    setSaving(true);
    setProblem(null);
    const saved = await onSave({ name: name.trim(), code: code.trim(), sectionKey: wing });
    setSaving(false);
    if (saved !== true) setProblem(saved);
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("setup.subjects.name")} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} error={errors.name} />
      <Field label={t("setup.subjects.code")} hint={t("setup.subjects.codeHint")} value={code} maxLength={20} autoComplete="off" onChange={(event) => setCode(event.target.value)} />
      <Select
        label={t("setup.subjects.wing")}
        hint={t(subject.inCurriculum ? "setup.subjects.wingInUse" : "setup.subjects.wingFree")}
        value={wing}
        disabled={subject.inCurriculum}
        onChange={(event) => setWing(event.target.value)}
        options={[{ value: "", label: t("setup.programmes.choose") }, ...wings.map((w) => ({ value: w.key, label: w.name }))]}
        error={errors.wing}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("structure.saveChanges")}
      </Button>
    </form>
  );
}

/** A new subject: its wing (only the wings the person reaches; one is chosen for them), name and code (D-114). */
export function SubjectForm({ onAdded, showTitle = true, wings }: { onAdded: () => void; showTitle?: boolean; wings: readonly { key: string; name: string }[] }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [picked, setWing] = useState("");
  const [wingError, setWingError] = useState(false);
  const wing = wings.length === 1 ? wings[0]!.key : picked;
  const [error, setError] = useState<MessageKey | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    setWingError(!wing);
    if (!name.trim()) setError("setup.error.nameRequired");
    if (!name.trim() || !wing) return;
    setError(null);
    setSaving(true);
    const result = await createSubject(api, { name: name.trim(), code: code.trim(), sectionKey: wing });
    setSaving(false);
    if (result.ok) {
      setName("");
      setCode("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {showTitle ? <h2 className={styles.formTitle}>{t("setup.subjects.add")}</h2> : null}
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      {wings.length === 1 ? (
        <p className={styles.pickerGiven}>{t("setup.subjects.inWing", { wing: wings[0]!.name })}</p>
      ) : (
        <Select
          label={t("setup.subjects.wing")}
          value={picked}
          onChange={(event) => {
            setWing(event.target.value);
            setWingError(false);
          }}
          options={[{ value: "", label: t("setup.programmes.choose") }, ...wings.map((w) => ({ value: w.key, label: w.name }))]}
          error={wingError ? t("setup.subjects.wingRequired") : undefined}
        />
      )}
      <Field
        label={t("setup.subjects.name")}
        value={name}
        maxLength={120}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        error={error ? t(error) : undefined}
      />
      <Field label={t("setup.subjects.code")} hint={t("setup.subjects.codeHint")} value={code} maxLength={20} autoComplete="off" onChange={(event) => setCode(event.target.value)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.subjects.add")}
      </Button>
    </form>
  );
}

export function SubjectsScreen() {
  const { api, me } = useSession();
  const { term, config } = useConfig();
  const wings = config?.sections ?? [];
  const roles = me?.roles ?? [];
  const canAdd = canManageStructure(roles);
  const canArchive = canManageInstitution(roles);
  const load = useCallback(() => loadSubjects(api), [api]);
  const { view, reload } = useLoad(load);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const coordinator = term("role.coordinator");

  async function toggle(subject: Subject) {
    if (busy) return;
    setBusy(subject.id);
    setFlash(null);
    const result = await setSubjectArchived(api, subject.id, !subject.archived);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t(subject.archived ? "setup.done.restored" : "setup.done.archived") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await reload();
  }

  async function saveEdit(subject: Subject, input: { name: string; code: string; sectionKey: string }): Promise<true | string> {
    const result = await updateSubject(api, subject.id, input);
    if (!result.ok) return t(REASON_MESSAGE[result.reason]);
    setFlash({ tone: "ok", text: t("structure.done.saved") });
    await reload();
    return true;
  }

  return (
    <>
      {canAdd ? (
        <ReadHeader
          title={t("setup.subjects.title")}
          subtitle={t("setup.subjects.intro")}
          actions={
            <AddDialog label={t("setup.subjects.add")} title={t("setup.subjects.add")}>
              {(close) => (
                <SubjectForm
                  showTitle={false}
                  wings={manageableSections(roles, wings)}
                  onAdded={() => {
                    close();
                    setFlash({ tone: "ok", text: t("setup.done.added") });
                    void reload();
                  }}
                />
              )}
            </AddDialog>
          }
        />
      ) : (
        <ReadSetupHeader title={t("setup.subjects.title")} subtitle={t("setup.read.subjectsSubtitle")} />
      )}
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ subjects }) =>
          canAdd ? (
            <SubjectsView subjects={subjects} canArchive={canArchive} canAdd={canAdd} busy={busy} wings={wings} onToggle={(s) => void toggle(s)} onEdit={saveEdit} />
          ) : (
            <SubjectsTable subjects={subjects} wings={wings} />
          )
        }
      </Gate>
      {canAdd && !canArchive ? <ReadOnlyNote>{t("setup.subjects.onlyWholeSchool", { coordinator })}</ReadOnlyNote> : null}
      {canAdd ? null : <ReadOnlyNote>{t("setup.read.readOnly", { coordinator })}</ReadOnlyNote>}
    </>
  );
}
