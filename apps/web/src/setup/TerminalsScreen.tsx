"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button, Field, Notice } from "@/ui";

import { YearPicker } from "./ClassesScreen";
import { createTerminal, loadTerminals, loadYears, type Loaded } from "./client";
import { REASON_MESSAGE, canManageInstitution, defaultYearId, termWords, type Terminal } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

/** The terminals of the chosen year, in order. The school's own word for a terminal is used throughout. */
export function TerminalsView({ terminals }: { terminals: readonly Terminal[] }) {
  const { term } = useConfig();
  const words = termWords(term);
  if (terminals.length === 0) return <p className={styles.empty}>{t("setup.terminals.empty", words)}</p>;
  return (
    <ul className={styles.list}>
      {terminals.map((terminal) => (
        <li key={terminal.id} className={styles.item}>
          <h2 className={styles.itemTitle}>{terminal.name}</h2>
          <p className={styles.muted}>{t("setup.terminals.number", { n: terminal.ordinal })}</p>
        </li>
      ))}
    </ul>
  );
}

function TerminalForm({ yearId, onAdded }: { yearId: string; onAdded: () => void }) {
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
      <h2 className={styles.formTitle}>{t("setup.terminals.add", words)}</h2>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field label={t("setup.terminals.name")} value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.target.value)} error={error ? t(error) : undefined} />
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
      <h1 className={styles.title}>{t("setup.terminals.title", words)}</h1>
      {saved ? <Notice tone="ok">{t("setup.done.added")}</Notice> : null}
      <Gate view={years.view} onRetry={() => void years.reload()}>
        {({ years: list }) =>
          list.length === 0 ? (
            <p className={styles.empty}>{t("setup.classes.noYear")}</p>
          ) : (
            <>
              <div className={styles.filters}>
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
                {(data) => <TerminalsView terminals={data.terminals} />}
              </Gate>
              {canManage && yearId ? (
                <TerminalForm
                  yearId={yearId}
                  onAdded={() => {
                    setSaved(true);
                    void terminals.reload();
                  }}
                />
              ) : null}
            </>
          )
        }
      </Gate>
      {canManage ? null : <Notice>{t(roles.some((r) => r.role === "coordinator") ? "setup.institutionOnly" : "setup.readOnly", { coordinator: term("role.coordinator") })}</Notice>}
    </>
  );
}
