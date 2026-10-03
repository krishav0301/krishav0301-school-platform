"use client";

import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { YearPicker } from "@/setup/ClassesScreen";
import { loadClasses, loadYears, type Loaded as SetupLoaded } from "@/setup/client";
import { canManageStructure, classTitle, defaultYearId, type SchoolClass } from "@/setup/model";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Notice, Select } from "@/ui";

import { TeachingRead } from "./TeachingRead";
import { loadTeaching, setAssignment, setClassTeacher } from "./teaching-client";
import { REASON_MESSAGE, type Teaching, type TeachingFailReason } from "./teaching-model";

type Flash = { tone: "ok" | "bad"; text: string };

/** Picks the class this screen is about, from the classes of the chosen year. */
function ClassPicker({ classes, value, onChange }: { classes: readonly SchoolClass[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <Select
      label={t("people.teaching.chooseClass")}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      options={[{ value: "", label: t("people.teaching.pickAClass") }, ...classes.map((c) => ({ value: c.id, label: classTitle(c) }))]}
    />
  );
}

const teacherOptions = (teachers: Teaching["teachers"]) => [{ value: "", label: t("people.teaching.none") }, ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.fullName }))];

/** One class's subjects with their current teacher, and its Class Teacher. A reader sees the same facts, no pickers. */
export function TeachingView({
  teaching,
  canManage,
  busy,
  onAssign,
  onClassTeacher,
}: {
  teaching: Teaching;
  canManage: boolean;
  busy: string | null;
  onAssign: (offeringId: string, teacherId: string | null) => void;
  onClassTeacher: (teacherId: string | null) => void;
}) {
  const options = teacherOptions(teaching.teachers);

  return (
    <>
      {canManage ? (
        <Select
          label={t("people.teaching.classTeacher")}
          value={teaching.classTeacher?.id ?? ""}
          disabled={busy !== null}
          onChange={(event) => onClassTeacher(event.target.value || null)}
          options={options}
        />
      ) : (
        <p className={setupStyles.muted}>
          {t("people.teaching.classTeacher")}: {teaching.classTeacher ? teaching.classTeacher.fullName : t("people.teaching.none")}
        </p>
      )}

      <h2 className={setupStyles.subhead}>{t("people.teaching.subjects")}</h2>
      {teaching.assignments.length === 0 ? (
        <p className={setupStyles.empty}>{t("people.teaching.empty")}</p>
      ) : (
        <ul className={setupStyles.list}>
          {teaching.assignments.map((assignment) => (
            <li key={assignment.offeringId} className={setupStyles.item}>
              <h3 className={setupStyles.itemTitle}>{assignment.subjectName}</h3>
              {canManage ? (
                <Select
                  label={t("people.teaching.teacherOf", { subject: assignment.subjectName })}
                  value={assignment.teacher?.id ?? ""}
                  disabled={busy !== null}
                  onChange={(event) => onAssign(assignment.offeringId, event.target.value || null)}
                  options={options}
                />
              ) : (
                <p className={setupStyles.muted}>{assignment.teacher ? assignment.teacher.fullName : t("people.teaching.none")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Teaching: the Co-ordinator assigns, class by class; the Principal reads it by teacher (D-104). */
export function TeachingScreen() {
  const { me } = useSession();
  if (!canManageStructure(me?.roles ?? [])) return <TeachingRead />;
  return <TeachingManage />;
}

function TeachingManage() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const canManage = canManageStructure(me?.roles ?? []);

  const loadYearsNow = useCallback(() => loadYears(api), [api]);
  const years = useLoad(loadYearsNow);
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const yearId = pickedYear ?? (years.view.status === "ready" ? defaultYearId(years.view.data.years) : null);

  const loadClassesNow = useCallback(
    (): Promise<SetupLoaded<{ classes: SchoolClass[] }>> => (yearId ? loadClasses(api, yearId) : Promise.resolve({ ok: true, data: { classes: [] } })),
    [api, yearId],
  );
  const classes = useLoad(loadClassesNow);
  const [classId, setClassId] = useState<string | null>(null);

  const loadTeachingNow = useCallback(() => (classId ? loadTeaching(api, classId) : Promise.resolve({ ok: true as const, data: null })), [api, classId]);
  const teaching = useLoad(loadTeachingNow);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<{ ok: true } | { ok: false; reason: TeachingFailReason }>, done: MessageKey) {
    if (busy) return;
    setBusy(id);
    setFlash(null);
    const result = await action();
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t(done) } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await teaching.reload();
  }

  return (
    <>
      <h1 className={setupStyles.title}>{t("people.teaching.title")}</h1>
      <p className={setupStyles.muted}>{t("people.teaching.intro")}</p>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}

      <Gate view={years.view} onRetry={() => void years.reload()}>
        {({ years: list }) =>
          list.length === 0 ? (
            <p className={setupStyles.empty}>{t("people.teaching.noYear")}</p>
          ) : (
            <div className={setupStyles.filters}>
              <YearPicker years={list} value={yearId} onChange={setPickedYear} />
            </div>
          )
        }
      </Gate>

      {yearId ? (
        <Gate view={classes.view} onRetry={() => void classes.reload()}>
          {(data) =>
            data.classes.length === 0 ? (
              <p className={setupStyles.empty}>{t("people.teaching.noClasses")}</p>
            ) : (
              <>
                <div className={setupStyles.filters}>
                  <ClassPicker classes={data.classes} value={classId} onChange={setClassId} />
                </div>
                {classId ? (
                  <Gate view={teaching.view} onRetry={() => void teaching.reload()}>
                    {(data2) =>
                      data2 === null ? null : (
                        <TeachingView
                          teaching={data2}
                          canManage={canManage}
                          busy={busy}
                          onAssign={(offeringId, teacherId) =>
                            void run(offeringId, () => setAssignment(api, classId, offeringId, teacherId), teacherId ? "people.teaching.done.assigned" : "people.teaching.done.removed")
                          }
                          onClassTeacher={(teacherId) =>
                            void run("class-teacher", () => setClassTeacher(api, classId, teacherId), teacherId ? "people.teaching.done.classTeacherSet" : "people.teaching.done.classTeacherCleared")
                          }
                        />
                      )
                    }
                  </Gate>
                ) : null}
              </>
            )
          }
        </Gate>
      ) : null}

      {canManage ? null : <Notice>{t("setup.readOnly", { coordinator: term("role.coordinator") })}</Notice>}
    </>
  );
}
