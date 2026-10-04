"use client";

import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { SidePanel } from "@/read/SidePanel";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import { AccountView } from "./AccountView";
import { gateFailure, loadAdjustments, loadStudentAccount, proposeDiscount, recordCash, recordRefund, requestRefund, requestReversal, type Sent } from "./client";
import styles from "./fees.module.css";
import { ADJUSTMENT_KIND, ADJUSTMENT_STATUS, REASON_LABEL, newIdempotencyKey, type Account, type AdjustmentList } from "./model";
import { formatNpr, parseNpr } from "./money";
import { nprShort } from "./ReadFees";
import { sentMessage } from "./OwnFees";

type Message = { tone: "ok" | "bad"; text: string } | null;
type Entry = Account["entries"][number];

/** One student's fees for staff (`?id=` the student): the account, and for the Accountant, the counter's actions. */
export function StaffAccountScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const accountant = me?.roles.some((r) => r.role === "accountant") ?? false;
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const account = await loadStudentAccount(api, id);
    if (!account.ok) return gateFailure(account.reason);
    const adjustments = await loadAdjustments(api, account.data.enrollmentId);
    if (!adjustments.ok) return gateFailure(adjustments.reason);
    return { ok: true as const, data: { account: account.data, adjustments: adjustments.data } };
  }, [api, id]);
  const { view, reload } = useLoad<{ account: Account; adjustments: AdjustmentList }>(loadNow);
  const [done, setDone] = useState<string | null>(null);
  const [reversing, setReversing] = useState<Entry | null>(null);
  const finished = (text: string) => {
    setDone(text);
    void reload();
  };

  if (view.status === "loading") return <TableSkeleton rows={6} tiles={4} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const { account, adjustments } = view.data;
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={account.studentName}
        subtitle={[account.sid, account.className, account.yearLabel].join(" · ")}
        crumbs={[{ label: t("fees.title"), href: "/portal/fees" }, { label: account.studentName }]}
        actions={
          accountant ? (
            <div className={styles.headerActions}>
              <AddDialog label={t("fees.discount.title")} title={t("fees.discount.title")} variant="secondary" plus={false}>
                {(close) => <DiscountForm account={account} onDone={(text) => (close(), finished(text))} />}
              </AddDialog>
              {account.creditPaisa > 0 ? (
                <AddDialog label={t("fees.refund.title")} title={t("fees.refund.title")} variant="secondary" plus={false}>
                  {(close) => <RefundForm account={account} onDone={(text) => (close(), finished(text))} />}
                </AddDialog>
              ) : null}
              <AddDialog label={t("fees.cash.save")} title={t("fees.cash.title")}>
                {(close) => <CashForm account={account} onDone={(text) => (close(), finished(text))} />}
              </AddDialog>
            </div>
          ) : null
        }
      />
      {done ? <Notice tone="ok">{done}</Notice> : null}
      <AccountView
        account={account}
        entryAction={
          accountant
            ? (entry) =>
                entry.kind === "payment" && !entry.reversed ? (
                  <Button className={styles.wrapLabel} variant="quiet" onClick={() => setReversing(entry)} aria-label={t("fees.reversal.askFor", { amount: nprShort(Math.abs(entry.amountPaisa)) })}>
                    {t("fees.reversal.ask")}
                  </Button>
                ) : null
            : undefined
        }
      />
      <Adjustments adjustments={adjustments} accountant={accountant} onDone={finished} />
      {accountant ? null : <ReadOnlyNote>{t("fees.account.readOnly", { accountant: term("role.accountant") })}</ReadOnlyNote>}
      {reversing ? (
        <ReversePanel
          payment={reversing}
          onClose={() => setReversing(null)}
          onDone={(text) => {
            setReversing(null);
            finished(text);
          }}
        />
      ) : null}
    </div>
  );
}

/** Sends one action; on success the screen says what happened and closes the form, on failure the form says why. */
function useSend(onDone: (text: string) => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  async function run(action: () => Promise<Sent>, ok: (sent: Sent & { ok: true }) => string): Promise<boolean> {
    setBusy(true);
    const sent = await action();
    setBusy(false);
    if (sent.ok) {
      onDone(ok(sent));
      return true;
    }
    setMessage({ tone: "bad", text: sentMessage(sent)! });
    return false;
  }
  return { busy, message, setMessage, run };
}

function CashForm({ account, onDone }: { account: Account; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [amount, setAmount] = useState("");
  // One key per payment being entered: a retry of the same Save records it once. A new key after it lands.
  const [key, setKey] = useState(newIdempotencyKey);
  const { busy, message, setMessage, run } = useSend(onDone);
  async function save() {
    const paisa = parseNpr(amount);
    if (paisa === null) return setMessage({ tone: "bad", text: t("fees.badAmount") });
    const done = await run(
      () => recordCash(api, { enrollmentId: account.enrollmentId, amountPaisa: paisa, idempotencyKey: key }),
      (sent) => t("fees.cash.done", { number: (sent.data as { receipt: { number: string } }).receipt.number }),
    );
    if (done) setKey(newIdempotencyKey());
  }
  return (
    <div className={styles.form}>
      <p className={styles.meta}>{t("fees.cash.for", { name: account.studentName, due: nprShort(account.duePaisa) })}</p>
      <Field label={t("fees.amount")} hint={t("fees.amountHint")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void save()} loading={busy} loadingLabel={t("fees.saving")} disabled={!amount.trim() || busy}>
        {t("fees.cash.save")}
      </Button>
    </div>
  );
}

/** Asking to reverse a payment, in a side panel: the payment, a reason, one button. An Admin approves every reversal. */
function ReversePanel({ payment, onClose, onDone }: { payment: Entry; onClose: () => void; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const { busy, message, run } = useSend(onDone);
  return (
    <SidePanel
      title={t("fees.reversal.title")}
      subtitle={[nprShort(Math.abs(payment.amountPaisa)), payment.memo, payment.createdOnBs ? formatBsDate(payment.createdOnBs) : null].filter(Boolean).join(" · ")}
      busy={busy}
      onClose={onClose}
      foot={
        <Button fullWidth onClick={() => void run(() => requestReversal(api, payment.id, reason.trim()), () => t("fees.reversal.sent"))} loading={busy} loadingLabel={t("fees.saving")} disabled={!reason.trim() || busy}>
          {t("fees.reversal.send")}
        </Button>
      }
    >
      <div className={styles.form}>
        <p className={styles.meta}>{t("fees.reversal.intro")}</p>
        <Field label={t("fees.reversal.reason")} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </div>
    </SidePanel>
  );
}

function DiscountForm({ account, onDone }: { account: Account; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [by, setBy] = useState<"amount" | "percent">("amount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<"scholarship" | "sibling" | "staff_child" | "other">("scholarship");
  const [note, setNote] = useState("");
  const { busy, message, setMessage, run } = useSend(onDone);
  async function send() {
    let body: { amountPaisa?: number; percent?: number } = {};
    if (by === "amount") {
      const paisa = parseNpr(value);
      if (paisa === null) return setMessage({ tone: "bad", text: t("fees.badAmount") });
      body = { amountPaisa: paisa };
    } else {
      const percent = Number.parseInt(value, 10);
      if (!Number.isInteger(percent) || percent < 1 || percent > 100 || String(percent) !== value.trim()) return setMessage({ tone: "bad", text: t("fees.refused") });
      body = { percent };
    }
    await run(() => proposeDiscount(api, account.enrollmentId, { ...body, reason, ...(note.trim() ? { note: note.trim() } : {}) }), () => t("fees.discount.sent"));
  }
  return (
    <div className={styles.form}>
      <p className={styles.meta}>{t("fees.discount.intro")}</p>
      <Select
        label={t("fees.discount.by")}
        options={[
          { value: "amount", label: t("fees.discount.byAmount") },
          { value: "percent", label: t("fees.discount.byPercent") },
        ]}
        value={by}
        onChange={(event) => setBy(event.target.value as "amount" | "percent")}
      />
      <Field label={by === "amount" ? t("fees.amount") : t("fees.discount.percent")} inputMode={by === "amount" ? "decimal" : "numeric"} value={value} onChange={(event) => setValue(event.target.value)} />
      <Select
        label={t("fees.discount.reason")}
        options={(Object.keys(REASON_LABEL) as (keyof typeof REASON_LABEL)[]).map((r) => ({ value: r, label: t(REASON_LABEL[r]) }))}
        value={reason}
        onChange={(event) => setReason(event.target.value as typeof reason)}
      />
      <Field label={t("fees.discount.note")} hint={t("fees.discount.noteHint")} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void send()} loading={busy} loadingLabel={t("fees.saving")} disabled={!value.trim() || busy}>
        {t("fees.discount.send")}
      </Button>
    </div>
  );
}

function RefundForm({ account, onDone }: { account: Account; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const { busy, message, setMessage, run } = useSend(onDone);
  async function send() {
    const paisa = parseNpr(amount);
    if (paisa === null) return setMessage({ tone: "bad", text: t("fees.badAmount") });
    await run(() => requestRefund(api, account.enrollmentId, { amountPaisa: paisa, reason: reason.trim() }), () => t("fees.refund.sent"));
  }
  return (
    <div className={styles.form}>
      <p className={styles.meta}>{t("fees.refund.intro")}</p>
      <Field label={t("fees.amount")} hint={t("fees.npr", { amount: formatNpr(account.creditPaisa) })} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Field label={t("fees.refund.reason")} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void send()} loading={busy} loadingLabel={t("fees.saving")} disabled={!amount.trim() || !reason.trim() || busy}>
        {t("fees.refund.send")}
      </Button>
    </div>
  );
}

/** Discounts, reversals and refunds asked for this year, each with where it stands in words. Pure but for the refund's own form. */
function Adjustments({ adjustments, accountant, onDone }: { adjustments: AdjustmentList; accountant: boolean; onDone: (text: string) => void }) {
  if (adjustments.adjustments.length === 0) return null;
  return (
    <Panel title={t("fees.adjustments.title")} labelledBy="adjustments-heading">
      <ul className={readStyles.rows}>
        {adjustments.adjustments.map((a) => (
          <li key={a.id} className={readStyles.rowItem}>
            <div className={readStyles.rowHead}>
              <h3 className={readStyles.rowTitle}>
                {t(ADJUSTMENT_KIND[a.kind])} · {nprShort(a.amountPaisa)}
              </h3>
              <StatusWord tone={a.status === "closed" ? "bad" : a.status === "pending" ? "warn" : "ok"}>{t(ADJUSTMENT_STATUS[a.status])}</StatusWord>
            </div>
            {a.reason || a.note ? <p className={readStyles.rowMeta}>{[a.reason ? t(REASON_LABEL[a.reason as keyof typeof REASON_LABEL]) : null, a.note].filter(Boolean).join(" · ")}</p> : null}
            {accountant && a.kind === "refund" && a.status === "approved" ? (
              <div className={styles.rowActions}>
                <AddDialog label={t("fees.refund.record")} title={t("fees.refund.record")} variant="secondary" plus={false}>
                  {(close) => <RecordRefund adjustmentId={a.id} onDone={(text) => (close(), onDone(text))} />}
                </AddDialog>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RecordRefund({ adjustmentId, onDone }: { adjustmentId: string; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque">("cash");
  const [reference, setReference] = useState("");
  const { busy, message, run } = useSend(onDone);
  return (
    <div className={styles.form}>
      <Select
        label={t("fees.refund.method")}
        options={[
          { value: "cash", label: t("fees.refund.cash") },
          { value: "bank_transfer", label: t("fees.refund.bank") },
          { value: "cheque", label: t("fees.refund.cheque") },
        ]}
        value={method}
        onChange={(event) => setMethod(event.target.value as typeof method)}
      />
      <Field label={t("fees.refund.reference")} value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void run(() => recordRefund(api, adjustmentId, { method, ...(reference.trim() ? { reference: reference.trim() } : {}) }), () => t("fees.adjustment.recorded"))} loading={busy} loadingLabel={t("fees.saving")} disabled={busy}>
        {t("fees.refund.record")}
      </Button>
    </div>
  );
}
