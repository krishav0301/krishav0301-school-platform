"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button, Field, Notice } from "@/ui";

import { gateFailure, loadVouchers, rejectVoucher, verifyVoucher } from "./client";
import styles from "./fees.module.css";
import type { VoucherList } from "./model";
import { formatNpr } from "./money";
import { sentMessage } from "./OwnFees";

/** Bank deposits students reported, oldest first, for the Accountant to verify into a receipt or reject with a reason. */
export function VouchersScreen() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadVouchers(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<VoucherList>(loadNow);
  return (
    <>
      <h1 className={setupStyles.title}>{t("fees.vouchers.title")}</h1>
      <Gate view={view} onRetry={() => void reload()}>
        {(list) =>
          list.vouchers.length === 0 ? (
            <p className={setupStyles.empty}>{t("fees.vouchers.empty")}</p>
          ) : (
            <ul className={setupStyles.list}>
              {list.vouchers.map((v) => (
                <VoucherRow key={v.id} voucher={v} onDone={() => void reload()} />
              ))}
            </ul>
          )
        }
      </Gate>
    </>
  );
}

function VoucherRow({ voucher, onDone }: { voucher: VoucherList["vouchers"][number]; onDone: () => void }) {
  const { api } = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  async function verify() {
    setBusy(true);
    const sent = await verifyVoucher(api, voucher.id);
    setBusy(false);
    if (sent.ok) {
      setMessage({ tone: "ok", text: t("fees.vouchers.verified", { number: (sent.data as { receipt: { number: string } }).receipt.number }) });
      onDone();
    } else setMessage({ tone: "bad", text: sentMessage(sent)! });
  }
  async function reject() {
    setBusy(true);
    const sent = await rejectVoucher(api, voucher.id, reason.trim());
    setBusy(false);
    if (sent.ok) onDone();
    else setMessage({ tone: "bad", text: sentMessage(sent)! });
  }
  return (
    <li className={setupStyles.item}>
      <h2 className={setupStyles.itemTitle}>{voucher.studentName}</h2>
      <p className={styles.meta}>
        {voucher.sid} · {t("fees.vouchers.detail", { bank: voucher.bank, reference: voucher.reference, date: voucher.paidOnBs ?? voucher.paidOn })}
      </p>
      <p className={styles.amount}>{t("fees.npr", { amount: formatNpr(voucher.amountPaisa) })}</p>
      {rejecting ? (
        <>
          <Field label={t("fees.vouchers.rejectReason")} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          <div className={styles.actions}>
            <Button className={styles.wrapLabel} variant="secondary" onClick={() => void reject()} loading={busy} loadingLabel={t("fees.saving")} disabled={!reason.trim()}>
              {t("fees.vouchers.reject")}
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <Button className={styles.wrapLabel} variant="secondary" onClick={() => void verify()} loading={busy} loadingLabel={t("fees.saving")}>
            {t("fees.vouchers.verify")}
          </Button>
          <Button className={styles.wrapLabel} variant="quiet" onClick={() => setRejecting(true)}>
            {t("fees.vouchers.reject")}
          </Button>
        </div>
      )}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </li>
  );
}
