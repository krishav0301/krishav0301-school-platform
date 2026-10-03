"use client";

import { Printer } from "lucide-react";
import { useCallback } from "react";

import { useAddressQuery } from "@/content/address";
import { formatBsDate } from "@/content/model";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { ReadFailure, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";
import { Button } from "@/ui";

import { gateFailure, loadReceipt } from "./client";
import styles from "./fees.module.css";
import type { Receipt } from "./model";
import { nprShort } from "./ReadFees";

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

  if (view.status === "loading") return <TableSkeleton rows={7} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  return <ReceiptPaper receipt={view.data} schoolName={config?.school.name ?? ""} />;
}

/** The receipt as a calm paper document (D-104): reversed said at the top in words, the amount large, Print secondary. Pure. */
export function ReceiptPaper({ receipt: r, schoolName }: { receipt: Receipt; schoolName: string }) {
  return (
    <div className={readStyles.page}>
      <article className={styles.paper} aria-labelledby="receipt-heading">
        <header className={styles.paperHead}>
          <div>
            <p className={styles.paperSchool}>{schoolName}</p>
            <h1 id="receipt-heading" className={styles.paperTitle}>
              {t("fees.receipt.title")}
            </h1>
          </div>
          {r.reversed ? <StatusWord tone="bad">{t("fees.history.reversed")}</StatusWord> : null}
        </header>
        {r.reversed ? <p className={styles.paperWarning}>{t("fees.receipt.reversed")}</p> : null}
        <dl className={styles.paperFacts}>
          <div>
            <dt>{t("fees.receipt.number")}</dt>
            <dd>{r.number}</dd>
          </div>
          <div>
            <dt>{t("fees.receipt.date")}</dt>
            <dd>{r.issuedOnBs ? formatBsDate(r.issuedOnBs) : r.issuedAt.slice(0, 10)}</dd>
          </div>
        </dl>
        <div className={styles.paperAmount}>
          <p>{t("fees.receipt.amount")}</p>
          <p className={styles.paperAmountValue}>{nprShort(r.amountPaisa)}</p>
        </div>
        <dl className={styles.paperFacts}>
          <div>
            <dt>{t("fees.receipt.student")}</dt>
            <dd>
              {r.studentName} ({r.sid})
            </dd>
          </div>
          <div>
            <dt>{t("fees.receipt.class")}</dt>
            <dd>
              {r.className} · {r.yearLabel}
            </dd>
          </div>
          <div>
            <dt>{t("fees.receipt.method")}</dt>
            <dd>{t(METHOD[r.method])}</dd>
          </div>
          <div>
            <dt>{t("fees.receipt.balance")}</dt>
            <dd>{nprShort(r.balanceAfterPaisa)}</dd>
          </div>
        </dl>
        <p className={styles.paperNote}>{t("fees.receipt.note")}</p>
      </article>
      <div className={`${styles.actions} ${styles.noPrint}`}>
        <Button className={styles.wrapLabel} variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden width={18} height={18} />
          {t("fees.receipt.print")}
        </Button>
      </div>
    </div>
  );
}
