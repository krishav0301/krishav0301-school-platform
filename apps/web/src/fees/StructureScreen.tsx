"use client";

import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { EmptyLine, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, TableSkeleton, readStyles } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import { addFeeItem, gateFailure, generateCharges, loadStructure, removeFeeItem, sendStructure, type Sent } from "./client";
import styles from "./fees.module.css";
import { FREQUENCY_LABEL, type FeeStructure, type Frequency } from "./model";
import { formatNprShort, parseNpr } from "./money";
import { nprShort } from "./ReadFees";
import { StructureStatus } from "./StructuresScreen";
import { sentMessage } from "./OwnFees";

/** One fee structure (`?id=`): its items; a draft's lines added and removed, sent for approval; a live one's charges made per class. */
export function StructureScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
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

  if (view.status === "loading") return <TableSkeleton rows={5} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const s = view.data;
  const name = `${s.programmeName} · ${s.levelName}`;
  const draft = accountant && s.status === "draft";
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={name}
        subtitle={t("fees.structure.subtitle", { year: s.yearLabel, total: formatNprShort(s.yearlyTotalPaisa) })}
        crumbs={[{ label: t("fees.structures.title"), href: "/portal/fees/structures" }, { label: name }]}
        actions={
          <div className={styles.headerActions}>
            <StructureStatus status={s.status} />
            {draft ? (
              <AddDialog label={t("fees.structure.add")} title={t("fees.structure.add")} variant={s.items.length > 0 ? "secondary" : "primary"}>
                {(close) => (
                  <AddItem
                    structureId={s.id}
                    onAdded={(itemName) => {
                      close();
                      setMessage({ tone: "ok", text: t("fees.structure.added", { name: itemName }) });
                      void reload();
                    }}
                  />
                )}
              </AddDialog>
            ) : null}
            {draft && s.items.length > 0 ? (
              <Button className={styles.wrapLabel} onClick={() => void act(() => sendStructure(api, s.id), () => t("fees.structure.sent"))}>
                {t("fees.structure.send")}
              </Button>
            ) : null}
          </div>
        }
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {accountant && s.status === "live" ? <ReadOnlyNote>{t("fees.structure.fixed")}</ReadOnlyNote> : null}
      {accountant && s.status === "waiting" ? <ReadOnlyNote>{t("fees.structure.waiting")}</ReadOnlyNote> : null}
      <Panel title={t("fees.structure.items")} labelledBy="items-heading">
        <ItemsTable structure={s} onRemove={draft ? (itemId) => void act(() => removeFeeItem(api, itemId), () => t("fees.structure.removed")) : undefined} />
      </Panel>
      {accountant && s.status === "live" ? (
        <Panel title={t("fees.structure.charges")} labelledBy="charges-heading">
          <p className={readStyles.rowMeta}>{t("fees.structure.chargesIntro")}</p>
          {s.classes.length === 0 ? (
            <EmptyLine>{t("fees.structure.noClasses")}</EmptyLine>
          ) : (
            <ul className={readStyles.rows}>
              {s.classes.map((c) => (
                <li key={c.id} className={readStyles.rowItem}>
                  <div className={readStyles.rowHead}>
                    <h3 className={readStyles.rowTitle}>{c.label ? `${name} · ${c.label}` : name}</h3>
                    <Button
                      className={`${styles.wrapLabel} ${styles.rowButton}`}
                      variant="quiet"
                      aria-label={t("fees.structure.makeFor", { name: c.label ? `${name} · ${c.label}` : name })}
                      onClick={() => void act(() => generateCharges(api, s.id, c.id), (sent) => t("fees.structure.made", { count: (sent.data as { created: number }).created }))}
                    >
                      {t("fees.structure.make")}
                    </Button>
                  </div>
                  <p className={readStyles.rowMeta}>{t("fees.structure.students", { count: c.students })}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      {accountant ? null : <ReadOnlyNote>{t("fees.structures.readOnly", { accountant: term("role.accountant") })}</ReadOnlyNote>}
    </div>
  );
}

/** The items, as on the Approvals review panel: item, how often it is billed, amount; then the yearly total. Pure. */
export function ItemsTable({ structure, onRemove }: { structure: FeeStructure; onRemove?: (itemId: string) => void }) {
  if (structure.items.length === 0) return <EmptyLine>{t("fees.structure.noItems")}</EmptyLine>;
  return (
    <>
      <ReadTable
        caption={t("fees.structure.items")}
        rows={structure.items}
        rowKey={(item) => item.id}
        columns={[
          { key: "name", label: t("fees.structure.itemName"), primary: true, cell: (item) => item.name },
          { key: "frequency", label: t("fees.structure.frequency"), cell: (item) => t(FREQUENCY_LABEL[item.frequency]) },
          { key: "amount", label: t("fees.col.amount"), align: "end", cell: (item) => nprShort(item.amountPaisa) },
          ...(onRemove
            ? [
                {
                  key: "remove",
                  label: t("fees.structure.remove"),
                  align: "end" as const,
                  plain: true,
                  cell: (item: FeeStructure["items"][number]) => (
                    <Button className={styles.wrapLabel} variant="quiet" onClick={() => onRemove(item.id)} aria-label={t("fees.structure.removeNamed", { name: item.name })}>
                      {t("fees.structure.remove")}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <p className={styles.total}>
        <span>{t("fees.structure.yearlyTotal")}</span>
        <span className={styles.amount}>{nprShort(structure.yearlyTotalPaisa)}</span>
      </p>
    </>
  );
}

/** One line added to a draft, in a pop-up: name, amount, how often it is billed. */
function AddItem({ structureId, onAdded }: { structureId: string; onAdded: (name: string) => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function add() {
    const paisa = parseNpr(amount);
    if (paisa === null) return setError(t("fees.badAmount"));
    setError(null);
    setBusy(true);
    const sent = await addFeeItem(api, structureId, { name: name.trim(), amountPaisa: paisa, frequency });
    setBusy(false);
    if (sent.ok) onAdded(name.trim());
    else setError(sentMessage(sent));
  }
  return (
    <div className={styles.form}>
      <Field label={t("fees.structure.itemName")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      <Field label={t("fees.amount")} hint={t("fees.amountHint")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <Select
        label={t("fees.structure.frequency")}
        options={(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => ({ value: f, label: t(FREQUENCY_LABEL[f]) }))}
        value={frequency}
        onChange={(event) => setFrequency(event.target.value as Frequency)}
      />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void add()} loading={busy} loadingLabel={t("fees.saving")} disabled={!name.trim() || !amount.trim() || busy}>
        {t("fees.structure.add")}
      </Button>
    </div>
  );
}
