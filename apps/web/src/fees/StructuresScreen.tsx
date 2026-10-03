"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { loadOpenLevels } from "@/admissions/client";
import type { OpenLevel } from "@/admissions/model";
import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Notice } from "@/ui";

import { createStructure, gateFailure, loadStructures } from "./client";
import styles from "./fees.module.css";
import { STATUS_LABEL, type FeeStructure, type FeeStructureList } from "./model";
import { nprShort } from "./ReadFees";
import { sentMessage } from "./OwnFees";

/** Fee structures this year (D-075): one per level; each level without one can be drafted from here (the Accountant). */
export function StructuresScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const accountant = me?.roles.some((r) => r.role === "accountant") ?? false;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const loadNow = useCallback(async () => {
    const [structures, levels] = await Promise.all([loadStructures(api), loadOpenLevels(api)]);
    if (!structures.ok) return gateFailure(structures.reason);
    return { ok: true as const, data: { structures: structures.data, levels: levels.ok ? levels.data : [] } };
  }, [api]);
  const { view, reload } = useLoad<{ structures: FeeStructureList; levels: OpenLevel[] }>(loadNow);

  async function draft(levelId: string) {
    const sent = await createStructure(api, levelId);
    if (sent.ok) router.push(`/portal/fees/structure?id=${(sent.data as { id: string }).id}`);
    else {
      setError(sentMessage(sent));
      void reload();
    }
  }

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("fees.structures.title")} subtitle={t("fees.structures.intro")} />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {view.status === "loading" ? <TableSkeleton rows={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready"
        ? (() => {
            const { structures, levels } = view.data;
            const drafted = new Set(structures.structures.map((x) => x.levelId));
            const missing = levels.filter((l) => !drafted.has(l.id));
            return (
              <>
                {structures.structures.length === 0 ? (
                  <EmptyLine>{t("fees.structures.empty")}</EmptyLine>
                ) : (
                  <Panel>
                    <StructuresTable structures={structures.structures} />
                  </Panel>
                )}
                {accountant && missing.length > 0 ? (
                  <Panel title={t("fees.structures.missing")} labelledBy="structures-missing">
                    <ul className={styles.list}>
                      {missing.map((l) => (
                        <li key={l.id} className={styles.row}>
                          <span>
                            {l.programmeName} · {l.name}
                          </span>
                          <Button className={styles.wrapLabel} variant="secondary" onClick={() => void draft(l.id)}>
                            {t("fees.structures.draft")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ) : null}
                {accountant ? null : <ReadOnlyNote>{t("fees.structures.readOnly", { accountant: term("role.accountant") })}</ReadOnlyNote>}
              </>
            );
          })()
        : null}
    </div>
  );
}

/** A structure's status in words: Live, Draft, Waiting for approval. */
export const StructureStatus = ({ status }: { status: FeeStructure["status"] }) => <StatusWord tone={status === "live" ? "ok" : status === "waiting" ? "warn" : undefined}>{t(STATUS_LABEL[status])}</StatusWord>;

/** Every structure this year: programme and level, year, yearly total, status in words, each opening its items. Pure. */
export function StructuresTable({ structures }: { structures: FeeStructureList["structures"] }) {
  return (
    <ReadTable
      caption={t("fees.structures.title")}
      rows={structures}
      rowKey={(x) => x.id}
      columns={[
        { key: "level", label: t("fees.col.level"), primary: true, cell: (x) => `${x.programmeName} · ${x.levelName}` },
        { key: "year", label: t("fees.col.year"), cell: (x) => x.yearLabel },
        { key: "total", label: t("fees.col.yearly"), align: "end", cell: (x) => nprShort(x.yearlyTotalPaisa) },
        { key: "status", label: t("attendance.class.status"), cell: (x) => <StructureStatus status={x.status} /> },
        { key: "open", label: t("fees.col.items"), align: "end", plain: true, cell: (x) => <OpenLink href={`/portal/fees/structure?id=${x.id}`} label={t("fees.structures.open", { name: `${x.programmeName} · ${x.levelName}` })} /> },
      ]}
    />
  );
}
