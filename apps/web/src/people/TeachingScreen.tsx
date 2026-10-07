"use client";

import { BookOpen, UserCheck, UserX } from "lucide-react";
import { useCallback, useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, FigureTiles, Panel, ReadFailure, ReadHeader, StatusWord, TableSkeleton, readStyles, type Figure } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useRememberedTerm } from "@/shell/TermChoice";
import { YearPicker } from "@/setup/ClassesScreen";
import { loadClasses, loadYears, type Loaded as SetupLoaded } from "@/setup/client";
import { canManageStructure, classTitle, startYearId, type SchoolClass } from "@/setup/model";
import { useLoad } from "@/setup/useLoad";
import { Notice, Select } from "@/ui";

import { TeachingRead } from "./TeachingRead";
import { loadTeaching, setAssignment, setClassTeacher } from "./teaching-client";
import styles from "./people.module.css";
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

/** The figures for one class: its subjects, how many have a teacher, and how many still need one. Pure. */
export function teachingFigures(teaching: Teaching): Figure[] {
  const staffed = teaching.assignments.filter((a) => a.teacher !== null).length;
  return [
    { key: "subjects", icon: BookOpen, tone: "accent", value: String(teaching.assignments.length), label: t("people.teaching.figure.subjects") },
    { key: "staffed", icon: UserCheck, tone: "ok", value: String(staffed), label: t("people.teaching.figure.staffed") },
    { key: "open", icon: UserX, tone: teaching.assignments.length - staffed > 0 ? "warn" : "ok", value: String(teaching.assignments.length - staffed), label: t("people.teaching.figure.open") },
  ];
}

/**
 * One class's subjects with their current teacher, and its Class Teacher (D-060), redesigned in D-106: the Class
 * Teacher in its own card, then each subject as a row with its teacher picker. A reader sees the same facts, no pickers.
 */
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
      {teaching.assignments.length > 0 ? <FigureTiles figures={teachingFigures(teaching)} label={t("people.teaching.figures")} /> : null}
      <Panel title={t("people.teaching.classTeacher")} labelledBy="class-teacher" actions={teaching.classTeacher ? null : <StatusWord tone="warn">{t("people.teaching.notSet")}</StatusWord>}>
        <p className={readStyles.rowMeta}>{t("people.teaching.classTeacherHint")}</p>
        {canManage ? (
          <div className={readStyles.search}>
            <Select label={t("people.teaching.classTeacherOf")} value={teaching.classTeacher?.id ?? ""} disabled={busy !== null} onChange={(event) => onClassTeacher(event.target.value || null)} options={options} />
          </div>
        ) : (
          <p>{teaching.classTeacher ? teaching.classTeacher.fullName : t("people.teaching.none")}</p>
        )}
      </Panel>

      <Panel title={t("people.teaching.subjects")} labelledBy="class-subjects">
        {teaching.assignments.length === 0 ? (
          <EmptyLine>{t("people.teaching.empty")}</EmptyLine>
        ) : (
          <ul className={readStyles.rows}>
            {teaching.assignments.map((assignment) => (
              <li key={assignment.offeringId} className={`${readStyles.rowItem} ${styles.teachRow}`}>
                <div className={readStyles.rowHead}>
                  <h3 className={readStyles.rowTitle}>{assignment.subjectName}</h3>
                  {assignment.teacher ? null : <StatusWord tone="warn">{t("people.teaching.noTeacher")}</StatusWord>}
                </div>
                {canManage ? (
                  <div className={styles.teachPick}>
                    <Select
                      label={t("people.teaching.teacherOf", { subject: assignment.subjectName })}
                      value={assignment.teacher?.id ?? ""}
                      disabled={busy !== null}
                      onChange={(event) => onAssign(assignment.offeringId, event.target.value || null)}
                      options={options}
                    />
                  </div>
                ) : (
                  <p className={readStyles.rowMeta}>{assignment.teacher ? assignment.teacher.fullName : t("people.teaching.none")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
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
  // Starts on the term remembered from the top bar (D-127) when it is one of these; choosing here remembers it.
  const { remembered, remember } = useRememberedTerm();
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const yearId = pickedYear ?? (years.view.status === "ready" ? startYearId(years.view.data.years, remembered) : null);

  const loadClassesNow = useCallback(
    (): Promise<SetupLoaded<{ classes: SchoolClass[] }>> => (yearId ? loadClasses(api, yearId) : Promise.resolve({ ok: true, data: { classes: [] } })),
    [api, yearId],
  );
  const classes = useLoad(loadClassesNow);
  const [classId, setClassId] = useState<string | null>(null);

  // The first class opens straight away; picking another is one change, not two steps (D-106).
  const firstClass = classes.view.status === "ready" ? (classes.view.data.classes[0]?.id ?? null) : null;
  const shownClass = classId ?? firstClass;
  const loadTeachingNow = useCallback(() => (shownClass ? loadTeaching(api, shownClass) : Promise.resolve({ ok: true as const, data: null })), [api, shownClass]);
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

  const yearList = years.view.status === "ready" ? years.view.data.years : [];
  const classList = classes.view.status === "ready" ? classes.view.data.classes : [];

  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("people.teaching.title")} subtitle={t("people.teaching.intro")} />
      {years.view.status === "loading" ? <TableSkeleton rows={6} tiles={3} /> : null}
      {years.view.status === "failed" || years.view.status === "forbidden" ? <ReadFailure status={years.view.status} onRetry={() => void years.reload()} /> : null}
      {years.view.status === "ready" && yearList.length === 0 ? <EmptyLine>{t("people.teaching.noYear")}</EmptyLine> : null}
      {yearList.length > 0 ? (
        <div className={`${readStyles.search} ${readStyles.searchWide}`}>
          <YearPicker
            years={yearList}
            value={yearId}
            onChange={(id) => {
              setPickedYear(id);
              remember(id);
              setClassId(null);
              setFlash(null);
            }}
          />
          {classList.length > 0 ? (
            <ClassPicker
              classes={classList}
              value={shownClass}
              onChange={(id) => {
                setClassId(id || null);
                setFlash(null);
              }}
            />
          ) : null}
        </div>
      ) : null}
      {yearId && classes.view.status === "failed" ? <ReadFailure status="failed" onRetry={() => void classes.reload()} /> : null}
      {yearId && classes.view.status === "ready" && classList.length === 0 ? <EmptyLine>{t("people.teaching.noClasses")}</EmptyLine> : null}
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      {shownClass ? (
        teaching.view.status === "loading" ? (
          <TableSkeleton rows={5} tiles={3} />
        ) : teaching.view.status === "ready" ? (
          teaching.view.data === null ? null : (
            <TeachingView
              teaching={teaching.view.data}
              canManage={canManage}
              busy={busy}
              onAssign={(offeringId, teacherId) => void run(offeringId, () => setAssignment(api, shownClass, offeringId, teacherId), teacherId ? "people.teaching.done.assigned" : "people.teaching.done.removed")}
              onClassTeacher={(teacherId) => void run("class-teacher", () => setClassTeacher(api, shownClass, teacherId), teacherId ? "people.teaching.done.classTeacherSet" : "people.teaching.done.classTeacherCleared")}
            />
          )
        ) : (
          <ReadFailure status={teaching.view.status} onRetry={() => void teaching.reload()} />
        )
      ) : null}
      {canManage ? null : <Notice>{t("setup.readOnly", { coordinator: term("role.coordinator") })}</Notice>}
    </div>
  );
}
