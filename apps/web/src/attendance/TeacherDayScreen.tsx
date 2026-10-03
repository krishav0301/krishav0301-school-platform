"use client";

import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { ChangeDate, dayLine, EmptyLine, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { useLoad } from "@/setup/useLoad";
import { Button, Field, Notice, Select } from "@/ui";

import styles from "./attendance.module.css";
import { gateFailure, loadTeacherDay, saveTeacherDay } from "./client";
import { TEACHER_STATUS_LABEL, exceptionsOf, initialStatuses, type TeacherDay, type TeacherStatus } from "./model";

const STATUS_OPTIONS = (["present", "absent", "leave"] as const).map((value) => ({ value, label: t(TEACHER_STATUS_LABEL[value]) }));

/** A day's teachers, read only: status in words and, for a corrected past day, its reason. Pure, so tests draw it. */
export function TeacherTable({ day }: { day: TeacherDay }) {
  if (day.teachers.length === 0) return <EmptyLine>{t("attendance.teachers.empty")}</EmptyLine>;
  if (!day.marked) return <EmptyLine>{t(day.isToday ? "attendance.teachers.notMarkedToday" : "attendance.teachers.notMarkedDay")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("attendance.teachers.title")}
      rows={day.teachers}
      rowKey={(x) => x.id}
      columns={[
        { key: "n", label: "#", hidePhone: true, cell: (_x, i) => <span className={readStyles.number}>{i + 1}</span> },
        { key: "name", label: t("attendance.col.teacher"), primary: true, cell: (x) => x.name },
        {
          key: "status",
          label: t("attendance.class.status"),
          cell: (x) =>
            x.status === null ? (
              <StatusWord>{t("attendance.status.notMarked")}</StatusWord>
            ) : (
              <StatusWord tone={x.status === "present" ? "ok" : x.status === "absent" ? "bad" : "warn"}>{t(TEACHER_STATUS_LABEL[x.status])}</StatusWord>
            ),
        },
        { key: "reason", label: t("attendance.col.reason"), cell: (x) => x.reason ?? "—" },
      ]}
    />
  );
}

/**
 * Teacher attendance (D-070; redesigned in D-103 after the PM's reference): the Co-ordinator's daily list, everyone
 * Present to start, Absent or On leave as the exceptions, one Save. A past day is opened with Change date and corrected
 * with a reason. The Principal reads the same day as a table, with no controls.
 */
export function TeacherDayScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const canMark = me?.roles.some((r) => r.role === "coordinator" || r.role === "super_admin") ?? false;
  const [date, setDate] = useState<string | undefined>(undefined);

  const loadNow = useCallback(async () => {
    const result = await loadTeacherDay(api, date);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, date]);
  const { view, reload } = useLoad<TeacherDay>(loadNow);
  const day = view.status === "ready" ? view.data : null;

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("attendance.teachers.title")}
        subtitle={t("attendance.teachers.subtitle", { coordinator: term("role.coordinator") })}
        dayBs={day ? dayLine(day.dateBs, day.isToday, day.date) : null}
        actions={<ChangeDate onDate={setDate} />}
      />
      {view.status === "loading" ? <TableSkeleton rows={8} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {day ? (
        canMark ? (
          <Panel>
            <TeacherList key={day.date} day={day} canMark onSaved={() => void reload()} />
          </Panel>
        ) : (
          <>
            <Panel>
              <TeacherTable day={day} />
            </Panel>
            <ReadOnlyNote>{t("attendance.teachers.readOnlyNote", { coordinator: term("role.coordinator") })}</ReadOnlyNote>
          </>
        )
      ) : null}
    </div>
  );
}

type Saved = { kind: "saved" } | { kind: "closed" } | { kind: "failed" } | { kind: "invalid"; message: string } | null;

function TeacherList({ day, canMark, onSaved }: { day: TeacherDay; canMark: boolean; onSaved: () => void }) {
  const { api } = useSession();
  const [statuses, setStatuses] = useState(() => initialStatuses(day));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved>(null);
  const exceptions = exceptionsOf(statuses);
  const needsReason = !day.isToday;

  async function save() {
    if (needsReason && reason.trim().length < 3) return setSaved({ kind: "invalid", message: t("attendance.teachers.reasonNeeded") });
    setSaving(true);
    const result = await saveTeacherDay(api, day.date, exceptions, needsReason ? reason : "");
    setSaving(false);
    if (result.ok) {
      setSaved({ kind: "saved" });
      onSaved();
    } else setSaved(result.reason === "invalid" ? { kind: "invalid", message: result.message } : { kind: result.reason });
  }

  return (
    <section className={styles.register} aria-labelledby="teacher-day-heading">
      <div>
        <h2 id="teacher-day-heading" className={setupStyles.subhead}>
          {day.isToday ? t("attendance.today", { date: day.dateBs ?? day.date }) : (day.dateBs ?? day.date)}
        </h2>
        <p className={setupStyles.muted}>{day.marked ? t("attendance.teachers.saved") : t("attendance.teachers.notSaved")}</p>
      </div>
      {day.teachers.length === 0 ? (
        <p className={setupStyles.empty}>{t("attendance.teachers.empty")}</p>
      ) : canMark ? (
        <>
          <p>{t("attendance.teachers.intro")}</p>
          <ul className={styles.roster}>
            {day.teachers.map((teacher) => (
              <li key={teacher.id} className={styles.rosterRow}>
                <Select
                  label={teacher.name}
                  options={STATUS_OPTIONS}
                  value={statuses[teacher.id]}
                  onChange={(event) => {
                    setStatuses((current) => ({ ...current, [teacher.id]: event.target.value as TeacherStatus }));
                    setSaved(null);
                  }}
                />
              </li>
            ))}
          </ul>
          {needsReason ? (
            <Field label={t("attendance.teachers.reason")} hint={t("attendance.teachers.reasonHint")} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          ) : null}
          <div className={styles.saveBar}>
            <p className={styles.tally} aria-live="polite">
              {t("attendance.teachers.counts", {
                present: day.teachers.length - exceptions.length,
                absent: exceptions.filter((e) => e.status === "absent").length,
                leave: exceptions.filter((e) => e.status === "leave").length,
              })}
            </p>
            <Button className={styles.wrapLabel} onClick={() => void save()} loading={saving} loadingLabel={t("attendance.register.saving")}>
              {t("attendance.teachers.save")}
            </Button>
          </div>
          {saved?.kind === "saved" ? <Notice tone="ok">{t("attendance.teachers.done")}</Notice> : null}
          {saved?.kind === "failed" ? <Notice tone="bad">{t("attendance.register.failed")}</Notice> : null}
          {saved?.kind === "closed" ? <Notice tone="bad">{t("attendance.register.closed")}</Notice> : null}
          {saved?.kind === "invalid" ? <Notice tone="bad">{saved.message}</Notice> : null}
        </>
      ) : (
        <ul className={styles.roster}>
          {day.teachers.map((teacher) => (
            <li key={teacher.id} className={`${styles.rosterRow} ${styles.readRow}`}>
              <span>{teacher.name}</span>
              <span>{teacher.status ? t(TEACHER_STATUS_LABEL[teacher.status]) : t("attendance.class.none")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
