"use client";

import { useCallback } from "react";

import { useAddressQuery } from "@/content/address";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button, Notice } from "@/ui";

import { gateFailure, loadReceipt } from "./client";
import styles from "./fees.module.css";
import type { Receipt } from "./model";
import { formatNpr } from "./money";

const METHOD = { cash: "fees.receipt.method.cash", voucher: "fees.receipt.method.voucher", gateway: "fees.receipt.method.gateway" } as const;

/**
 * A receipt (`?id=`), generated from the ledger and never edited (CLAUDE.md section 6). The student may print or save
 * it (source 6.1, their own receipts). OPEN: a PDF through Browser Rendering is a later step; this page prints cleanly.
 */
export function ReceiptScreen() {
  const { api } = useSession();
  const { config } = useConfig();
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const result = await loadReceipt(api, id);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, id]);
  const { view, reload } = useLoad<Receipt>(loadNow);

  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(r) => (
        <article className={`${styles.card} ${styles.receipt}`} aria-labelledby="receipt-heading">
          <div>
            <p className={styles.meta}>{config?.school.name}</p>
            <h1 id="receipt-heading" className={setupStyles.title}>
              {t("fees.receipt.title")}
            </h1>
          </div>
          {r.reversed ? <Notice tone="bad">{t("fees.receipt.reversed")}</Notice> : null}
          <dl>
            <dt>{t("fees.receipt.number")}</dt>
            <dd>{r.number}</dd>
            <dt>{t("fees.receipt.date")}</dt>
            <dd>{r.issuedOnBs ?? r.issuedAt.slice(0, 10)}</dd>
            <dt>{t("fees.receipt.student")}</dt>
            <dd>
              {r.studentName} ({r.sid})
            </dd>
            <dt>{t("fees.receipt.class")}</dt>
            <dd>
              {r.className} · {r.yearLabel}
            </dd>
            <dt>{t("fees.receipt.amount")}</dt>
            <dd className={styles.amount}>{t("fees.npr", { amount: formatNpr(r.amountPaisa) })}</dd>
            <dt>{t("fees.receipt.method")}</dt>
            <dd>{t(METHOD[r.method])}</dd>
            <dt>{t("fees.receipt.balance")}</dt>
            <dd>{t("fees.npr", { amount: formatNpr(r.balanceAfterPaisa) })}</dd>
          </dl>
          <p className={styles.meta}>{t("fees.receipt.note")}</p>
          <div className={`${styles.actions} ${styles.noPrint}`}>
            <Button className={styles.wrapLabel} variant="secondary" onClick={() => window.print()}>
              {t("fees.receipt.print")}
            </Button>
          </div>
        </article>
      )}
    </Gate>
  );
}
