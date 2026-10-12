"use client";

import { useCallback } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { ReadHeader } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useTermChoice } from "@/shell/TermChoice";

import { loadSetupMap } from "./client";
import { termWords, type SetupMap } from "./model";
import { StructureExplorer } from "./structure/StructureExplorer";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup-map.module.css";

/**
 * The Academic Structure (the PM, 2026-10-10, redesigned 2026-10-12, D-157): the school's whole setup as a tree to explore,
 * one branch at a time, as a chart or a list. `termHref`: where the term's details open, which differs by who is looking
 * (the Principal's own Academic Term page, or Setup's).
 */
export function SetupMapView({ map, termHref = "/portal/setup" }: { map: SetupMap; termHref?: string }) {
  if (map.terms.length === 0) return <p className={styles.empty}>{t("setup.map.noTerms")}</p>;
  return <StructureExplorer map={map} termHref={termHref} />;
}

/** The Academic Structure page: the whole setup of the chosen term, or of every open term. */
export function SetupMapScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const { choice } = useTermChoice();
  const load = useCallback(() => loadSetupMap(api, choice), [api, choice]);
  const { view, reload } = useLoad(load);
  // The Principal makes and opens the terms on their own page; the Co-ordinator reads them in Setup.
  const termHref = me?.roles.some((r) => r.role === "admin") && !me.roles.some((r) => r.role === "coordinator" || r.role === "super_admin") ? "/portal/terms" : "/portal/setup";
  return (
    <>
      <ReadHeader title={t("setup.map.title")} subtitle={t("setup.map.intro", words)} />
      <Gate view={view} onRetry={() => void reload()}>
        {(map) => <SetupMapView map={map} termHref={termHref} />}
      </Gate>
    </>
  );
}
