"use client";

import { CircleAlert, Download, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, ReadTable, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";
import { Button, buttonClass, Notice, Select } from "@/ui";

import { gateFailure, loadDues, sendReminders } from "./client";
import styles from "./fees.module.css";
import type { DuesList } from "./model";
import { BalanceWord, nprShort } from "./ReadFees";
import { sentMessage } from "./OwnFees";

/** The dues list (source 6.5): every student this year with what is due and overdue, a CSV download, and overdue reminders. */
/** What a dues row says: nothing charged yet, paid up, or what is due (admin FUT F-10: nothing charged is not paid up). */
export function dueState(row: { chargedPaisa: number; paidPaisa: number; duePaisa: number }): "nothing" | "clear" | "due" {
  if (row.chargedPaisa === 0 && row.paidPaisa === 0) return "nothing";
  return row.duePaisa === 0 ? "clear" : "due";
}

/** The figures above the dues: what is due, how much of it is overdue, and how many students owe anything. */
export function duesFigures(students: DuesList["students"]): Figure[] {
  const due = students.reduce((n, x) => n + x.duePaisa, 0);
  const overdue = students.reduce((n, x) => n + x.overduePaisa, 0);
  return [
    { key: "due", icon: Wallet, tone: "warn", value: nprShort(due), label: t("fees.dues.figure.due") },
    { key: "overdue", icon: CircleAlert, tone: "bad", value: nprShort(overdue), label: t("fees.dues.figure.overdue") },
    { key: "students", icon: Users, tone: "accent", value: String(students.filter((x) => x.duePaisa > 0).length), label: t("fees.dues.figure.students") },
  ];
}

/** Every student with what is due and overdue and the balance in words, each opening their fee account. Pure. */
export function DuesTable({ students }: { students: DuesList["students"] }) {
  return (
    <ReadTable
      caption={t("fees.dues.title")}
      rows={students}
      rowKey={(x) => x.enrollmentId}
      columns={[
        { key: "name", label: t("fees.col.student"), primary: true, cell: (x) => <Link href={`/portal/fees/student?id=${x.studentId}`}>{x.studentName}</Link> },
        { key: "sid", label: t("attendance.col.sid"), cell: (x) => x.sid },
        { key: "class", label: t("attendance.col.class"), cell: (x) => x.className },
        { key: "due", label: t("fees.summary.due"), align: "end", cell: (x) => nprShort(x.duePaisa) },
        { key: "overdue", label: t("fees.summary.overdue"), align: "end", cell: (x) => nprShort(x.overduePaisa) },
        { key: "status", label: t("attendance.class.status"), cell: (x) => <BalanceWord row={x} amounts={false} /> },
      ]}
    />
  );
}

export function DuesScreen() {
  const { api, me } = useSession();
  const accountant = me?.roles.some((r) => r.role === "accountant") ?? false;
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [classId, setClassId] = useState("");
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

  const classes = view.status === "ready" ? [...new Map(view.data.students.map((x) => [x.classId, x.className])).entries()] : [];
  const shown = view.status === "ready" ? view.data.students.filter((x) => !classId || x.classId === classId) : [];

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("fees.dues.title")}
        subtitle={t("fees.dues.subtitle")}
        actions={
          <a className={`${buttonClass({ variant: "secondary" })} ${styles.wrapLabel}`} href={classId ? `/api/fees/dues.csv?classId=${classId}` : "/api/fees/dues.csv"} download>
            <Download aria-hidden width={18} height={18} />
            {t("fees.dues.export")}
          </a>
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        view.data.students.length === 0 ? (
          <EmptyLine>{t("fees.dues.empty")}</EmptyLine>
        ) : (
          <>
            <FigureTiles figures={duesFigures(shown)} label={t("fees.dues.figures")} />
            <div className={readStyles.search}>
              <Select label={t("fees.dues.class")} options={[{ value: "", label: t("fees.dues.allClasses") }, ...classes.map(([value, label]) => ({ value, label }))]} value={classId} onChange={(event) => setClassId(event.target.value)} />
            </div>
            {accountant ? (
              <div className={styles.actions}>
                <Button className={styles.wrapLabel} variant="secondary" onClick={() => void remind()} loading={busy} loadingLabel={t("fees.saving")}>
                  {t("fees.dues.remind")}
                </Button>
              </div>
            ) : null}
            {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
            <Panel>
              <DuesTable students={shown} />
            </Panel>
          </>
        )
      ) : null}
    </div>
  );
}
