"use client";

import { useCallback } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { loadClasses, loadYears } from "@/setup/client";
import { classTitle, defaultYearId } from "@/setup/model";
import { Gate, useLoad } from "@/setup/useLoad";
import { Notice, Select } from "@/ui";

/** Every active class of one level, in the active year: what a Co-ordinator may place an applicant into (D-063). */
export function ClassPicker({ levelId, value, onChange }: { levelId: string; value: string; onChange: (id: string) => void }) {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const years = await loadYears(api);
    if (!years.ok) return years;
    const yearId = defaultYearId(years.data.years);
    if (!yearId) return { ok: true as const, data: { classes: [] } };
    return loadClasses(api, yearId);
  }, [api]);
  const { view } = useLoad(loadNow);

  return (
    <Gate view={view} onRetry={() => {}}>
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
