"use client";

import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { ReadFailure, ReadHeader, ReadOnlyNote, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { TermsTable } from "@/terms/TermsScreen";
import { loadTerms } from "@/terms/client";

import { useLoad } from "./useLoad";

/**
 * Setup's first tab: the academic terms, read (D-110). The Principal makes, opens and closes them on Academic terms;
 * the Co-ordinator sets up the classes, exams and teaching of the open ones on the next tabs.
 */
export function YearsScreen() {
  const { api } = useSession();
  const load = useCallback(() => loadTerms(api), [api]);
  const { view, reload } = useLoad(load);
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("terms.title")} subtitle={t("setup.terms.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={3} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? <TermsTable terms={view.data.years} /> : null}
      <ReadOnlyNote>{t("setup.terms.note")}</ReadOnlyNote>
    </div>
  );
}
