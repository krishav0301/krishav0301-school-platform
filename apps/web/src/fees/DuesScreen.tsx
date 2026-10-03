"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, buttonClass, Notice } from "@/ui";

import { gateFailure, loadDues, sendReminders } from "./client";
import styles from "./fees.module.css";
import type { DuesList } from "./model";
import { formatNpr } from "./money";
import { sentMessage } from "./OwnFees";

/** The dues list (source 6.5): every student this year with what is due and overdue, a CSV download, and overdue reminders. */
/** What a dues row says: nothing charged yet, paid up, or what is due (admin FUT F-10: nothing charged is not paid up). */
export function dueState(row: { chargedPaisa: number; paidPaisa: number; duePaisa: number }): "nothing" | "clear" | "due" {
  if (row.chargedPaisa === 0 && row.paidPaisa === 0) return "nothing";
  return row.duePaisa === 0 ? "clear" : "due";
}

export function DuesScreen() {
  const { api, me } = useSession();
  const accountant = me?.roles.some((r) => r.role === "accountant") ?? false;
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const loadNow = useCallback(async () => {
    const result = await loadDues(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<DuesList>(loadNow);

  async function remind() {
    setBusy(true);
    const sent = await sendReminders(api);
    setBusy(false);
    setMessage(sent.ok ? { tone: "ok", text: t("fees.dues.reminded", { count: (sent.data as { queued: number }).queued }) } : { tone: "bad", text: sentMessage(sent)! });
  }

  return (
    <>
      <h1 className={setupStyles.title}>{t("fees.dues.title")}</h1>
      <Gate view={view} onRetry={() => void reload()}>
        {(list) => (
          <>
            <p className={styles.amount}>{t("fees.dues.totals", { due: formatNpr(list.totals.duePaisa), overdue: formatNpr(list.totals.overduePaisa) })}</p>
            <div className={styles.actions}>
              <a className={`${buttonClass({ variant: "secondary" })} ${styles.wrapLabel}`} href="/api/fees/dues.csv" download>
                {t("fees.dues.export")}
              </a>
              {accountant ? (
                <Button className={styles.wrapLabel} variant="secondary" onClick={() => void remind()} loading={busy} loadingLabel={t("fees.saving")}>
                  {t("fees.dues.remind")}
                </Button>
              ) : null}
            </div>
            {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
            {list.students.length === 0 ? (
              <p className={setupStyles.empty}>{t("fees.dues.empty")}</p>
            ) : (
              <ul className={`${styles.card} ${styles.list}`}>
                {list.students.map((s) => (
                  <li key={s.enrollmentId} className={styles.row}>
                    <span>
                      {s.studentName}
                      <br />
                      <span className={styles.meta}>
                        {s.sid} · {s.className}
                      </span>
                    </span>
                    <span className={styles.amount}>
                      {/* Nothing charged is not "paid up" (admin FUT F-10). */}
                      {dueState(s) === "nothing" ? (
                        <Badge>{t("fees.dues.nothingCharged")}</Badge>
                      ) : dueState(s) === "clear" ? (
                        <Badge tone="ok">{t("fees.dues.clear")}</Badge>
                      ) : (
                        t("fees.dues.row", { due: formatNpr(s.duePaisa), overdue: formatNpr(s.overduePaisa) })
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Gate>
    </>
  );
}
