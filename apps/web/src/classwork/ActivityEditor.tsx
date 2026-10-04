"use client";

import { useState } from "react";

import { t } from "@/i18n/messages";
import { SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { Button, Notice, TextArea } from "@/ui";

import { writeActivity } from "./client";
import { ACTIVITY_MAX, className, type MyActivityToday } from "./model";

type Subject = MyActivityToday["subjects"][number];
type State = { kind: "failed" } | { kind: "closed" } | { kind: "gone" } | null;

/**
 * One subject's entry for today (D-071), written in a side panel (D-107): what the class did, changeable until
 * midnight. Saving again replaces the day's entry, so a retry is harmless.
 */
export function ActivityPanel({ subject, onClose, onSaved }: { subject: Subject; onClose: () => void; onSaved: (body: string) => void }) {
  const { api } = useSession();
  const [body, setBody] = useState(subject.body ?? "");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<State>(null);

  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    const result = await writeActivity(api, subject.classId, subject.offeringId, body);
    setSaving(false);
    if (result.ok) onSaved(body);
    else setState({ kind: result.reason });
  }

  return (
    <SidePanel
      title={subject.subjectName}
      subtitle={className(subject)}
      busy={saving}
      onClose={onClose}
      foot={
        <Button fullWidth onClick={() => void save()} loading={saving} loadingLabel={t("classwork.activity.saving")} disabled={!body.trim() || saving}>
          {t("classwork.activity.save")}
        </Button>
      }
    >
      <TextArea
        label={t("classwork.activity.label")}
        hint={t("classwork.activity.hint")}
        rows={8}
        maxLength={ACTIVITY_MAX}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setState(null);
        }}
      />
      {state?.kind === "failed" ? <Notice tone="bad">{t("classwork.activity.failed")}</Notice> : null}
      {state?.kind === "closed" ? <Notice tone="bad">{t("classwork.activity.closed")}</Notice> : null}
      {state?.kind === "gone" ? <Notice tone="bad">{t("classwork.activity.gone")}</Notice> : null}
    </SidePanel>
  );
}
