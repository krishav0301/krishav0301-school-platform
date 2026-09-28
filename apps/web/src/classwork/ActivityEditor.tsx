"use client";

import { useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Notice, TextArea } from "@/ui";

import styles from "./classwork.module.css";
import { writeActivity } from "./client";
import { ACTIVITY_MAX, className, type MyActivityToday } from "./model";

type Subject = MyActivityToday["subjects"][number];
type State = { kind: "saved" } | { kind: "failed" } | { kind: "closed" } | { kind: "gone" } | null;

/** One subject's entry for today (D-071): what the class did, saved as the teacher writes it, changeable until midnight. */
export function ActivityEditor({ subject }: { subject: Subject }) {
  const { api } = useSession();
  const [body, setBody] = useState(subject.body ?? "");
  const [written, setWritten] = useState(subject.body !== null);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<State>(null);

  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    const result = await writeActivity(api, subject.classId, subject.offeringId, body);
    setSaving(false);
    if (result.ok) {
      setWritten(true);
      setState({ kind: "saved" });
    } else setState({ kind: result.reason });
  }

  const headingId = `activity-${subject.classId}-${subject.offeringId}`;
  return (
    <li className={styles.card} aria-labelledby={headingId}>
      <div>
        <h3 id={headingId}>{subject.subjectName}</h3>
        <p className={styles.meta}>{className(subject)}</p>
      </div>
      {written ? null : <Badge>{t("classwork.activity.notWritten")}</Badge>}
      <TextArea
        label={t("classwork.activity.label")}
        hint={t("classwork.activity.hint")}
        rows={4}
        maxLength={ACTIVITY_MAX}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setState(null);
        }}
      />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} variant="secondary" onClick={() => void save()} loading={saving} loadingLabel={t("classwork.activity.saving")} disabled={!body.trim()}>
          {t("classwork.activity.save")}
        </Button>
      </div>
      {state?.kind === "saved" ? <Notice tone="ok">{t("classwork.activity.saved")}</Notice> : null}
      {state?.kind === "failed" ? <Notice tone="bad">{t("classwork.activity.failed")}</Notice> : null}
      {state?.kind === "closed" ? <Notice tone="bad">{t("classwork.activity.closed")}</Notice> : null}
      {state?.kind === "gone" ? <Notice tone="bad">{t("classwork.activity.gone")}</Notice> : null}
    </li>
  );
}
