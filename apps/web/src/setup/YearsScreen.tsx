"use client";

import { useCallback, useState, type FormEvent } from "react";

import { BsDateField } from "@/content/BsDateField";
import { isWholeBsDate } from "@/content/model";
import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice } from "@/ui";

import { ReadHeader, ReadOnlyNote } from "@/read/ReadView";

import { activateYear, createYear, loadYears } from "./client";
import { REASON_MESSAGE, canManageInstitution, emptyYearForm, type Year, type YearFormErrors, type YearFormValues } from "./model";
import { ReadSetupHeader, YearsTable } from "./ReadSetup";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup.module.css";

type Flash = { tone: "ok" | "bad"; text: string };

/** A whole BS day ("2083-1-5" or "2083-01-05") as a number that sorts by date. */
const bsOrder = (bs: string): number => {
  const [y, m, d] = bs.trim().split("-").map(Number);
  return (y ?? 0) * 10000 + (m ?? 0) * 100 + (d ?? 0);
};

/**
 * The years, in the table the Principal reads (D-104), with the Co-ordinator's one control: a draft can be made the
 * current year, but only when no year is current (closing a year is a later phase). Redesigned in D-106.
 */
export function YearsView({ years, canManage, busy, onActivate }: { years: readonly Year[]; canManage: boolean; busy: string | null; onActivate: (year: Year) => void }) {
  const noneCurrent = !years.some((y) => y.status === "active");
  const offer = canManage && noneCurrent && years.some((y) => y.status === "draft");
  return (
    <YearsTable
      years={years}
      empty={canManage ? "setup.years.empty" : "setup.years.emptyReadOnly"}
      action={
        offer
          ? {
              label: t("setup.read.actions"),
              cell: (year) =>
                year.status === "draft" ? (
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
                ) : null,
            }
          : undefined
      }
    />
  );
}

function YearForm({ onAdded, showTitle = true }: { onAdded: () => void; showTitle?: boolean }) {
  const { api } = useSession();
  const [values, setValues] = useState<YearFormValues>(emptyYearForm);
  const [errors, setErrors] = useState<YearFormErrors>({});
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const say = (key: MessageKey | undefined) => (key ? t(key) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    // Said plainly before asking the server, which would only answer "not allowed" (Co-ordinator FUT F-02).
    if (isWholeBsDate(values.startBs) && isWholeBsDate(values.endBs) && bsOrder(values.endBs) <= bsOrder(values.startBs)) {
      setErrors({ endBs: "setup.error.endBeforeStart" });
      return;
    }
    setSaving(true);
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
      {showTitle ? <h2 className={styles.formTitle}>{t("setup.years.add")}</h2> : null}
      {problem ? <Notice tone="bad">{t(problem)}</Notice> : null}
      <Field
        label={t("setup.years.bsYear")}
        hint={t("setup.years.bsYearHint")}
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        value={values.bsYear}
        onChange={(event) => {
          setValues((v) => ({ ...v, bsYear: event.target.value }));
          setErrors((e) => ({ ...e, bsYear: undefined }));
        }}
        error={say(errors.bsYear)}
      />
      <BsDateField
        legend={t("setup.years.start")}
        value={values.startBs}
        onChange={(startBs) => {
          setValues((v) => ({ ...v, startBs }));
          setErrors((e) => ({ ...e, startBs: undefined, endBs: undefined }));
        }}
        error={say(errors.startBs)}
      />
      <BsDateField
        legend={t("setup.years.end")}
        value={values.endBs}
        onChange={(endBs) => {
          setValues((v) => ({ ...v, endBs }));
          setErrors((e) => ({ ...e, endBs: undefined }));
        }}
        error={say(errors.endBs)}
      />
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
      {canManage ? (
        <ReadHeader
          title={t("setup.years.title")}
          subtitle={t("setup.read.yearsSubtitle")}
          actions={
            <AddDialog label={t("setup.years.add")} title={t("setup.years.add")}>
              {(close) => (
                <YearForm
                  showTitle={false}
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
        <ReadSetupHeader title={t("setup.years.title")} subtitle={t("setup.read.yearsSubtitle")} />
      )}
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ years }) => (canManage ? <YearsView years={years} canManage={canManage} busy={busy} onActivate={(year) => void activate(year)} /> : <YearsTable years={years} />)}
      </Gate>
      {canManage ? null : <ReadOnlyNote>{t(roles.some((r) => r.role === "coordinator") ? "setup.institutionOnly" : "setup.read.readOnly", { coordinator })}</ReadOnlyNote>}
    </>
  );
}
