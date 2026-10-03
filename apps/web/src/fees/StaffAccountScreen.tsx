"use client";

import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Panel, ReadFailure, ReadHeader, ReadOnlyNote, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";
import { Button, Field, Notice, Select } from "@/ui";

import { AccountView } from "./AccountView";
import { gateFailure, loadAdjustments, loadStudentAccount, proposeDiscount, recordCash, recordRefund, requestRefund, requestReversal, type Sent } from "./client";
import styles from "./fees.module.css";
import { ADJUSTMENT_KIND, ADJUSTMENT_STATUS, REASON_LABEL, newIdempotencyKey, type Account, type AdjustmentList } from "./model";
import { formatNpr, parseNpr } from "./money";
import { nprShort } from "./ReadFees";
import { sentMessage } from "./OwnFees";

type Message = { tone: "ok" | "bad"; text: string } | null;

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
  const refresh = () => void reload();

  if (view.status === "loading") return <TableSkeleton rows={6} tiles={4} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={refresh} />;
  const { account, adjustments } = view.data;
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={account.studentName}
        subtitle={[account.sid, account.className, account.yearLabel].join(" · ")}
        crumbs={[{ label: t("fees.title"), href: "/portal/fees" }, { label: account.studentName }]}
      />
      {accountant ? <CashForm account={account} onDone={refresh} /> : null}
      <AccountView account={account} entryAction={accountant ? (entry) => (entry.kind === "payment" && !entry.reversed ? <ReverseButton paymentId={entry.id} onDone={refresh} /> : null) : undefined} />
      <Adjustments adjustments={adjustments} accountant={accountant} onDone={refresh} />
      {accountant ? <DiscountForm account={account} onDone={refresh} /> : null}
      {accountant && account.creditPaisa > 0 ? <RefundForm account={account} onDone={refresh} /> : null}
      {accountant ? null : <ReadOnlyNote>{t("fees.account.readOnly", { accountant: term("role.accountant") })}</ReadOnlyNote>}
    </div>
  );
}

function useSend(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  async function run(action: () => Promise<Sent>, ok: (sent: Sent & { ok: true }) => string): Promise<boolean> {
    setBusy(true);
    const sent = await action();
    setBusy(false);
    if (sent.ok) {
      setMessage({ tone: "ok", text: ok(sent) });
      onDone();
      return true;
    }
    setMessage({ tone: "bad", text: sentMessage(sent)! });
    return false;
  }
  return { busy, message, setMessage, run };
}

function CashForm({ account, onDone }: { account: Account; onDone: () => void }) {
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
    if (done) {
      setAmount("");
      setKey(newIdempotencyKey());
    }
  }
  return (
    <section aria-labelledby="cash-heading" className={styles.card}>
      <h2 id="cash-heading" className={setupStyles.subhead}>
        {t("fees.cash.title")}
      </h2>
      <Field label={t("fees.amount")} hint={t("fees.amountHint")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} onClick={() => void save()} loading={busy} loadingLabel={t("fees.saving")} disabled={!amount.trim()}>
          {t("fees.cash.save")}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}

function ReverseButton({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, message, run } = useSend(onDone);
  if (!open)
    return (
      <Button className={styles.wrapLabel} variant="quiet" onClick={() => setOpen(true)}>
        {t("fees.reversal.ask")}
      </Button>
    );
  return (
    <span className={styles.card}>
      <Field label={t("fees.reversal.reason")} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      <Button className={styles.wrapLabel} variant="secondary" onClick={() => void run(() => requestReversal(api, paymentId, reason.trim()), () => t("fees.reversal.sent"))} loading={busy} loadingLabel={t("fees.saving")} disabled={!reason.trim()}>
        {t("fees.reversal.send")}
      </Button>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </span>
  );
}

function DiscountForm({ account, onDone }: { account: Account; onDone: () => void }) {
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
    const done = await run(() => proposeDiscount(api, account.enrollmentId, { ...body, reason, ...(note.trim() ? { note: note.trim() } : {}) }), () => t("fees.discount.sent"));
    if (done) {
      setValue("");
      setNote("");
    }
  }
  return (
    <section aria-labelledby="discount-heading" className={styles.card}>
      <h2 id="discount-heading" className={setupStyles.subhead}>
        {t("fees.discount.title")}
      </h2>
      <p className={setupStyles.muted}>{t("fees.discount.intro")}</p>
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
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} variant="secondary" onClick={() => void send()} loading={busy} loadingLabel={t("fees.saving")} disabled={!value.trim()}>
          {t("fees.discount.send")}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}

function RefundForm({ account, onDone }: { account: Account; onDone: () => void }) {
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
    <section aria-labelledby="refund-heading" className={styles.card}>
      <h2 id="refund-heading" className={setupStyles.subhead}>
        {t("fees.refund.title")}
      </h2>
      <p className={setupStyles.muted}>{t("fees.refund.intro")}</p>
      <Field label={t("fees.amount")} hint={t("fees.npr", { amount: formatNpr(account.creditPaisa) })} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Field label={t("fees.refund.reason")} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} variant="secondary" onClick={() => void send()} loading={busy} loadingLabel={t("fees.saving")} disabled={!amount.trim() || !reason.trim()}>
          {t("fees.refund.send")}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}

function Adjustments({ adjustments, accountant, onDone }: { adjustments: AdjustmentList; accountant: boolean; onDone: () => void }) {
  if (adjustments.adjustments.length === 0) return null;
  return (
    <Panel title={t("fees.adjustments.title")} labelledBy="adjustments-heading">
      <ul className={styles.list}>
        {adjustments.adjustments.map((a) => (
          <li key={a.id} className={styles.row}>
            <span className={styles.eventText}>
              <span className={styles.eventTitle}>
                {t(ADJUSTMENT_KIND[a.kind])} · {nprShort(a.amountPaisa)}
              </span>
              <span className={styles.meta}>{[a.reason ? t(REASON_LABEL[a.reason as keyof typeof REASON_LABEL]) : null, a.note].filter(Boolean).join(" · ")}</span>
            </span>
            <span className={styles.amount}>
              <StatusWord tone={a.status === "closed" ? "bad" : a.status === "pending" ? "warn" : "ok"}>{t(ADJUSTMENT_STATUS[a.status])}</StatusWord>
              {accountant && a.kind === "refund" && a.status === "approved" ? <RecordRefund adjustmentId={a.id} onDone={onDone} /> : null}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RecordRefund({ adjustmentId, onDone }: { adjustmentId: string; onDone: () => void }) {
  const { api } = useSession();
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque">("cash");
  const [reference, setReference] = useState("");
  const { busy, message, run } = useSend(onDone);
  return (
    <span className={styles.card}>
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
      <Button className={styles.wrapLabel} variant="secondary" onClick={() => void run(() => recordRefund(api, adjustmentId, { method, ...(reference.trim() ? { reference: reference.trim() } : {}) }), () => t("fees.adjustment.recorded"))} loading={busy} loadingLabel={t("fees.saving")}>
        {t("fees.refund.record")}
      </Button>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </span>
  );
}
