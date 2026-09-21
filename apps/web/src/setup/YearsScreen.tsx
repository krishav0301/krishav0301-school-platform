"use client";

import { useCallback, useState, type FormEvent } from "react";

import { BsDateField } from "@/content/BsDateField";
import { formatBsDate } from "@/content/model";
import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Field, Notice } from "@/ui";

import { activateYear, createYear, loadYears } from "./client";
import { REASON_MESSAGE, YEAR_STATUS_LABEL, canManageInstitution, emptyYearForm, type Year, type YearFormErrors, type YearFormValues } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

/** The list of years. A draft can be made the current year, but only when no year is current (closing a year is a later phase). */
export function YearsView({ years, canManage, busy, onActivate }: { years: readonly Year[]; canManage: boolean; busy: string | null; onActivate: (year: Year) => void }) {
  if (years.length === 0) return <p className={styles.empty}>{t(canManage ? "setup.years.empty" : "setup.years.emptyReadOnly")}</p>;
  const noneCurrent = !years.some((y) => y.status === "active");

  return (
    <ul className={styles.list}>
      {years.map((year) => (
        <li key={year.id} className={styles.item}>
          <h2 className={styles.itemTitle}>{year.label}</h2>
          <div className={styles.badges}>
            <Badge tone={year.status === "active" ? "ok" : "neutral"}>{t(YEAR_STATUS_LABEL[year.status])}</Badge>
          </div>
          <p className={styles.muted}>{t("setup.years.dates", { from: formatBsDate(year.startDateBs), until: formatBsDate(year.endDateBs) })}</p>
          {canManage && noneCurrent && year.status === "draft" ? (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                loading={busy === year.id}
                loadingLabel={t("setup.working")}
                disabled={busy !== null && busy !== year.id}
                aria-label={t("setup.years.activateItem", { label: year.label })}
                onClick={() => onActivate(year)}
              >
                {t("setup.years.activate")}
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function YearForm({ onAdded }: { onAdded: () => void }) {
  const { api } = useSession();
  const [values, setValues] = useState<YearFormValues>(emptyYearForm);
  const [errors, setErrors] = useState<YearFormErrors>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setProblem(null);
    const result = await createYear(api, values);
    setSaving(false);
    if (result.ok) {
      setValues(emptyYearForm());
      setErrors({});
      onAdded();
    } else if (result.reason === "fields") {
      setErrors(result.errors);
    } else {
      setErrors({});
      setProblem(REASON_MESSAGE[result.reason]);
    }
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <h2 className={styles.formTitle}>{t("setup.years.add")}</h2>
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field
        label={t("setup.years.bsYear")}
        hint={t("setup.years.bsYearHint")}
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        value={values.bsYear}
        onChange={(event) => setValues((v) => ({ ...v, bsYear: event.target.value }))}
        error={say(errors.bsYear)}
      />
      <BsDateField legend={t("setup.years.start")} value={values.startBs} onChange={(startBs) => setValues((v) => ({ ...v, startBs }))} error={say(errors.startBs)} />
      <BsDateField legend={t("setup.years.end")} value={values.endBs} onChange={(endBs) => setValues((v) => ({ ...v, endBs }))} error={say(errors.endBs)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("setup.years.add")}
      </Button>
    </form>
  );
}

export function YearsScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const roles = me?.roles ?? [];
  const canManage = canManageInstitution(roles);
  const load = useCallback(() => loadYears(api), [api]);
  const { view, reload } = useLoad(load);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const coordinator = term("role.coordinator");

  async function activate(year: Year) {
    if (busy) return;
    setBusy(year.id);
    setFlash(null);
    const result = await activateYear(api, year.id);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t("setup.done.current") } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    if (result.ok || result.reason === "another_active") await reload();
  }

  return (
    <>
      <h1 className={styles.title}>{t("setup.years.title")}</h1>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ years }) => <YearsView years={years} canManage={canManage} busy={busy} onActivate={(year) => void activate(year)} />}
      </Gate>
      {canManage ? (
        <YearForm
          onAdded={() => {
            setFlash({ tone: "ok", text: t("setup.done.added") });
            void reload();
          }}
        />
      ) : (
        <Notice>{t(roles.some((r) => r.role === "coordinator") ? "setup.institutionOnly" : "setup.readOnly", { coordinator })}</Notice>
      )}
    </>
  );
}
