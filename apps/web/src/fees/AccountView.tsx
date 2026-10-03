"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import setupStyles from "@/setup/setup.module.css";
import { Badge } from "@/ui";

import styles from "./fees.module.css";
import { KIND_LABEL, type Account } from "./model";
import { formatNpr } from "./money";

const npr = (paisa: number) => t("fees.npr", { amount: formatNpr(paisa) });

/**
 * A fee account as its reader sees it (D-078): what is due now, overdue, credit, and the next due first; then the
 * totals, the receipts and the history. The same view for the student and for staff; staff add their actions around it.
 * `entryAction` lets staff put a control on an entry (Reverse, on a payment).
 */
export function AccountView({ account, entryAction }: { account: Account; entryAction?: (entry: Account["entries"][number]) => ReactNode }) {
  return (
    <>
      <section aria-labelledby="fees-summary" className={styles.card}>
        <h2 id="fees-summary" className="sr-only">
          {t("fees.title")}
        </h2>
        <dl className={styles.summary}>
          <div className={styles.stat}>
            <dt>{t("fees.summary.due")}</dt>
            <dd>{npr(account.duePaisa)}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{t("fees.summary.overdue")}</dt>
            <dd>{npr(account.overduePaisa)}</dd>
          </div>
          {account.creditPaisa > 0 ? (
            <div className={styles.stat}>
              <dt>{t("fees.summary.credit")}</dt>
              <dd>{npr(account.creditPaisa)}</dd>
            </div>
          ) : null}
          <div className={styles.stat}>
            <dt>{t("fees.summary.nextDue")}</dt>
            <dd>{account.nextDue ? t("fees.summary.nextDueValue", { amount: formatNpr(account.nextDue.remainingPaisa), date: account.nextDue.dueOnBs ?? account.nextDue.dueOn }) : t("fees.summary.nothingDue")}</dd>
          </div>
        </dl>
        <ul className={styles.list}>
          <li className={styles.row}>
            <span>{t("fees.summary.charged")}</span>
            <span className={styles.amount}>{npr(account.chargedPaisa)}</span>
          </li>
          <li className={styles.row}>
            <span>{t("fees.summary.discount")}</span>
            <span className={styles.amount}>{npr(account.discountPaisa)}</span>
          </li>
          <li className={styles.row}>
            <span>{t("fees.summary.paid")}</span>
            <span className={styles.amount}>{npr(account.paidPaisa)}</span>
          </li>
          {account.refundedPaisa > 0 ? (
            <li className={styles.row}>
              <span>{t("fees.summary.refunded")}</span>
              <span className={styles.amount}>{npr(account.refundedPaisa)}</span>
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="fees-receipts" className={styles.card}>
        <h2 id="fees-receipts" className={setupStyles.subhead}>
          {t("fees.receipts.title")}
        </h2>
        {account.receipts.length === 0 ? (
          <p className={setupStyles.empty}>{t("fees.receipts.empty")}</p>
        ) : (
          <ul className={styles.list}>
            {account.receipts.map((r) => (
              <li key={r.id} className={styles.row}>
                <span>
                  <Link href={`/portal/fees/receipt?id=${r.id}`}>{t("fees.receipts.open", { number: r.number })}</Link>
                  <br />
                  <span className={styles.meta}>{formatBsDate(r.issuedOnBs)}</span>
                </span>
                <span className={styles.amount}>
                  {npr(r.amountPaisa)} {r.reversed ? <Badge tone="bad">{t("fees.history.reversed")}</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fees-history" className={styles.card}>
        <h2 id="fees-history" className={setupStyles.subhead}>
          {t("fees.history.title")}
        </h2>
        {account.entries.length === 0 ? (
          <p className={setupStyles.empty}>{t("fees.history.empty")}</p>
        ) : (
          <ul className={styles.list}>
            {[...account.entries].reverse().map((e) => (
              <li key={e.id} className={styles.row}>
                <span>
                  {t(KIND_LABEL[e.kind])}
                  {e.memo ? ` · ${e.memo}` : ""}
                  <br />
                  <span className={styles.meta}>
                    {e.dueOnBs ? t("fees.history.dueOn", { date: formatBsDate(e.dueOnBs) }) : formatBsDate(e.createdOnBs)}
                    {e.period && e.period.includes("-") ? ` · ${e.period}` : ""}
                  </span>
                </span>
                <span className={styles.amount}>
                  {npr(Math.abs(e.amountPaisa))} {e.reversed ? <Badge tone="bad">{t("fees.history.reversed")}</Badge> : null}
                  {entryAction ? entryAction(e) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
