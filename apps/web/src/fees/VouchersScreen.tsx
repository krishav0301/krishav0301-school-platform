"use client";

import { Landmark, Receipt } from "lucide-react";
import { useCallback, useState } from "react";

import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { Facts, SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Field, Notice } from "@/ui";

import { gateFailure, loadVouchers, rejectVoucher, verifyVoucher } from "./client";
import styles from "./fees.module.css";
import type { VoucherList } from "./model";
import { sentMessage } from "./OwnFees";
import { nprShort } from "./ReadFees";

type Voucher = VoucherList["vouchers"][number];
const paidDay = (v: Voucher) => (v.paidOnBs ? formatBsDate(v.paidOnBs) : v.paidOn);

export function voucherFigures(list: VoucherList): Figure[] {
  return [
    { key: "waiting", icon: Receipt, tone: list.vouchers.length > 0 ? "warn" : "ok", value: String(list.vouchers.length), label: t("home.accountant.figure.vouchers") },
    { key: "amount", icon: Landmark, tone: "accent", value: nprShort(list.vouchers.reduce((n, v) => n + v.amountPaisa, 0)), label: t("fees.vouchers.figure.amount") },
  ];
}

/** The deposits waiting, oldest first, each opening in a side panel to check. Pure. */
export function VoucherRows({ vouchers, onOpen }: { vouchers: readonly Voucher[]; onOpen?: (v: Voucher) => void }) {
  if (vouchers.length === 0) return <EmptyLine>{t("fees.vouchers.empty")}</EmptyLine>;
  return (
    <ul className={readStyles.rows}>
      {vouchers.map((v) => (
        <li key={v.id} className={readStyles.rowItem}>
          <div className={readStyles.rowHead}>
            <h3 className={readStyles.rowTitle}>{v.studentName}</h3>
            <span className={styles.amount}>{nprShort(v.amountPaisa)}</span>
          </div>
          <div className={readStyles.rowHead}>
            <p className={readStyles.rowMeta}>{[v.sid, v.bank, v.reference, paidDay(v)].join(" · ")}</p>
            {onOpen ? (
              <Button variant="quiet" className={`${styles.wrapLabel} ${styles.rowButton}`} onClick={() => onOpen(v)} aria-label={t("fees.vouchers.checkNamed", { name: v.studentName })}>
                {t("home.accountant.check")}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Bank deposits students reported (redesigned in D-107), oldest first, each verified into a receipt or rejected with a reason. */
export function VouchersScreen() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadVouchers(api);
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<VoucherList>(loadNow);
  const [open, setOpen] = useState<Voucher | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const list = view.status === "ready" ? view.data : null;
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("fees.vouchers.title")} subtitle={t("fees.vouchers.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={2} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {done ? <Notice tone="ok">{done}</Notice> : null}
      {list ? (
        <>
          <FigureTiles figures={voucherFigures(list)} label={t("fees.vouchers.figures")} />
          <Panel title={t("fees.vouchers.waiting")} labelledBy="vouchers-waiting">
            <VoucherRows
              vouchers={list.vouchers}
              onOpen={(v) => {
                setDone(null);
                setOpen(v);
              }}
            />
          </Panel>
        </>
      ) : null}
      {open ? (
        <VoucherPanel
          voucher={open}
          onClose={() => setOpen(null)}
          onDone={(text) => {
            setOpen(null);
            setDone(text);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** One deposit, checked in a side panel against the bank: Verify makes the receipt; Reject needs a reason the student reads. */
function VoucherPanel({ voucher, onClose, onDone }: { voucher: Voucher; onClose: () => void; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function verify() {
    setBusy(true);
    const sent = await verifyVoucher(api, voucher.id);
    setBusy(false);
    if (sent.ok) onDone(t("fees.vouchers.verified", { number: (sent.data as { receipt: { number: string } }).receipt.number }));
    else setError(sentMessage(sent));
  }
  async function reject() {
    setBusy(true);
    const sent = await rejectVoucher(api, voucher.id, reason.trim());
    setBusy(false);
    if (sent.ok) onDone(t("fees.vouchers.rejected", { name: voucher.studentName }));
    else setError(sentMessage(sent));
  }
  return (
    <SidePanel
      title={voucher.studentName}
      subtitle={voucher.sid}
      status={<StatusWord tone="warn">{t("fees.vouchers.toCheck")}</StatusWord>}
      busy={busy}
      onClose={onClose}
      foot={
        rejecting ? (
          <Button fullWidth onClick={() => void reject()} loading={busy} loadingLabel={t("fees.saving")} disabled={!reason.trim() || busy}>
            {t("fees.vouchers.reject")}
          </Button>
        ) : (
          <div className={styles.rowActions}>
            <Button className={styles.wrapLabel} variant="quiet" onClick={() => setRejecting(true)} disabled={busy}>
              {t("fees.vouchers.reject")}
            </Button>
            <Button className={styles.wrapLabel} onClick={() => void verify()} loading={busy} loadingLabel={t("fees.saving")}>
              {t("fees.vouchers.verify")}
            </Button>
          </div>
        )
      }
    >
      <div className={styles.form}>
        <Facts
          rows={[
            { name: t("fees.col.amount"), value: nprShort(voucher.amountPaisa) },
            { name: t("fees.voucher.bank"), value: voucher.bank },
            { name: t("fees.voucher.reference"), value: voucher.reference },
            { name: t("fees.voucher.paidOn"), value: paidDay(voucher) },
          ]}
        />
        <p className={styles.meta}>{t("fees.vouchers.checkIntro")}</p>
        {rejecting ? <Field label={t("fees.vouchers.rejectReason")} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} /> : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </SidePanel>
  );
}
