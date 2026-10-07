"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { ClassForm, YearPicker } from "@/setup/ClassesScreen";
import { loadProgrammes, loadYears } from "@/setup/client";
import { startYearId } from "@/setup/model";
import { useLoad } from "@/setup/useLoad";
import { useRememberedTerm } from "@/shell/TermChoice";
import { AddDialog } from "@/ui";

/**
 * "+ Add Class" on the Classes page: choose the term (it starts on the one chosen in the top bar), then the level and
 * the section. The Co-ordinator's Setup shows this same page, so the form lives here rather than on a page of its own
 * (the PM, 2026-10-07). Shown only to people who may manage the structure; the API decides.
 */
export function AddClassDialog({ onAdded }: { onAdded: () => void }) {
  const { api } = useSession();
  const loadYearsNow = useCallback(() => loadYears(api), [api]);
  const loadProgrammesNow = useCallback(() => loadProgrammes(api), [api]);
  const years = useLoad(loadYearsNow);
  const programmes = useLoad(loadProgrammesNow);
  const { remembered } = useRememberedTerm();
  const [picked, setPicked] = useState<string | null>(null);
  if (years.view.status !== "ready" || programmes.view.status !== "ready") return null;
  const list = years.view.data.years;
  const programmeList = programmes.view.data.programmes;
  const yearId = picked ?? startYearId(list, remembered);
  if (!yearId) return null;
  return (
    <AddDialog label={t("classes.add")} title={t("classes.add")}>
      {(close) => (
        <>
          <YearPicker years={list} value={yearId} onChange={setPicked} />
          <ClassForm
            key={yearId}
            yearId={yearId}
            levelIds={list.find((y) => y.id === yearId)?.levels.map((l) => l.id) ?? []}
            programmes={programmeList}
            showTitle={false}
            onAdded={() => {
              close();
              onAdded();
            }}
          />
        </>
      )}
    </AddDialog>
  );
}
