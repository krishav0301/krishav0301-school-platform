"use client";

import { useState, type FormEvent } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Field, Notice } from "@/ui";

import styles from "./admissions.module.css";
import { requestLeave } from "./client";

/**
 * "Mark as left" (D-172): the Co-ordinator asks, with a reason, and the Principal decides. The dialog says what approval
 * does before it is asked: the student is marked Left and the fee account closes for everyone, with what is unpaid kept
 * as owed. Whatever must be settled with the family is settled before this.
 */
export function LeaveRequest({ enrollmentId, name, onAsked }: { enrollmentId: string; name: string; onAsked: () => void }) {
  return (
    <AddDialog label={t("admissions.leave.open")} title={t("admissions.leave.title", { name })} variant="secondary" plus={false}>
      {(close) => (
        <LeaveForm
          enrollmentId={enrollmentId}
          onDone={() => {
            onAsked();
            close();
          }}
        />
      )}
    </AddDialog>
  );
}

function LeaveForm({ enrollmentId, onDone }: { enrollmentId: string; onDone: () => void }) {
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    setSaving(true);
    const result = await requestLeave(api, enrollmentId, reason.trim());
    setSaving(false);
    if (result.ok) return onDone();
    setProblem(result.reason === "conflict" ? t("admissions.leave.waiting") : t("admissions.leave.failed"));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <p className={styles.formNote}>{t("admissions.leave.intro")}</p>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("admissions.leave.reason")} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      <Button type="submit" loading={saving} loadingLabel={t("admissions.leave.sending")} disabled={reason.trim().length < 3}>
        {t("admissions.leave.send")}
      </Button>
    </form>
  );
}
