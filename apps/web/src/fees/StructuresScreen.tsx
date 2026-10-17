"use client";

import { CircleAlert, CircleCheck, FilePen, Hourglass } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { BsDateField } from "@/content/BsDateField";
import { toAd } from "@/content/client";
import { t } from "@/i18n/messages";
import { OpenLink, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession, type RoleClaim } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { AddDialog, Button, Field, Notice, Select } from "@/ui";

import { createStructure, gateFailure, loadStructures } from "./client";
import { LiveStructures, OtherStructures, StructuresBanner } from "./StructuresBoard";
import styles from "./fees.module.css";
import { STATUS_LABEL, type FeeStructure, type FeeStructureList } from "./model";
import { nprShort } from "./ReadFees";
import { sentMessage } from "./OwnFees";

/** The wings an Accountant may make structures for: every wing, or the one their assignment names. Pure. */
export function accountantWings(roles: readonly RoleClaim[], sections: readonly { key: string; name: string }[]): { key: string; name: string }[] {
  const mine = roles.filter((r) => r.role === "accountant" || r.role === "super_admin");
  if (mine.some((r) => r.scope === "institution")) return [...sections];
  const keys = new Set(mine.map((r) => r.section));
  return sections.filter((s) => keys.has(s.key));
}

/** A period in BS, "2083-04-01 to 2084-03-30". Pure. */
export const periodText = (s: Pick<FeeStructure, "startDate" | "endDate" | "startDateBs" | "endDateBs">): string => t("fees.structure.period", { start: s.startDateBs ?? s.startDate, end: s.endDateBs ?? s.endDate });

/** Fee structures (D-172): named price lists with dates; the Accountant makes one, the Principal approves it, then it is linked to levels. */
export function StructuresScreen() {
  const { api, me } = useSession();
  const { term, config } = useConfig();
  const accountant = me?.roles.some((r) => r.role === "accountant") ?? false;
  const loadNow = useCallback(async () => {
    const structures = await loadStructures(api);
    return structures.ok ? structures : gateFailure(structures.reason);
  }, [api]);
  const { view, reload } = useLoad<FeeStructureList>(loadNow);
  const router = useRouter();
  const wings = accountantWings(me?.roles ?? [], config?.sections ?? []);

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("fees.structures.title")}
        subtitle={t("fees.structures.intro")}
        actions={
          accountant && wings.length > 0 ? (
            <AddDialog label={t("fees.structures.new")} title={t("fees.structures.new")}>
              {() => <NewStructureForm wings={wings} onMade={(id) => router.push(`/portal/fees/structure?id=${id}`)} />}
            </AddDialog>
          ) : undefined
        }
      />
      {view.status === "loading" ? <TableSkeleton rows={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          <StructuresBanner />
          <LiveStructures structures={view.data.structures} sections={config?.sections ?? []} />
          <OtherStructures structures={view.data.structures} sections={config?.sections ?? []} />
          {accountant ? null : <ReadOnlyNote>{t("fees.structures.readOnly", { accountant: term("role.accountant") })}</ReadOnlyNote>}
        </>
      ) : null}
    </div>
  );
}

/** The new structure's form: a name, its wing, and its start and end day in BS. Pure apart from what it sends. */
function NewStructureForm({ wings, onMade }: { wings: readonly { key: string; name: string }[]; onMade: (id: string) => void }) {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [wing, setWing] = useState(wings[0]?.key ?? "");
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
    const sent = await createStructure(api, { name: name.trim(), sectionKey: wing, startDate: start.ad, endDate: end.ad });
    setSaving(false);
    if (sent.ok) onMade((sent.data as { id: string }).id);
    else setProblem(sent.reason === "refused" ? t("fees.structures.nameTaken") : sentMessage(sent));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("fees.structures.name")} hint={t("fees.structures.nameHint")} value={name} maxLength={80} autoComplete="off" onChange={(event) => setName(event.target.value)} />
      {wings.length > 1 ? <Select label={t("fees.structures.wing")} value={wing} onChange={(event) => setWing(event.target.value)} options={wings.map((w) => ({ value: w.key, label: w.name }))} /> : null}
      <BsDateField legend={t("fees.structures.start")} value={startBs} onChange={setStartBs} />
      <BsDateField legend={t("fees.structures.end")} value={endBs} onChange={setEndBs} />
      <Button type="submit" loading={saving} loadingLabel={t("fees.saving")} disabled={!name.trim() || !startBs || !endBs}>
        {t("fees.structures.make")}
      </Button>
    </form>
  );
}

/** Live, waiting for the Principal, still drafts, and live ones not yet linked to a level. Pure. */
export function structureFigures(list: FeeStructureList): Figure[] {
  const count = (status: FeeStructure["status"]) => list.structures.filter((x) => x.status === status).length;
  const unlinked = list.structures.filter((x) => x.status === "live" && x.levelsLinked === 0).length;
  return [
    { key: "live", icon: CircleCheck, tone: "ok", value: String(count("live")), label: t("fees.structures.figure.live") },
    { key: "waiting", icon: Hourglass, tone: count("waiting") > 0 ? "warn" : "ok", value: String(count("waiting")), label: t("fees.structures.figure.waiting") },
    { key: "draft", icon: FilePen, tone: "accent", value: String(count("draft")), label: t("fees.structures.figure.draft") },
    { key: "unlinked", icon: CircleAlert, tone: unlinked > 0 ? "warn" : "ok", value: String(unlinked), label: t("fees.structures.figure.unlinked") },
  ];
}

/** A structure's status in words: Live, Draft, Waiting for approval. */
export const StructureStatus = ({ status, ended = false }: { status: FeeStructure["status"]; ended?: boolean }) =>
  status === "live" && ended ? <StatusWord>{t("fees.status.ended")}</StatusWord> : <StatusWord tone={status === "live" ? "ok" : status === "waiting" ? "warn" : undefined}>{t(STATUS_LABEL[status])}</StatusWord>;

/** Every structure: its name, wing, period, total, levels linked and status in words, each opening its lines. Pure. */
export function StructuresTable({ structures, sections }: { structures: FeeStructureList["structures"]; sections: readonly { key: string; name: string }[] }) {
  return (
    <ReadTable
      caption={t("fees.structures.title")}
      rows={structures}
      rowKey={(x) => x.id}
      columns={[
        { key: "name", label: t("fees.structures.name"), primary: true, cell: (x) => x.name },
        { key: "wing", label: t("fees.structures.wing"), hidePhone: true, cell: (x) => sections.find((s) => s.key === x.sectionKey)?.name ?? x.sectionKey },
        { key: "period", label: t("fees.col.period"), cell: (x) => periodText(x) },
        { key: "total", label: t("fees.col.total"), align: "end", cell: (x) => nprShort(x.totalPaisa) },
        { key: "levels", label: t("fees.col.levels"), align: "end", hidePhone: true, cell: (x) => x.levelsLinked },
        { key: "status", label: t("attendance.class.status"), cell: (x) => <StructureStatus status={x.status} ended={x.ended} /> },
        { key: "open", label: t("fees.col.lines"), align: "end", plain: true, cell: (x) => <OpenLink href={`/portal/fees/structure?id=${x.id}`} label={t("fees.structures.open", { name: x.name })} /> },
      ]}
    />
  );
}
