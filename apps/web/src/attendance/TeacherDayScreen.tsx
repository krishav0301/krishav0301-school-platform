"use client";

import { Plane, UserCheck, UserX } from "lucide-react";
import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { ChangeDate, dayLine, EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, Segments, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Field, Notice } from "@/ui";

import styles from "./attendance.module.css";
import { gateFailure, loadTeacherDay, saveTeacherDay } from "./client";
import { TEACHER_STATUS_LABEL, exceptionsOf, initialStatuses, type TeacherDay } from "./model";

const STATUS_SEGMENTS = (["present", "absent", "leave"] as const).map((key) => ({ key, label: t(TEACHER_STATUS_LABEL[key]) }));

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
          <TeacherList key={day.date} day={day} onSaved={() => void reload()} />
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

/** The day's figures as the list stands: present, absent and on leave, counted from the choices on screen. Pure. */
export function teacherFigures(total: number, exceptions: readonly { status: "absent" | "leave" }[]): Figure[] {
  const absent = exceptions.filter((e) => e.status === "absent").length;
  const leave = exceptions.filter((e) => e.status === "leave").length;
  return [
    { key: "present", icon: UserCheck, tone: "ok", value: String(total - absent - leave), label: t("attendance.teachers.figure.present") },
    { key: "absent", icon: UserX, tone: "bad", value: String(absent), label: t("attendance.teachers.figure.absent") },
    { key: "leave", icon: Plane, tone: "warn", value: String(leave), label: t("attendance.teachers.figure.leave") },
  ];
}

/**
 * The Co-ordinator's list (redesigned in D-106): figures that follow the choices, then each teacher with Present,
 * Absent and On leave side by side, a reason for a past day, and one Save.
 */
export function TeacherList({ day, onSaved }: { day: TeacherDay; onSaved: () => void }) {
  const { api } = useSession();
  const { config } = useConfig();
  const [statuses, setStatuses] = useState(() => initialStatuses(day));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved>(null);
  const exceptions = exceptionsOf(statuses);
  const needsReason = !day.isToday;
  const sectionName = (key: string | null) => config?.sections.find((s) => s.key === key)?.name ?? null;

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

  if (day.teachers.length === 0) {
    return (
      <Panel>
        <EmptyLine>{t("attendance.teachers.empty")}</EmptyLine>
      </Panel>
    );
  }

  return (
    <>
      <FigureTiles figures={teacherFigures(day.teachers.length, exceptions)} label={t("attendance.teachers.figures")} />
      <Panel title={t("attendance.teachers.listTitle")} labelledBy="teacher-day-heading" actions={<StatusWord tone={day.marked ? "ok" : "warn"}>{t(day.marked ? "attendance.teachers.savedWord" : "attendance.teachers.notSavedWord")}</StatusWord>}>
        <p className={readStyles.rowMeta}>{t("attendance.teachers.intro")}</p>
        <ul className={readStyles.rows}>
          {day.teachers.map((teacher) => (
            <li key={teacher.id} className={`${readStyles.rowItem} ${styles.teacherRow}`}>
              <div>
                <h3 className={readStyles.rowTitle}>{teacher.name}</h3>
                {sectionName(teacher.sectionKey) ? <p className={readStyles.rowMeta}>{sectionName(teacher.sectionKey)}</p> : null}
              </div>
              <Segments
                label={t("attendance.teachers.statusOf", { name: teacher.name })}
                value={statuses[teacher.id] ?? "present"}
                options={STATUS_SEGMENTS}
                onChange={(value) => {
                  setStatuses((current) => ({ ...current, [teacher.id]: value }));
                  setSaved(null);
                }}
              />
            </li>
          ))}
        </ul>
        {needsReason ? (
          <Field
            label={t("attendance.teachers.reason")}
            hint={t("attendance.teachers.reasonHint")}
            value={reason}
            maxLength={300}
            onChange={(event) => {
              setReason(event.target.value);
              if (saved?.kind === "invalid") setSaved(null);
            }}
          />
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
      </Panel>
    </>
  );
}
