"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Badge, Button, Field, Notice, TitleRow } from "@/ui";

import { createSubject, loadSubjects, setSubjectArchived } from "./client";
import { REASON_MESSAGE, canManageInstitution, canManageStructure, type Subject } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

/** The school's subjects. Archiving hides a subject from the level pickers and keeps everything that used it. */
export function SubjectsView({
  subjects,
  canArchive,
  busy,
  onToggle,
  canAdd = false,
}: {
  subjects: readonly Subject[];
  canArchive: boolean;
  busy: string | null;
  onToggle: (subject: Subject) => void;
  canAdd?: boolean;
}) {
  if (subjects.length === 0) return <p className={styles.empty}>{t(canAdd ? "setup.subjects.empty" : "setup.subjects.emptyReadOnly")}</p>;

  return (
    <ul className={styles.list}>
      {subjects.map((subject) => (
        <li key={subject.id} className={styles.item}>
          <h2 className={styles.itemTitle}>{subject.name}</h2>
          {subject.code || subject.archived ? (
            <div className={styles.badges}>
              {subject.code ? <Badge>{t("setup.subjects.codeIs", { code: subject.code })}</Badge> : null}
              {subject.archived ? <Badge>{t("setup.subjects.archived")}</Badge> : null}
            </div>
          ) : null}
          {canArchive ? (
            <div className={styles.actions}>
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
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SubjectForm({ onAdded, showTitle = true }: { onAdded: () => void; showTitle?: boolean }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    if (!name.trim()) {
      setError("setup.error.nameRequired");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await createSubject(api, { name: name.trim(), code: code.trim() });
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
      <Field label={t("setup.subjects.name")} value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} error={error ? t(error) : undefined} />
      <Field label={t("setup.subjects.code")} hint={t("setup.subjects.codeHint")} value={code} maxLength={20} autoComplete="off" onChange={(event) => setCode(event.target.value)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.subjects.add")}
      </Button>
    </form>
  );
}

export function SubjectsScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
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

  return (
    <>
      <TitleRow>
        <h1 className={styles.title}>{t("setup.subjects.title")}</h1>
        {canAdd ? (
          <AddDialog label={t("setup.subjects.add")} title={t("setup.subjects.add")}>
            {(close) => (
              <SubjectForm
                showTitle={false}
                onAdded={() => {
                  close();
                  setFlash({ tone: "ok", text: t("setup.done.added") });
                  void reload();
                }}
              />
            )}
          </AddDialog>
        ) : null}
      </TitleRow>
      <p className={styles.muted}>{t("setup.subjects.intro")}</p>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ subjects }) => <SubjectsView subjects={subjects} canArchive={canArchive} canAdd={canAdd} busy={busy} onToggle={(s) => void toggle(s)} />}
      </Gate>
      {canAdd && !canArchive ? <Notice>{t("setup.subjects.onlyWholeSchool", { coordinator })}</Notice> : null}
      {canAdd ? null : <Notice>{t("setup.readOnly", { coordinator })}</Notice>}
    </>
  );
}
