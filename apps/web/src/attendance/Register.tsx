"use client";

import { useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Button, Checkbox, Notice } from "@/ui";

import styles from "./attendance.module.css";
import { saveToday } from "./client";
import { className, counts, initialAbsent, studentMeta, type AttendanceDay } from "./model";

type Saved = { kind: "saved"; present: number; absent: number } | { kind: "failed" } | { kind: "closed" } | null;

/**
 * The Class Teacher's register for today (D-069): everyone starts as present, tick who is absent, one Save.
 * Saving again the same day replaces the day, so a second tap or a retry is harmless.
 */
export function Register({ day, onSaved }: { day: AttendanceDay; onSaved?: () => void }) {
  const { api } = useSession();
  const [absent, setAbsent] = useState<Set<string>>(() => initialAbsent(day));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved>(null);
  const tally = counts(day, absent);

  function toggle(id: string, isAbsent: boolean) {
    setAbsent((current) => {
      const next = new Set(current);
      if (isAbsent) next.add(id);
      else next.delete(id);
      return next;
    });
    setSaved(null);
  }

  async function save() {
    setSaving(true);
    const result = await saveToday(api, day.class.id, [...absent]);
    setSaving(false);
    if (result.ok) {
      setSaved({ kind: "saved", present: result.present, absent: result.absent });
      onSaved?.();
    } else setSaved({ kind: result.reason });
  }

  const headingId = `register-${day.class.id}`;
  return (
    <section className={styles.register} aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className={setupStyles.subhead}>
          {t("attendance.register.title")}
        </h2>
        <p className={styles.classLine}>{className(day.class)}</p>
        <p className={setupStyles.muted}>{t("attendance.today", { date: day.dateBs ?? day.date })}</p>
      </div>
      {day.students.length === 0 ? (
        <p className={setupStyles.empty}>{t("attendance.register.empty")}</p>
      ) : (
        <>
          <p>{t("attendance.register.intro")}</p>
          {day.marked && saved === null ? <Notice>{t("attendance.register.savedEarlier")}</Notice> : null}
          <fieldset className={styles.group}>
            <legend className={styles.legend}>{t("attendance.register.absentLabel")}</legend>
            <ul className={styles.roster}>
              {day.students.map((s) => (
                <li key={s.enrollmentId} className={styles.rosterRow}>
                  <Checkbox label={s.name} hint={studentMeta(s)} checked={absent.has(s.enrollmentId)} onChange={(event) => toggle(s.enrollmentId, event.target.checked)} />
                </li>
              ))}
            </ul>
          </fieldset>
          <div className={styles.saveBar}>
            <p className={styles.tally} aria-live="polite">
              {t("attendance.register.counts", tally)}
            </p>
            <Button onClick={() => void save()} loading={saving} loadingLabel={t("attendance.register.saving")}>
              {t("attendance.register.save")}
            </Button>
          </div>
          {saved?.kind === "saved" ? <Notice tone="ok">{t("attendance.register.saved", { present: saved.present, absent: saved.absent })}</Notice> : null}
          {saved?.kind === "failed" ? <Notice tone="bad">{t("attendance.register.failed")}</Notice> : null}
          {saved?.kind === "closed" ? <Notice tone="bad">{t("attendance.register.closed")}</Notice> : null}
        </>
      )}
    </section>
  );
}
