"use client";

import { useCallback, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { ChangeDate, dayLine, EmptyLine, Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";

import styles from "./classwork.module.css";
import { gateFailure, loadClassDay } from "./client";
import { className, type ClassActivityDay } from "./model";

/** Each subject of the day: who teaches it and what they wrote, in their words, or "Nothing written yet". Pure. */
export function SubjectEntries({ day }: { day: ClassActivityDay }) {
  if (day.entries.length === 0) return <EmptyLine>{t("classwork.noSubjects")}</EmptyLine>;
  return (
    <ul className={styles.entries}>
      {day.entries.map((entry) => (
        <li key={entry.offeringId} className={styles.entry}>
          <div className={styles.entryHead}>
            <h3 className={styles.entryTitle}>{entry.subjectName}</h3>
            {entry.body === null ? <StatusWord tone="warn">{t("classwork.activity.notWritten")}</StatusWord> : null}
          </div>
          <p className={styles.meta}>{entry.teacherName ?? t("classwork.noTeacher")}</p>
          {entry.body === null ? null : <p className={styles.body}>{entry.body}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * One class's activity log for a day (`?id=`), redesigned in D-104: today, or a day picked through Change date; every
 * subject, written or not. Nobody writes here: each teacher writes on their own Classwork page.
 */
/** `embedded`: one tab of a class page (FUT point 19): titled Classwork, without breadcrumbs. */
export function ClassActivityScreen({ embedded = false }: { embedded?: boolean }) {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const [date, setDate] = useState<string | undefined>(undefined);

  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const result = await loadClassDay(api, id, date);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, id, date]);
  const { view, reload } = useLoad<ClassActivityDay>(loadNow);

  if (view.status === "loading") return <TableSkeleton rows={6} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const day = view.data;
  const name = className(day);
  const written = day.entries.filter((e) => e.body !== null).length;

  return (
    <div className={readStyles.page}>
      <ReadHeader
        level={embedded ? 2 : 1}
        title={embedded ? t("classwork.title") : name}
        subtitle={t("classwork.class.subtitle", { written, expected: day.entries.length })}
        crumbs={[{ label: t("classwork.title"), href: "/portal/classwork" }, { label: name }]}
        dayBs={dayLine(day.dateBs, date === undefined, day.date)}
        actions={<ChangeDate onDate={setDate} badDay="classwork.badDay" />}
      />
      <Panel>
        <SubjectEntries day={day} />
      </Panel>
      <ReadOnlyNote>{t("classwork.class.readOnlyNote")}</ReadOnlyNote>
    </div>
  );
}
