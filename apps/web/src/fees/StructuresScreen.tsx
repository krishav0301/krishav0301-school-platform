"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { loadOpenLevels } from "@/admissions/client";
import type { OpenLevel } from "@/admissions/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Notice } from "@/ui";

import { createStructure, gateFailure, loadStructures } from "./client";
import styles from "./fees.module.css";
import { STATUS_LABEL, type FeeStructureList } from "./model";
import { formatNpr } from "./money";
import { sentMessage } from "./OwnFees";

/** Fee structures this year (D-075): one per level; each level without one can be drafted from here (the Accountant). */
export function StructuresScreen() {
  const { api, me } = useSession();
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
    <>
      <div>
        <h1 className={setupStyles.title}>{t("fees.structures.title")}</h1>
        <p className={setupStyles.muted}>{t("fees.structures.intro")}</p>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {({ structures, levels }) => {
          const drafted = new Set(structures.structures.map((s) => s.levelId));
          const missing = levels.filter((l) => !drafted.has(l.id));
          return (
            <ul className={setupStyles.list}>
              {structures.structures.map((s) => (
                <li key={s.id} className={setupStyles.item}>
                  <h2 className={setupStyles.itemTitle}>
                    <Link href={`/portal/fees/structure?id=${s.id}`}>
                      {s.programmeName} · {s.levelName}
                    </Link>
                  </h2>
                  <div className={setupStyles.badges}>
                    <Badge tone={s.status === "live" ? "ok" : "neutral"}>{t(STATUS_LABEL[s.status])}</Badge>
                    <span>{t("fees.structures.yearly", { amount: formatNpr(s.yearlyTotalPaisa) })}</span>
                  </div>
                </li>
              ))}
              {accountant
                ? missing.map((l) => (
                    <li key={l.id} className={setupStyles.item}>
                      <h2 className={setupStyles.itemTitle}>
                        {l.programmeName} · {l.name}
                      </h2>
                      <div className={styles.actions}>
                        <Badge>{t("fees.structures.none")}</Badge>
                        <Button className={styles.wrapLabel} variant="secondary" onClick={() => void draft(l.id)}>
                          {t("fees.structures.draft")}
                        </Button>
                      </div>
                    </li>
                  ))
                : null}
            </ul>
          );
        }}
      </Gate>
    </>
  );
}
