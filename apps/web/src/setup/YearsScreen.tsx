"use client";

import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { ReadFailure, ReadHeader, ReadOnlyNote, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { loadTerms } from "@/terms/client";
import { ActiveTerms, OtherTerms, TermsBanner } from "@/terms/TermsBoard";
import { nepalToday } from "@/terms/TermsScreen";

import { useLoad } from "./useLoad";

/**
 * Setup's first tab: the academic terms, as the Principal sees them (D-123), with nothing to change (the PM, 2026-10-07).
 * The Principal makes, opens and closes terms; the Co-ordinator sets up the classes, exams and teaching of the open ones
 * on the next tabs. Passing no `manage` to the board is what leaves out its menus and buttons.
 */
export function YearsScreen() {
  const { api } = useSession();
  const load = useCallback(() => loadTerms(api), [api]);
  const { view, reload } = useLoad(load);
  const today = nepalToday();
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("terms.title")} subtitle={t("setup.terms.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={4} tiles={4} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <>
          <TermsBanner />
          <ActiveTerms terms={view.data.years} today={today} />
          <OtherTerms terms={view.data.years} today={today} />
        </>
      ) : null}
      <ReadOnlyNote>{t("setup.terms.note")}</ReadOnlyNote>
    </div>
  );
}
