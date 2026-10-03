"use client";

import { useState, type FormEvent } from "react";

import { BsDateField } from "@/content/BsDateField";
import { toAd } from "@/content/client";
import { isWholeBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice, TextArea } from "@/ui";

import styles from "./admissions.module.css";
import { correctStudent, type CorrectStudentBody } from "./client";
import type { StudentDetail } from "./model";

type Values = { firstName: string; middleName: string; lastName: string; dobBs: string; phone: string; guardianName: string; guardianPhone: string; previousSchool: string };

const valuesOf = (s: StudentDetail): Values => ({
  firstName: s.firstName,
  middleName: s.middleName ?? "",
  lastName: s.lastName,
  dobBs: s.dobBs ?? "",
  phone: s.phone ?? "",
  guardianName: s.guardianName,
  guardianPhone: s.guardianPhone,
  previousSchool: s.previousSchool ?? "",
});

/** Only what changed, ready to send (the date of birth is sent separately, once converted). Pure, so tests check it. */
export function changesOf(before: Values, after: Values): Omit<CorrectStudentBody, "reason" | "dob"> {
  const out: Record<string, string | null> = {};
  const text = ["firstName", "lastName", "guardianName", "guardianPhone"] as const;
  const optional = ["middleName", "phone", "previousSchool"] as const;
  for (const k of text) if (after[k].trim() !== before[k].trim()) out[k] = after[k].trim();
  for (const k of optional) if (after[k].trim() !== before[k].trim()) out[k] = after[k].trim() || null;
  return out as Omit<CorrectStudentBody, "reason" | "dob">;
}

/**
 * "Correct details" (Co-ordinator FUT F-06): the Co-ordinator fixes a student's personal details, with a reason the
 * audit trail keeps. The SID is never editable and the email is the student's sign-in, so neither is offered here.
 */
export function CorrectDetails({ student, onCorrected }: { student: StudentDetail; onCorrected: (next: StudentDetail) => void }) {
  return (
    <AddDialog label={t("admissions.correct.open")} title={t("admissions.correct.title")} variant="secondary" plus={false}>
      {(close) => (
        <CorrectForm
          student={student}
          onDone={(next) => {
            onCorrected(next);
            close();
          }}
        />
      )}
    </AddDialog>
  );
}

function CorrectForm({ student, onDone }: { student: StudentDetail; onDone: (next: StudentDetail) => void }) {
  const { api } = useSession();
  const before = valuesOf(student);
  const [values, setValues] = useState<Values>(before);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof Values | "reason", string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Values, v: string) => {
    setValues((c) => ({ ...c, [k]: v }));
    setErrors((c) => ({ ...c, [k]: undefined }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const changes: Record<string, unknown> = { ...changesOf(before, values) };
    const problems: typeof errors = {};
    if (!values.firstName.trim()) problems.firstName = t("admissions.error.required");
    if (!values.lastName.trim()) problems.lastName = t("admissions.error.required");
    if (!values.guardianName.trim()) problems.guardianName = t("admissions.error.required");
    if (!values.guardianPhone.trim()) problems.guardianPhone = t("admissions.error.required");
    if (values.dobBs !== before.dobBs && !isWholeBsDate(values.dobBs)) problems.dobBs = t("attendance.class.incompleteDay");
    if (reason.trim().length < 3) problems.reason = t("admissions.correct.reasonRequired");
    if (Object.keys(problems).length > 0) return setErrors(problems);
    setBusy(true);
    if (values.dobBs !== before.dobBs) {
      const converted = await toAd(api, values.dobBs.trim());
      if (!converted.ok) {
        setBusy(false);
        return setErrors({ dobBs: t(converted.error === "dateUnverified" ? "admissions.error.dobUnverified" : "admissions.error.dobInvalid") });
      }
      changes.dob = converted.ad;
    }
    if (Object.keys(changes).length === 0) {
      setBusy(false);
      return setFailure(t("admissions.correct.nothing"));
    }
    const result = await correctStudent(api, student.id, { ...(changes as Omit<CorrectStudentBody, "reason">), reason: reason.trim() });
    setBusy(false);
    if (result.ok) return onDone(result.student);
    setFailure(result.reason === "invalid" && result.message ? result.message : t(result.reason === "forbidden" || result.reason === "not_found" ? "admissions.correct.notAllowed" : "admissions.error.failed"));
  }

  return (
    <form className={styles.form} noValidate onSubmit={(e) => void submit(e)}>
      <p className={styles.formNote}>{t("admissions.correct.intro", { sid: student.sid })}</p>
      {failure ? <Notice tone="bad">{failure}</Notice> : null}
      <Field label={t("admissions.field.firstName")} value={values.firstName} onChange={(e) => set("firstName", e.target.value)} error={errors.firstName} />
      <Field label={t("admissions.field.middleName")} value={values.middleName} onChange={(e) => set("middleName", e.target.value)} />
      <Field label={t("admissions.field.lastName")} value={values.lastName} onChange={(e) => set("lastName", e.target.value)} error={errors.lastName} />
      <BsDateField legend={t("admissions.field.dob")} value={values.dobBs} onChange={(v) => set("dobBs", v)} error={errors.dobBs} />
      <Field label={t("admissions.field.phone")} inputMode="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
      <Field label={t("admissions.field.guardianName")} value={values.guardianName} onChange={(e) => set("guardianName", e.target.value)} error={errors.guardianName} />
      <Field label={t("admissions.field.guardianPhone")} inputMode="tel" value={values.guardianPhone} onChange={(e) => set("guardianPhone", e.target.value)} error={errors.guardianPhone} />
      <Field label={t("admissions.field.previousSchool")} value={values.previousSchool} onChange={(e) => set("previousSchool", e.target.value)} />
      <TextArea
        label={t("admissions.correct.reason")}
        hint={t("admissions.correct.reasonHint")}
        rows={3}
        value={reason}
        error={errors.reason}
        onChange={(e) => {
          setReason(e.target.value);
          setErrors((c) => ({ ...c, reason: undefined }));
        }}
      />
      <Button type="submit" loading={busy} loadingLabel={t("setup.working")}>
        {t("admissions.correct.save")}
      </Button>
    </form>
  );
}
