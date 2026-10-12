"use client";

import { useEffect, useState } from "react";

import { ImportStudents } from "@/classes/ImportStudents";
import { useImportJob } from "@/classes/import-job";
import { t } from "@/i18n/messages";
import { Panel, ReadHeader, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { Notice } from "@/ui";

import { LevelFields } from "./ApplicantFields";
import admissionsStyles from "./admissions.module.css";
import { ClassPicker } from "./ClassPicker";
import { loadOpenLevels } from "./client";
import type { OpenLevel } from "./model";
import { levelsFor } from "./RegisterScreen";

type Levels = { status: "loading" } | { status: "ready"; levels: OpenLevel[] } | { status: "failed" };

/**
 * Import students from Excel, from Admissions (the PM, 2026-10-12): choose the class (the wing, the course, the level, then
 * the section), then download the template, fill it and upload it. The students are admitted into that class exactly as the
 * class page's import does (D-143, D-151, D-155); an import already running or waiting to be closed is shown here first.
 */
export function ImportScreen() {
  const { api, me } = useSession();
  const { job } = useImportJob();
  const [levels, setLevels] = useState<Levels>({ status: "loading" });
  const [levelId, setLevelId] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let active = true;
    void loadOpenLevels(api).then((result) => {
      if (active) setLevels(result.ok ? { status: "ready", levels: result.data } : { status: "failed" });
    });
    return () => {
      active = false;
    };
  }, [api]);

  const choices = levels.status === "ready" ? levelsFor(levels.levels, me?.roles ?? []) : [];
  // A running import (or its results, until Done) comes first, whichever class it is for.
  const target = job ? { classId: job.classId, levelId: job.levelId, name: job.className } : picked && levelId ? { classId: picked.id, levelId, name: picked.name } : null;

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("admissions.import.title")} subtitle={t("admissions.import.subtitle")} />
      {levels.status === "loading" ? <TableSkeleton rows={4} /> : null}
      {levels.status === "failed" ? <Notice tone="bad">{t("admissions.error.failed")}</Notice> : null}
      {levels.status === "ready" ? (
        <>
          {job ? null : (
            <Panel title={t("admissions.import.step1")} labelledBy="import-class">
              <div className={admissionsStyles.formList}>
                <LevelFields
                  levels={choices}
                  levelId={levelId}
                  onChange={(id) => {
                    setLevelId(id);
                    setPicked(null);
                  }}
                />
                {levelId ? <ClassPicker levelId={levelId} value={picked?.id ?? ""} onChange={(id, name) => setPicked(id ? { id, name: name ?? "" } : null)} /> : null}
              </div>
            </Panel>
          )}
          {target ? (
            <Panel title={t("admissions.import.step2", { class: target.name })} labelledBy="import-file">
              <ImportStudents key={target.classId} classId={target.classId} levelId={target.levelId} className={target.name} />
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
