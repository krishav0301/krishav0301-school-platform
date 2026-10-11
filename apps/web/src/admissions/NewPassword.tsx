"use client";

import { useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { TemporaryPasswordNotice } from "@/people/StaffScreen";
import { useSession } from "@/session/SessionProvider";
import { AddDialog, Button, Notice } from "@/ui";

import { issueStudentPin } from "./client";

/**
 * "Give a new password" on a student's record (D-145, the PM 2026-10-11): the Co-ordinator's way back in for a student who
 * has forgotten theirs, since there is no email to send a reset to. The password is shown once, here.
 */
export function NewPassword({ studentId, name }: { studentId: string; name: string }) {
  return (
    <AddDialog label={t("student.pin.open")} title={t("student.pin.title", { name })} variant="secondary" plus={false}>
      {(close) => <NewPasswordForm studentId={studentId} name={name} onClose={close} />}
    </AddDialog>
  );
}

function NewPasswordForm({ studentId, name, onClose }: { studentId: string; name: string; onClose: () => void }) {
  const { api } = useSession();
  const { config } = useConfig();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  async function give() {
    setBusy(true);
    setFailed(false);
    const result = await issueStudentPin(api, studentId);
    setBusy(false);
    if (result.ok) setPassword(result.password);
    else setFailed(true);
  }

  if (password !== null) return <TemporaryPasswordNotice name={name} password={password} onDone={onClose} bodyKey={config?.school.studentKeepsPin ? "student.pin.secretKeep" : undefined} />;
  return (
    <div>
      <p>{t("student.pin.intro", { name })}</p>
      {failed ? <Notice tone="bad">{t("student.pin.failed")}</Notice> : null}
      <Button onClick={() => void give()} loading={busy} loadingLabel={t("setup.working")}>
        {t("student.pin.give")}
      </Button>
    </div>
  );
}
