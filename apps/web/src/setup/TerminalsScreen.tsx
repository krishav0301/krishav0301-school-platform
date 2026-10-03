"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice } from "@/ui";

import { ReadHeader, ReadOnlyNote, readStyles } from "@/read/ReadView";

import { YearPicker } from "./ClassesScreen";
import { createTerminal, loadTerminals, loadYears, type Loaded } from "./client";
import { REASON_MESSAGE, canManageInstitution, defaultYearId, termWords, type Terminal } from "./model";
import { ReadSetupHeader, TerminalsTable, midSentence } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

/** The terminals of the chosen year, in order, in the table the Principal reads (D-106). The school's own word throughout. */
export function TerminalsView({ terminals }: { terminals: readonly Terminal[] }) {
  const { term } = useConfig();
  return <TerminalsTable terminals={terminals} words={termWords(term)} />;
}

function TerminalForm({ yearId, onAdded, showTitle = true }: { yearId: string; onAdded: () => void; showTitle?: boolean }) {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const [name, setName] = useState("");
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
    const result = await createTerminal(api, { yearId, name: name.trim() });
    setSaving(false);
    if (result.ok) {
      setName("");
      onAdded();
    } else {
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {showTitle ? <h2 className={styles.formTitle}>{t("setup.terminals.add", words)}</h2> : null}
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field label={t("setup.terminals.name")} value={name} maxLength={60} autoComplete="off" onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        error={error ? t(error) : undefined}
      />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.terminals.add", words)}
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
  const [picked, setPicked] = useState<string | null>(null);
  const yearId = picked ?? (years.view.status === "ready" ? defaultYearId(years.view.data.years) : null);
  const loadTerminalsNow = useCallback(
    (): Promise<Loaded<{ terminals: Terminal[] }>> => (yearId ? loadTerminals(api, yearId) : Promise.resolve({ ok: true, data: { terminals: [] } })),
    [api, yearId],
  );
  const terminals = useLoad(loadTerminalsNow);
  const [saved, setSaved] = useState(false);

  return (
    <>
      {canManage ? (
        <ReadHeader
          title={t("setup.terminals.title", words)}
          subtitle={t("setup.read.terminalsSubtitle", midSentence(words))}
          actions={
            yearId ? (
              <AddDialog label={t("setup.terminals.add", words)} title={t("setup.terminals.add", words)}>
              {(close) => (
                <TerminalForm
                  key={yearId}
                  yearId={yearId}
                  showTitle={false}
                  onAdded={() => {
                    close();
                    setSaved(true);
                    void terminals.reload();
                  }}
                />
              )}
              </AddDialog>
            ) : undefined
          }
        />
      ) : (
        <ReadSetupHeader title={t("setup.terminals.title", words)} subtitle={t("setup.read.terminalsSubtitle", midSentence(words))} />
      )}
      {saved ? <Notice tone="ok">{t("setup.done.added")}</Notice> : null}
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
                  }}
                />
              </div>
              <Gate view={terminals.view} onRetry={() => void terminals.reload()}>
                {(data) => (canManage ? <TerminalsView terminals={data.terminals} /> : <TerminalsTable terminals={data.terminals} words={words} />)}
              </Gate>
            </>
          )
        }
      </Gate>
      {canManage ? null : <ReadOnlyNote>{t(roles.some((r) => r.role === "coordinator") ? "setup.institutionOnly" : "setup.read.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>}
    </>
  );
}
