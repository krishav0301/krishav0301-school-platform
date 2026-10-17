"use client";

import { CircleAlert, Download, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";
import { buttonClass, Select } from "@/ui";

import { gateFailure, loadDues } from "./client";
import styles from "./fees.module.css";
import type { DuesList } from "./model";
import { BalanceWord, nprShort } from "./ReadFees";

/** The dues list (source 6.5): every student this year with what is due and overdue, and a CSV download. */
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
        { key: "status", label: t("attendance.class.status"), cell: (x) => (x.closed ? <StatusWord tone="bad">{t("fees.dues.closed")}</StatusWord> : <BalanceWord row={x} amounts={false} />) },
      ]}
    />
  );
}

export function DuesScreen() {
  const { api } = useSession();
  const [classId, setClassId] = useState("");
  const loadNow = useCallback(async () => {
    const result = await loadDues(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<DuesList>(loadNow);

  const classes = view.status === "ready" ? [...new Map(view.data.students.map((x) => [x.classId, x.className])).entries()] : [];
  const shown = view.status === "ready" ? view.data.students.filter((x) => !classId || x.classId === classId) : [];

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("fees.dues.title")}
        subtitle={t("fees.dues.subtitle")}
        actions={
          <div className={styles.headerActions}>
            <a className={`${buttonClass({ variant: "secondary" })} ${styles.wrapLabel}`} href={classId ? `/api/fees/dues.csv?classId=${classId}` : "/api/fees/dues.csv"} download>
              <Download aria-hidden width={18} height={18} />
              {t("fees.dues.export")}
            </a>
          </div>
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        view.data.students.length === 0 ? (
          <Panel>
            <EmptyLine>{t("fees.dues.empty")}</EmptyLine>
          </Panel>
        ) : (
          <>
            <FigureTiles figures={duesFigures(shown)} label={t("fees.dues.figures")} />
            <div className={readStyles.search}>
              <Select label={t("fees.dues.class")} options={[{ value: "", label: t("fees.dues.allClasses") }, ...classes.map(([value, label]) => ({ value, label }))]} value={classId} onChange={(event) => setClassId(event.target.value)} />
            </div>
            <Panel>
              <DuesTable students={shown} />
            </Panel>
          </>
        )
      ) : null}
    </div>
  );
}
