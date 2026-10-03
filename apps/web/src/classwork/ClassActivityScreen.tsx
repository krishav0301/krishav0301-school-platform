"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { toAd } from "@/content/client";
import { BsDateField } from "@/content/BsDateField";
import { isWholeBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button } from "@/ui";

import styles from "./classwork.module.css";
import { gateFailure, loadClassDay } from "./client";
import { className, type ClassActivityDay } from "./model";

/** One class's activity log for a day (`?id=`), today or a day picked in BS: every subject, written or not. */
export function ClassActivityScreen() {
  const { api } = useSession();
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const [date, setDate] = useState<string | undefined>(undefined);
  const [bs, setBs] = useState("");
  const [dayError, setDayError] = useState<MessageKey | null>(null);

  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const result = await loadClassDay(api, id, date);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, id, date]);
  const { view, reload } = useLoad<ClassActivityDay>(loadNow);

  async function show() {
    // A day with its month or year missing asks for them, rather than blaming the calendar (admin FUT F-19).
    if (!isWholeBsDate(bs)) return setDayError("attendance.class.incompleteDay");
    const result = await toAd(api, bs.trim());
    setDayError(result.ok ? null : "classwork.badDay");
    if (result.ok) setDate(result.ad);
  }

  return (
    <>
      <p>
        <Link href="/portal/classwork">{t("classwork.back")}</Link>
      </p>
      <Gate view={view} onRetry={() => void reload()}>
        {(day) => (
          <>
            <h1 className={setupStyles.title}>{className(day)}</h1>
            <div className={styles.dayPicker}>
              <BsDateField legend={t("attendance.class.otherDay")} hint={t("classwork.pickDayHint")} error={dayError ? t(dayError) : undefined} value={bs} onChange={setBs} />
              <Button className={styles.wrapLabel} variant="secondary" onClick={() => void show()}>
                {t("classwork.show")}
              </Button>
            </div>
            <h2 className={setupStyles.subhead}>{day.dateBs ?? day.date}</h2>
            <ul className={styles.list}>
              {day.entries.map((entry) => (
                <li key={entry.offeringId} className={styles.card}>
                  <div>
                    <h3>{entry.subjectName}</h3>
                    <p className={styles.meta}>{entry.teacherName ?? t("classwork.noTeacher")}</p>
                  </div>
                  {entry.body === null ? <p className={setupStyles.empty}>{t("classwork.activity.notWritten")}</p> : <p className={styles.body}>{entry.body}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Gate>
    </>
  );
}
