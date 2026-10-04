"use client";

import { useCallback, useState } from "react";

import { toAd } from "@/content/client";
import { BsDateField } from "@/content/BsDateField";
import { t } from "@/i18n/messages";
import { EmptyLine, Panel, ReadFailure, ReadHeader, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Field, Notice } from "@/ui";

import { AccountView } from "./AccountView";
import { gateFailure, loadOwnAccount, submitVoucher, type Sent } from "./client";
import styles from "./fees.module.css";
import type { Account } from "./model";
import { parseNpr } from "./money";

export function sentMessage(sent: Sent): string | null {
  if (sent.ok) return null;
  if (sent.reason === "invalid") return sent.message;
  if (sent.reason === "closed") return t("fees.closed");
  if (sent.reason === "refused") return t("fees.refused");
  return t("fees.failed");
}

/** The student's own fees (source 6.1; redesigned in D-107): figures, what is due next, the history and receipts; a bank deposit is reported in a pop-up. */
export function OwnFees() {
  const { api } = useSession();
  const [none, setNone] = useState(false);
  const [sent, setSent] = useState(false);
  const loadNow = useCallback(async () => {
    const result = await loadOwnAccount(api);
    setNone(!result.ok && result.reason === "not_found");
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<Account>(loadNow);
  const account = view.status === "ready" ? view.data : null;
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("fees.own.title")}
        subtitle={account ? [account.sid, account.className, account.yearLabel].join(" · ") : undefined}
        actions={
          account ? (
            <AddDialog label={t("fees.voucher.title")} title={t("fees.voucher.title")} plus={false}>
              {(close) => (
                <VoucherForm
                  onSent={() => {
                    close();
                    setSent(true);
                    void reload();
                  }}
                />
              )}
            </AddDialog>
          ) : null
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={4} /> : null}
      {view.status === "failed" && none ? (
        <Panel>
          <EmptyLine>{t("fees.own.none")}</EmptyLine>
        </Panel>
      ) : null}
      {(view.status === "failed" && !none) || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {sent ? <Notice tone="ok">{t("fees.voucher.sent")}</Notice> : null}
      {account ? <AccountView account={account} /> : null}
    </div>
  );
}

function VoucherForm({ onSent }: { onSent: () => void }) {
  const { api } = useSession();
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [paidBs, setPaidBs] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    const paisa = parseNpr(amount);
    if (paisa === null) return setMessage(t("fees.badAmount"));
    setBusy(true);
    const day = await toAd(api, paidBs.trim());
    if (!day.ok) {
      setBusy(false);
      return setMessage(t("fees.voucher.badDay"));
    }
    const sent = await submitVoucher(api, { amountPaisa: paisa, bank: bank.trim(), reference: reference.trim(), paidOn: day.ad });
    setBusy(false);
    if (sent.ok) onSent();
    else setMessage(sentMessage(sent));
  }

  return (
    <div className={styles.form}>
      <p className={styles.meta}>{t("fees.voucher.intro")}</p>
      <Field label={t("fees.amount")} hint={t("fees.amountHint")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Field label={t("fees.voucher.bank")} value={bank} maxLength={80} onChange={(event) => setBank(event.target.value)} />
      <Field label={t("fees.voucher.reference")} value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} />
      <BsDateField legend={t("fees.voucher.paidOn")} value={paidBs} onChange={setPaidBs} />
      {message ? <Notice tone="bad">{message}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void send()} loading={busy} loadingLabel={t("fees.saving")} disabled={!amount.trim() || !bank.trim() || !reference.trim() || !paidBs.trim() || busy}>
        {t("fees.voucher.send")}
      </Button>
    </div>
  );
}
