"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Field, Notice, Select } from "@/ui";

import { addFeeItem, gateFailure, generateCharges, loadStructure, removeFeeItem, sendStructure, type Sent } from "./client";
import styles from "./fees.module.css";
import { FREQUENCY_LABEL, STATUS_LABEL, type FeeStructure, type Frequency } from "./model";
import { formatNpr, parseNpr } from "./money";
import { sentMessage } from "./OwnFees";

/** One fee structure (`?id=`): its items; a draft's lines added and removed, sent for approval; a live one's charges made per class. */
export function StructureScreen() {
  const { api, me } = useSession();
  const accountant = me?.roles.some((r) => r.role === "accountant") ?? false;
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const loadNow = useCallback(async () => {
    if (!id) return gateFailure("failed");
    const result = await loadStructure(api, id);
    return result.ok ? result : gateFailure(result.reason);
  }, [api, id]);
  const { view, reload } = useLoad<FeeStructure>(loadNow);

  async function act(action: () => Promise<Sent>, ok: (sent: Sent & { ok: true }) => string) {
    const sent = await action();
    setMessage(sent.ok ? { tone: "ok", text: ok(sent) } : { tone: "bad", text: sentMessage(sent)! });
    void reload();
  }

  return (
    <>
      <p>
        <Link href="/portal/fees/structures">{t("fees.structure.back")}</Link>
      </p>
      <Gate view={view} onRetry={() => void reload()}>
        {(s) => (
          <>
            <div>
              <h1 className={setupStyles.title}>
                {s.programmeName} · {s.levelName}
              </h1>
              <div className={setupStyles.badges}>
                <Badge tone={s.status === "live" ? "ok" : "neutral"}>{t(STATUS_LABEL[s.status])}</Badge>
                <span>{s.yearLabel}</span>
                <span>{t("fees.structures.yearly", { amount: formatNpr(s.yearlyTotalPaisa) })}</span>
              </div>
            </div>
            {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
            {s.status === "live" ? <Notice>{t("fees.structure.fixed")}</Notice> : null}
            {s.status === "waiting" ? <Notice>{t("fees.structure.waiting")}</Notice> : null}
            <section aria-labelledby="items-heading" className={styles.card}>
              <h2 id="items-heading" className={setupStyles.subhead}>
                {t("fees.structure.items")}
              </h2>
              {s.items.length === 0 ? (
                <p className={setupStyles.empty}>{t("fees.structure.noItems")}</p>
              ) : (
                <ul className={styles.list}>
                  {s.items.map((item) => (
                    <li key={item.id} className={styles.row}>
                      <span>
                        {item.name}
                        <br />
                        <span className={styles.meta}>{t(FREQUENCY_LABEL[item.frequency])}</span>
                      </span>
                      <span className={styles.amount}>
                        {t("fees.npr", { amount: formatNpr(item.amountPaisa) })}
                        {accountant && s.status === "draft" ? (
                          <Button className={styles.wrapLabel} variant="quiet" onClick={() => void act(() => removeFeeItem(api, item.id), () => t("fees.structure.remove"))}>
                            {t("fees.structure.remove")}
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {accountant && s.status === "draft" ? <AddItem structureId={s.id} onDone={(sent) => act(async () => sent, () => t("fees.structure.add"))} /> : null}
              {accountant && s.status === "draft" && s.items.length > 0 ? (
                <div className={styles.actions}>
                  <Button className={styles.wrapLabel} onClick={() => void act(() => sendStructure(api, s.id), () => t("fees.structure.sent"))}>
                    {t("fees.structure.send")}
                  </Button>
                </div>
              ) : null}
            </section>
            {accountant && s.status === "live" ? (
              <section aria-labelledby="charges-heading" className={styles.card}>
                <h2 id="charges-heading" className={setupStyles.subhead}>
                  {t("fees.structure.charges")}
                </h2>
                <p className={setupStyles.muted}>{t("fees.structure.chargesIntro")}</p>
                <ul className={styles.list}>
                  {s.classes.map((c) => (
                    <li key={c.id} className={styles.row}>
                      <span>{t("fees.structure.classStudents", { label: c.label || t("fees.structure.noLabel"), count: c.students })}</span>
                      <Button
                        className={styles.wrapLabel}
                        variant="secondary"
                        onClick={() => void act(() => generateCharges(api, s.id, c.id), (sent) => t("fees.structure.made", { count: (sent.data as { created: number }).created }))}
                      >
                        {t("fees.structure.make")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </Gate>
    </>
  );
}

function AddItem({ structureId, onDone }: { structureId: string; onDone: (sent: Sent) => Promise<void> }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [error, setError] = useState<string | null>(null);
  async function add() {
    const paisa = parseNpr(amount);
    if (paisa === null) return setError(t("fees.badAmount"));
    setError(null);
    const sent = await addFeeItem(api, structureId, { name: name.trim(), amountPaisa: paisa, frequency });
    if (sent.ok) {
      setName("");
      setAmount("");
    }
    await onDone(sent);
  }
  return (
    <div className={styles.card}>
      <Field label={t("fees.structure.itemName")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      <Field label={t("fees.amount")} hint={t("fees.amountHint")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} error={error ?? undefined} />
      <Select
        label={t("fees.structure.frequency")}
        options={(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => ({ value: f, label: t(FREQUENCY_LABEL[f]) }))}
        value={frequency}
        onChange={(event) => setFrequency(event.target.value as Frequency)}
      />
      <div className={styles.actions}>
        <Button className={styles.wrapLabel} variant="secondary" onClick={() => void add()} disabled={!name.trim() || !amount.trim()}>
          {t("fees.structure.add")}
        </Button>
      </div>
    </div>
  );
}
