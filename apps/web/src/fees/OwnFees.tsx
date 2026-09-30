"use client";

import { useCallback, useState } from "react";

import { toAd } from "@/content/client";
import { BsDateField } from "@/content/BsDateField";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button, Field, Notice } from "@/ui";

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

/** The student's own fees (source 6.1): totals, what is due next, the history and receipts; and a bank deposit to report. */
export function OwnFees() {
  const { api } = useSession();
  const [none, setNone] = useState(false);
  const loadNow = useCallback(async () => {
    const result = await loadOwnAccount(api);
    setNone(!result.ok && result.reason === "not_found");
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<Account>(loadNow);
  return (
    <>
      <h1 className={setupStyles.title}>{t("fees.own.title")}</h1>
      {view.status === "failed" && none ? (
        <p className={setupStyles.empty}>{t("fees.own.none")}</p>
      ) : (
        <Gate view={view} onRetry={() => void reload()}>
          {(account) => (
            <>
              <AccountView account={account} />
              <VoucherForm onSent={() => void reload()} />
            </>
          )}
        </Gate>
      )}
    </>
  );
}

function VoucherForm({ onSent }: { onSent: () => void }) {
  const { api } = useSession();
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [paidBs, setPaidBs] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function send() {
    const paisa = parseNpr(amount);
    if (paisa === null) return setMessage({ tone: "bad", text: t("fees.badAmount") });
    setBusy(true);
    const day = await toAd(api, paidBs.trim());
    if (!day.ok) {
      setBusy(false);
      return setMessage({ tone: "bad", text: t("fees.voucher.badDay") });
    }
    const sent = await submitVoucher(api, { amountPaisa: paisa, bank: bank.trim(), reference: reference.trim(), paidOn: day.ad });
    setBusy(false);
    if (sent.ok) {
      setAmount("");
      setReference("");
      setMessage({ tone: "ok", text: t("fees.voucher.sent") });
      onSent();
    } else setMessage({ tone: "bad", text: sentMessage(sent)! });
  }

  return (
    <section aria-labelledby="voucher-heading" className={styles.card}>
      <h2 id="voucher-heading" className={setupStyles.subhead}>
        {t("fees.voucher.title")}
      </h2>
      <p className={setupStyles.muted}>{t("fees.voucher.intro")}</p>
      <Field label={t("fees.amount")} hint={t("fees.amountHint")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Field label={t("fees.voucher.bank")} value={bank} maxLength={80} onChange={(event) => setBank(event.target.value)} />
      <Field label={t("fees.voucher.reference")} value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} />
      <BsDateField legend={t("fees.voucher.paidOn")} value={paidBs} onChange={setPaidBs} />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} variant="secondary" onClick={() => void send()} loading={busy} loadingLabel={t("fees.saving")} disabled={!amount.trim() || !bank.trim() || !reference.trim() || !paidBs.trim()}>
          {t("fees.voucher.send")}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}
