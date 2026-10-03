"use client";

import { BadgePercent, ReceiptText, Scale, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, OpenLink, Panel, ReadTable, StatusWord, readStyles, type Figure } from "@/read/ReadView";

import styles from "./fees.module.css";
import { KIND_LABEL, type Account } from "./model";
import { formatNprShort } from "./money";
import { balanceState, nprShort } from "./ReadFees";

type Entry = Account["entries"][number];

/** The four figures (D-104): charged, discount, paid, and the balance worked out from the ledger, said in words. */
export function accountFigures(account: Account): Figure[] {
  const state = balanceState(account);
  const balance =
    state === "nothing"
      ? t("fees.dues.nothingCharged")
      : state === "credit"
        ? t("fees.balance.credit", { amount: formatNprShort(account.creditPaisa) })
        : account.balancePaisa === 0
          ? t("fees.dues.clear")
          : nprShort(account.balancePaisa);
  return [
    { key: "charged", icon: ReceiptText, tone: "accent", value: nprShort(account.chargedPaisa), label: t("fees.summary.charged") },
    { key: "discount", icon: BadgePercent, tone: "ok", value: nprShort(account.discountPaisa), label: t("fees.summary.discount") },
    { key: "paid", icon: Wallet, tone: "ok", value: nprShort(account.paidPaisa), label: t("fees.summary.paid") },
    { key: "balance", icon: Scale, tone: account.overduePaisa > 0 ? "bad" : "warn", value: balance, label: t("fees.summary.balance") },
  ];
}

/** One line under the figures: what is due now, how much of it is overdue, and the next due day. */
function dueLine(account: Account): string {
  const parts = [t("fees.line.due", { amount: formatNprShort(account.duePaisa) })];
  if (account.overduePaisa > 0) parts.push(t("fees.line.overdue", { amount: formatNprShort(account.overduePaisa) }));
  parts.push(account.nextDue ? t("fees.line.next", { amount: formatNprShort(account.nextDue.remainingPaisa), date: account.nextDue.dueOnBs ? formatBsDate(account.nextDue.dueOnBs) : account.nextDue.dueOn }) : t("fees.summary.nothingDue"));
  return parts.join(" · ");
}

/** The history, newest first, as a calm timeline: what each entry is, its day, its amount; a reversed payment says so. Pure. */
export function History({ entries, entryAction }: { entries: readonly Entry[]; entryAction?: (entry: Entry) => ReactNode }) {
  if (entries.length === 0) return <EmptyLine>{t("fees.history.empty")}</EmptyLine>;
  return (
    <ol className={styles.timeline}>
      {[...entries].reverse().map((e) => (
        <li key={e.id} className={styles.event} data-kind={e.kind}>
          <div className={styles.eventText}>
            <p className={styles.eventTitle}>
              {t(KIND_LABEL[e.kind])}
              {e.memo ? <span className={styles.meta}> · {e.memo}</span> : null}
            </p>
            <p className={styles.meta}>
              {e.dueOnBs ? t("fees.history.dueOn", { date: formatBsDate(e.dueOnBs) }) : e.createdOnBs ? formatBsDate(e.createdOnBs) : null}
              {e.period && e.period.includes("-") ? ` · ${e.period}` : ""}
            </p>
            {e.receiptId || e.reversed ? (
              <p className={styles.eventLinks}>
                {e.reversed ? <StatusWord tone="bad">{t("fees.history.reversed")}</StatusWord> : null}
                {e.receiptId ? <Link href={`/portal/fees/receipt?id=${e.receiptId}`}>{t("fees.history.viewReceipt")}</Link> : null}
              </p>
            ) : null}
          </div>
          <div className={styles.eventAmount}>
            <span className={styles.amount}>{nprShort(Math.abs(e.amountPaisa))}</span>
            {entryAction ? entryAction(e) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Receipts: number, BS day, amount, Reversed in words, each opening the receipt. Pure. */
export function ReceiptsTable({ receipts }: { receipts: Account["receipts"] }) {
  if (receipts.length === 0) return <EmptyLine>{t("fees.receipts.empty")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("fees.receipts.title")}
      rows={receipts}
      rowKey={(r) => r.id}
      columns={[
        { key: "number", label: t("fees.receipt.number"), primary: true, cell: (r) => r.number },
        { key: "date", label: t("fees.receipt.date"), cell: (r) => (r.issuedOnBs ? formatBsDate(r.issuedOnBs) : "—") },
        { key: "amount", label: t("fees.col.amount"), align: "end", cell: (r) => nprShort(r.amountPaisa) },
        { key: "status", label: t("attendance.class.status"), cell: (r) => (r.reversed ? <StatusWord tone="bad">{t("fees.history.reversed")}</StatusWord> : <StatusWord tone="ok">{t("fees.receipts.valid")}</StatusWord>) },
        { key: "open", label: t("fees.receipt.title"), align: "end", plain: true, cell: (r) => <OpenLink href={`/portal/fees/receipt?id=${r.id}`} label={t("fees.receipts.open", { number: r.number })} /> },
      ]}
    />
  );
}

/**
 * A fee account as its reader sees it (D-078, redesigned in D-104): four figures, what is due and when, the history as a
 * timeline and the receipts. The same view for the student and for staff; staff add their actions around it.
 * `entryAction` lets staff put a control on an entry (Reverse, on a payment).
 */
export function AccountView({ account, entryAction }: { account: Account; entryAction?: (entry: Entry) => ReactNode }) {
  return (
    <>
      <FigureTiles figures={accountFigures(account)} label={t("fees.figures")} />
      <p className={readStyles.subtitle}>{dueLine(account)}</p>
      <Panel title={t("fees.history.title")} labelledBy="fees-history">
        <History entries={account.entries} entryAction={entryAction} />
      </Panel>
      <Panel title={t("fees.receipts.title")} labelledBy="fees-receipts">
        <ReceiptsTable receipts={account.receipts} />
      </Panel>
    </>
  );
}
