"use client";

import { CalendarCheck, UserX } from "lucide-react";
import { useState } from "react";

import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, Segments, StatusWord, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { Button, Notice } from "@/ui";

import styles from "./attendance.module.css";
import { saveToday } from "./client";
import { className, counts, initialAbsent, studentMeta, type AttendanceDay } from "./model";

type Saved = { kind: "saved"; present: number; absent: number } | { kind: "failed" } | { kind: "closed" } | null;

const CHOICES = [
  { key: "present" as const, label: "attendance.class.present" as const },
  { key: "absent" as const, label: "attendance.class.absent" as const },
];

/** The register's figures as it stands on screen: present and absent. Pure. */
export function registerFigures(tally: { present: number; absent: number }): Figure[] {
  return [
    { key: "present", icon: CalendarCheck, tone: "ok", value: String(tally.present), label: t("attendance.register.figure.present") },
    { key: "absent", icon: UserX, tone: tally.absent > 0 ? "bad" : "ok", value: String(tally.absent), label: t("attendance.register.figure.absent") },
  ];
}

/**
 * The Class Teacher's register for today (D-069; redesigned in D-107 like the Co-ordinator's teacher list): figures
 * that follow the choices, each student with Present and Absent side by side, one Save. Saving again the same day
 * replaces the day, so a second tap or a retry is harmless.
 */
export function Register({ day, onSaved }: { day: AttendanceDay; onSaved?: () => void }) {
  const { api } = useSession();
  const [absent, setAbsent] = useState<Set<string>>(() => initialAbsent(day));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved>(null);
  const [marked, setMarked] = useState(day.marked);
  const tally = counts(day, absent);
  const options = CHOICES.map((c) => ({ key: c.key, label: t(c.label) }));

  function choose(id: string, isAbsent: boolean) {
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
      setMarked(true);
      onSaved?.();
    } else setSaved({ kind: result.reason });
  }

  const title = t("attendance.register.titleFor", { name: className(day.class) });
  if (day.students.length === 0) {
    return (
      <Panel title={title} labelledBy={`register-${day.class.id}`}>
        <EmptyLine>{t("attendance.register.empty")}</EmptyLine>
      </Panel>
    );
  }
  return (
    <>
      <FigureTiles figures={registerFigures(tally)} label={t("attendance.register.figures")} />
      <Panel title={title} labelledBy={`register-${day.class.id}`} actions={<StatusWord tone={marked ? "ok" : "warn"}>{t(marked ? "attendance.teachers.savedWord" : "attendance.teachers.notSavedWord")}</StatusWord>}>
        <p className={readStyles.rowMeta}>{t("attendance.register.intro")}</p>
        <ul className={readStyles.rows}>
          {day.students.map((s) => (
            <li key={s.enrollmentId} className={`${readStyles.rowItem} ${styles.teacherRow}`}>
              <div>
                <h3 className={readStyles.rowTitle}>{s.name}</h3>
                <p className={readStyles.rowMeta}>{studentMeta(s)}</p>
              </div>
              <Segments label={t("attendance.register.statusOf", { name: s.name })} value={absent.has(s.enrollmentId) ? "absent" : "present"} options={options} onChange={(value) => choose(s.enrollmentId, value === "absent")} />
            </li>
          ))}
        </ul>
        <div className={styles.saveBar}>
          <p className={styles.tally} aria-live="polite">
            {t("attendance.register.counts", tally)}
          </p>
          <Button className={styles.wrapLabel} onClick={() => void save()} loading={saving} loadingLabel={t("attendance.register.saving")}>
            {t("attendance.register.save")}
          </Button>
        </div>
        {saved?.kind === "saved" ? <Notice tone="ok">{t("attendance.register.saved", { present: saved.present, absent: saved.absent })}</Notice> : null}
        {saved?.kind === "failed" ? <Notice tone="bad">{t("attendance.register.failed")}</Notice> : null}
        {saved?.kind === "closed" ? <Notice tone="bad">{t("attendance.register.closed")}</Notice> : null}
      </Panel>
    </>
  );
}
