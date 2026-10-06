"use client";

import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { loadClasses, loadYears } from "@/setup/client";
import { classTitle } from "@/setup/model";
import { openTermOf } from "@/setup/structure-picker";
import { Gate, useLoad } from "@/setup/useLoad";
import { Notice, Select } from "@/ui";

/**
 * Every switched-on class of one level in the open term that runs it: what a Co-ordinator may place an applicant into
 * (D-063). A level is in only one open term (D-110), so that term is the only place to look; with several terms open,
 * the first one is not it (D-114, FUT point 15).
 */
export function ClassPicker({ levelId, value, onChange }: { levelId: string; value: string; onChange: (id: string) => void }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const years = await loadYears(api);
    if (!years.ok) return years;
    const term = openTermOf(years.data.years, levelId);
    if (!term) return { ok: true as const, data: { classes: [] } };
    return loadClasses(api, term.id);
  }, [api, levelId]);
  const { view, reload } = useLoad(loadNow);

  return (
    <Gate view={view} onRetry={() => void reload()}>
      {(data) => {
        const options = data.classes.filter((c) => c.levelId === levelId && c.active).map((c) => ({ value: c.id, label: classTitle(c) }));
        return options.length === 0 ? (
          <Notice tone="bad">{t("admissions.decide.noClasses")}</Notice>
        ) : (
          <Select label={t("admissions.decide.classId")} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: "", label: t("admissions.field.levelChoose") }, ...options]} />
        );
      }}
    </Gate>
  );
}
