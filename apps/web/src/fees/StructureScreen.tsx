"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { loadOpenLevels } from "@/admissions/client";
import type { OpenLevel } from "@/admissions/model";
import { useConfig } from "@/config/ConfigProvider";
import { BsDateField } from "@/content/BsDateField";
import { useAddressQuery } from "@/content/address";
import { toAd } from "@/content/client";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { EmptyLine, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, TableSkeleton, readStyles } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Checkbox, Field, Notice } from "@/ui";

import { addFeeItem, discardFeeEdit, gateFailure, linkLevels, loadStructure, removeFeeItem, requestFeeEdit, sendStructure, startNextPeriod, unlinkLevel, type Sent } from "./client";
import styles from "./fees.module.css";
import { FREQUENCY_LABEL, type FeeStructure } from "./model";
import { formatNprShort, parseNpr } from "./money";
import { nprShort } from "./ReadFees";
import { StructureStatus, periodText } from "./StructuresScreen";
import { sentMessage } from "./OwnFees";

type Flash = { tone: "ok" | "bad"; text: string } | null;

/** One fee structure (`?id=`): its lines; a draft's lines added and removed and sent for approval; a live one linked to levels, or its next period started. */
export function StructureScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const router = useRouter();
  const accountant = me?.roles.some((r) => r.role === "accountant") ?? false;
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const [message, setMessage] = useState<Flash>(null);
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
  const draft = accountant && s.status === "draft";
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={s.name}
        subtitle={t("fees.structure.subtitle", { period: periodText(s), total: formatNprShort(s.totalPaisa) })}
        crumbs={[{ label: t("fees.structures.title"), href: "/portal/fees/structures" }, { label: s.name }]}
        actions={
          <div className={styles.headerActions}>
            <StructureStatus status={s.status} />
            {draft ? (
              <AddDialog label={t("fees.structure.add")} title={t("fees.structure.add")} variant={s.items.length > 0 ? "secondary" : "primary"}>
                {(close) => (
                  <AddLine
                    structureId={s.id}
                    onAdded={(lineName) => {
                      close();
                      setMessage({ tone: "ok", text: t("fees.structure.added", { name: lineName }) });
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
            {accountant && s.status === "live" && !s.editRequested ? (
              <AddDialog label={t("fees.structure.editAsk")} title={t("fees.structure.editAsk")} variant="secondary" plus={false}>
                {(close) => (
                  <EditAskForm
                    structureId={s.id}
                    onAsked={() => {
                      close();
                      setMessage({ tone: "ok", text: t("fees.structure.editAsked") });
                      void reload();
                    }}
                  />
                )}
              </AddDialog>
            ) : null}
            {draft && s.editing ? (
              <Button className={styles.wrapLabel} variant="quiet" onClick={() => void act(() => discardFeeEdit(api, s.id), () => t("fees.structure.editDiscarded"))}>
                {t("fees.structure.editDiscard")}
              </Button>
            ) : null}
            {accountant && s.status === "live" ? (
              <AddDialog label={t("fees.structure.next")} title={t("fees.structure.next")} variant="secondary" plus={false}>
                {() => <NextPeriodForm structureId={s.id} onMade={(nextId) => router.push(`/portal/fees/structure?id=${nextId}`)} />}
              </AddDialog>
            ) : null}
          </div>
        }
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {accountant && s.status === "live" ? <ReadOnlyNote>{s.editRequested ? t("fees.structure.editWaiting") : t("fees.structure.fixed")}</ReadOnlyNote> : null}
      {s.editing && s.inForce ? <ReadOnlyNote>{t("fees.structure.editingNote", { total: formatNprShort(s.inForce.totalPaisa) })}</ReadOnlyNote> : null}
      {accountant && s.status === "waiting" ? <ReadOnlyNote>{t("fees.structure.waiting")}</ReadOnlyNote> : null}
      <Panel title={t("fees.structure.items")} labelledBy="items-heading">
        <ItemsTable structure={s} onRemove={draft ? (itemId) => void act(() => removeFeeItem(api, itemId), () => t("fees.structure.removed")) : undefined} />
      </Panel>
      {s.status === "live" ? (
        <Panel
          title={t("fees.structure.levels")}
          labelledBy="levels-heading"
          actions={
            accountant ? (
              <AddDialog label={t("fees.structure.link")} title={t("fees.structure.link")} variant="secondary" plus={false}>
                {(close) => (
                  <LinkLevels
                    structure={s}
                    onDone={(text) => {
                      close();
                      setMessage({ tone: "ok", text });
                      void reload();
                    }}
                  />
                )}
              </AddDialog>
            ) : undefined
          }
        >
          <p className={readStyles.rowMeta}>{t("fees.structure.levelsIntro")}</p>
          <LinkedLevels
            structure={s}
            onUnlink={accountant ? (levelId) => void act(() => unlinkLevel(api, s.id, levelId), () => t("fees.structure.unlinked")) : undefined}
          />
        </Panel>
      ) : null}
      {accountant ? null : <ReadOnlyNote>{t("fees.structures.readOnly", { accountant: term("role.accountant") })}</ReadOnlyNote>}
    </div>
  );
}

/** The levels a structure is linked to, each with its students and, for the Accountant, Unlink. Pure. */
export function LinkedLevels({ structure, onUnlink }: { structure: FeeStructure; onUnlink?: (levelId: string) => void }) {
  if (structure.levels.length === 0) return <EmptyLine>{t("fees.structure.noLevels")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("fees.structure.levels")}
      rows={structure.levels}
      rowKey={(l) => l.levelId}
      columns={[
        { key: "level", label: t("fees.col.level"), primary: true, cell: (l) => `${l.programmeName} · ${l.levelName}` },
        { key: "students", label: t("fees.col.students"), align: "end", cell: (l) => l.students },
        ...(onUnlink
          ? [
              {
                key: "unlink",
                label: t("fees.structure.unlink"),
                align: "end" as const,
                plain: true,
                cell: (l: FeeStructure["levels"][number]) => (
                  <Button className={styles.wrapLabel} variant="quiet" onClick={() => onUnlink(l.levelId)} aria-label={t("fees.structure.unlinkNamed", { name: `${l.programmeName} · ${l.levelName}` })}>
                    {t("fees.structure.unlink")}
                  </Button>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

/** The lines, as on the Approvals review panel: line, amount; then the total. A structure from before D-172 also shows how its lines were billed. Pure. */
export function ItemsTable({ structure, onRemove }: { structure: FeeStructure; onRemove?: (itemId: string) => void }) {
  if (structure.items.length === 0) return <EmptyLine>{t("fees.structure.noItems")}</EmptyLine>;
  const legacy = structure.items.some((i) => i.frequency !== "one_time");
  return (
    <>
      <ReadTable
        caption={t("fees.structure.items")}
        rows={structure.items}
        rowKey={(item) => item.id}
        columns={[
          { key: "name", label: t("fees.structure.itemName"), primary: true, cell: (item) => item.name },
          ...(legacy ? [{ key: "frequency", label: t("fees.structure.frequency"), cell: (item: FeeStructure["items"][number]) => (item.frequency === "one_time" ? "" : t(FREQUENCY_LABEL[item.frequency])) }] : []),
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
        <span>{t("fees.structure.total")}</span>
        <span className={styles.amount}>{nprShort(structure.totalPaisa)}</span>
      </p>
    </>
  );
}

/** One line added to a draft, in a pop-up: a name and a price. */
function AddLine({ structureId, onAdded }: { structureId: string; onAdded: (name: string) => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function add() {
    const paisa = parseNpr(amount);
    if (paisa === null) return setError(t("fees.badAmount"));
    setError(null);
    setBusy(true);
    const sent = await addFeeItem(api, structureId, { name: name.trim(), amountPaisa: paisa });
    setBusy(false);
    if (sent.ok) onAdded(name.trim());
    else setError(sentMessage(sent));
  }
  return (
    <div className={styles.form}>
      <Field label={t("fees.structure.itemName")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      <Field label={t("fees.amount")} hint={t("fees.amountHint")} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void add()} loading={busy} loadingLabel={t("fees.saving")} disabled={!name.trim() || !amount.trim() || busy}>
        {t("fees.structure.add")}
      </Button>
    </div>
  );
}

/** The next period: new dates in BS; the lines are copied in, ready to edit and send for approval. */
function NextPeriodForm({ structureId, onMade }: { structureId: string; onMade: (id: string) => void }) {
  const { api } = useSession();
  const [startBs, setStartBs] = useState("");
  const [endBs, setEndBs] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    setSaving(true);
    const [start, end] = await Promise.all([toAd(api, startBs), toAd(api, endBs)]);
    if (!start.ok || !end.ok) {
      setSaving(false);
      return setProblem(t("fees.structures.datesBad"));
    }
    const sent = await startNextPeriod(api, structureId, { startDate: start.ad, endDate: end.ad });
    setSaving(false);
    if (sent.ok) onMade((sent.data as { id: string }).id);
    else setProblem(sent.reason === "refused" ? t("fees.structure.nextTaken") : sentMessage(sent));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <p className={readStyles.rowMeta}>{t("fees.structure.nextIntro")}</p>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <BsDateField legend={t("fees.structures.start")} value={startBs} onChange={setStartBs} />
      <BsDateField legend={t("fees.structures.end")} value={endBs} onChange={setEndBs} />
      <Button type="submit" loading={saving} loadingLabel={t("fees.saving")} disabled={!startBs || !endBs}>
        {t("fees.structure.nextMake")}
      </Button>
    </form>
  );
}

/** The reason for editing an approved structure, asked in a pop-up; the Principal decides it. */
function EditAskForm({ structureId, onAsked }: { structureId: string; onAsked: () => void }) {
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setProblem(null);
    setSaving(true);
    const sent = await requestFeeEdit(api, structureId, reason.trim());
    setSaving(false);
    if (sent.ok) onAsked();
    else setProblem(sentMessage(sent));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <p className={readStyles.rowMeta}>{t("fees.structure.editIntro")}</p>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("fees.structure.editReason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      <Button type="submit" loading={saving} loadingLabel={t("fees.saving")} disabled={reason.trim().length < 3}>
        {t("fees.structure.editSend")}
      </Button>
    </form>
  );
}

/** The levels of the structure's wing, by programme, each a box; the ones already linked are ticked and cannot be ticked again. */
function LinkLevels({ structure, onDone }: { structure: FeeStructure; onDone: (text: string) => void }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadOpenLevels(api);
    return result.ok ? result : { ok: false as const, reason: result.reason };
  }, [api]);
  const { view } = useLoad<OpenLevel[]>(loadNow);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (view.status === "loading") return <TableSkeleton rows={3} />;
  if (view.status !== "ready") return <Notice tone="bad">{t("fees.failed")}</Notice>;
  const linked = new Set(structure.levels.map((l) => l.levelId));
  const here = view.data.filter((l) => l.sectionKey === structure.sectionKey);
  const programmes = [...new Set(here.map((l) => l.programmeName))];
  async function link() {
    setBusy(true);
    setProblem(null);
    const sent = await linkLevels(api, structure.id, [...chosen]);
    setBusy(false);
    if (!sent.ok) return setProblem(sentMessage(sent));
    const result = sent.data as { levels: { levelId: string; ok: boolean; reason?: string }[]; charged: number; pending: boolean };
    const failed = result.levels.filter((l) => !l.ok);
    if (failed.length === 0) return onDone(t(result.pending ? "fees.structure.linkedMore" : "fees.structure.linkedAll", { count: result.levels.length, charged: result.charged }));
    const names = failed.map((f) => here.find((l) => l.id === f.levelId)).map((l) => (l ? `${l.programmeName} · ${l.name}` : ""));
    setProblem(t("fees.structure.linkRefused", { levels: names.join(", ") }));
  }
  if (here.length === 0) return <EmptyLine>{t("fees.structure.noOpenLevels")}</EmptyLine>;
  return (
    <div className={styles.form}>
      <p className={readStyles.rowMeta}>{t("fees.structure.linkIntro")}</p>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      {programmes.map((programme) => (
        <fieldset key={programme} className={styles.levelGroup}>
          <legend>{programme}</legend>
          {here
            .filter((l) => l.programmeName === programme)
            .map((l) => (
              <Checkbox
                key={l.id}
                label={l.name}
                checked={linked.has(l.id) || chosen.has(l.id)}
                disabled={linked.has(l.id)}
                onChange={(event) => setChosen((now) => (event.target.checked ? new Set([...now, l.id]) : new Set([...now].filter((x) => x !== l.id))))}
              />
            ))}
        </fieldset>
      ))}
      <Button className={styles.wrapLabel} fullWidth onClick={() => void link()} loading={busy} loadingLabel={t("fees.saving")} disabled={chosen.size === 0 || busy}>
        {t("fees.structure.linkDo", { count: chosen.size })}
      </Button>
    </div>
  );
}
