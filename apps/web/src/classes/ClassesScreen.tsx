"use client";

import { useCallback, useState } from "react";

import { ClassAttendanceScreen } from "@/attendance/ClassAttendanceScreen";
import { ClassActivityScreen } from "@/classwork/ClassActivityScreen";
import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { t, type MessageKey } from "@/i18n/messages";
import { AddDialog } from "@/ui";
import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, Segments, TableSkeleton, readStyles } from "@/read/ReadView";
import { ClassSheetView } from "@/results/StaffScreens";
import { MyMarksByExam, TerminalCards } from "./TerminalGroups";
import { ImportStudents } from "./ImportStudents";
import { useSession } from "@/session/SessionProvider";
import { canManageStructure } from "@/setup/model";
import { useTermChoice } from "@/shell/TermChoice";
import { useLoad } from "@/setup/useLoad";

import { AddClassDialog } from "./AddClassDialog";
import { ClassesBrowser } from "./ClassesBrowser";
import { loadClassHub, loadClassHubList } from "./client";
import { classPlace, classTabs, pickTab, type ClassHub, type ClassTab } from "./model";

/**
 * A class as one page (FUT point 19, D-116). The list shows the classes a person opens; a class shows its students, and
 * the attendance, classwork and results the person may see of it. The API decides who sees what; these screens only
 * leave out what it did not send.
 */

export function ClassesScreen() {
  const { api, me } = useSession();
  const canManage = canManageStructure(me?.roles ?? []);
  const loadNow = useCallback(() => loadClassHubList(api), [api]);
  const { view, reload } = useLoad(loadNow);
  // The term chosen in the top bar (D-127); a level is in one open term, so this keeps whole levels together.
  const { choice } = useTermChoice();
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("classes.title")} subtitle={t("classes.subtitle")} actions={canManage ? <AddClassDialog onAdded={() => void reload()} /> : undefined} />
      {view.status === "loading" ? <TableSkeleton rows={5} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" && choice && view.data.classes.length > 0 && !view.data.classes.some((c) => c.termId === choice) ? (
        <EmptyLine>{t("classes.noneInTerm")}</EmptyLine>
      ) : view.status === "ready" ? (
        <ClassesBrowser classes={choice ? view.data.classes.filter((c) => c.termId === choice) : view.data.classes} canManage={canManage} onChanged={() => void reload()} />
      ) : null}
    </div>
  );
}

const TAB_LABEL: Record<ClassTab, MessageKey> = {
  students: "classes.tab.students",
  attendance: "attendance.title",
  classwork: "classwork.title",
  results: "classes.tab.results",
};

/** The students of a class: roll number and name, and the SID for those who see the whole class. Pure. */
export function StudentsTable({ hub, canOpenRecord }: { hub: Pick<ClassHub, "students" | "viewer">; canOpenRecord: boolean }) {
  if (hub.students.length === 0) return <EmptyLine>{t("classes.noStudents")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("classes.tab.students")}
      rows={hub.students}
      rowKey={(s) => s.enrollmentId}
      columns={[
        { key: "roll", label: t("classes.col.roll"), cell: (s) => (s.rollNo === null ? "—" : String(s.rollNo)) },
        { key: "name", label: t("classes.col.name"), primary: true, cell: (s) => s.name },
        ...(hub.viewer.seesAll ? [{ key: "sid", label: t("classes.col.sid"), cell: (s: ClassHub["students"][number]) => s.sid ?? "—" }] : []),
        ...(canOpenRecord
          ? [
              {
                key: "record",
                label: t("classes.col.record"),
                align: "end" as const,
                plain: true,
                cell: (s: ClassHub["students"][number]) => (s.studentId ? <OpenLink href={`/portal/admissions/student?id=${s.studentId}`} label={t("classes.recordNamed", { name: s.name })} text={t("classes.open")} /> : null),
              },
            ]
          : []),
      ]}
    />
  );
}

/**
 * The Results tab. Those who see the whole class read each published exam's sheet (every subject); a subject teacher
 * opens the marks of their own subjects, exam by exam. Pure apart from the sheets it loads.
 */
export function ClassResults({ hub }: { hub: Pick<ClassHub, "class" | "viewer" | "mySubjects" | "terminals"> }) {
  const { term } = useConfig();
  if (hub.terminals.length === 0) return <EmptyLine>{t("classes.noExams")}</EmptyLine>;
  if (hub.viewer.seesAll) {
    const published = hub.terminals.filter((x) => x.published);
    if (published.length === 0) return <EmptyLine>{t("classes.nothingPublished", { coordinator: term("role.coordinator") })}</EmptyLine>;
    // A card for each published exam, the class's sheet for it inside.
    return <TerminalCards terminals={published} body={(x) => <ClassSheetView classId={hub.class.id} terminalId={x.id} exportable={hub.viewer.staff} bare />} />;
  }
  if (hub.mySubjects.length === 0) return <EmptyLine>{t("classes.noSubjects")}</EmptyLine>;
  return <MyMarksByExam hub={hub} />;
}

/** One class (`?id=`, and `&tab=` to open on a tab). */
export function ClassPageScreen() {
  const { api, me } = useSession();
  const { moduleEnabled } = useConfig();
  const search = useAddressQuery();
  const id = search === null ? "" : (new URLSearchParams(search).get("id") ?? "");
  const askedTab = search === null ? null : new URLSearchParams(search).get("tab");
  const [chosen, setChosen] = useState<ClassTab | null>(null);
  const loadNow = useCallback(async () => {
    if (!id) return { ok: false as const, reason: "failed" as const };
    return loadClassHub(api, id);
  }, [api, id]);
  const { view, reload } = useLoad(loadNow);

  if (search === null || view.status === "loading") return <TableSkeleton rows={6} />;
  if (view.status !== "ready") return <ReadFailure status={view.status} onRetry={() => void reload()} />;
  const hub = view.data;
  const tabs = classTabs(hub, { attendance: moduleEnabled("attendance"), classwork: moduleEnabled("activity_log") || moduleEnabled("homework") || moduleEnabled("notes") });
  const tab = pickTab(tabs, chosen ?? askedTab);
  const place = classPlace(hub.class);
  // The Co-ordinator (and Support) admit students, so they may import a class list (the PM, 2026-10-11).
  const canImport = (me?.roles ?? []).some((r) => r.role === "coordinator" || r.role === "super_admin");
  const canOpenRecord = (me?.roles ?? []).some((r) => r.role === "coordinator" || r.role === "admin" || r.role === "super_admin");

  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={place}
        subtitle={t(hub.class.students === 1 ? "classes.pageSubtitleOne" : "classes.pageSubtitle", { term: hub.class.termLabel, teacher: hub.class.classTeacher ?? t("classes.noClassTeacher"), count: hub.class.students })}
        crumbs={[{ label: t("classes.title"), href: "/portal/classes" }, { label: place }]}
      />
      <Segments label={t("classes.tabs")} value={tab} onChange={setChosen} options={tabs.map((k) => ({ key: k, label: t(TAB_LABEL[k]) }))} />
      {tab === "students" ? (
        <Panel
          actions={
            canImport ? (
              <AddDialog label={t("classes.import.open")} title={t("classes.import.title")} variant="secondary" plus={false}>
                {() => <ImportStudents classId={hub.class.id} levelId={hub.class.levelId} className={place} onDone={() => void reload()} />}
              </AddDialog>
            ) : undefined
          }
        >
          <StudentsTable hub={hub} canOpenRecord={canOpenRecord} />
        </Panel>
      ) : null}
      {tab === "attendance" ? <ClassAttendanceScreen embedded /> : null}
      {tab === "classwork" ? <ClassActivityScreen embedded /> : null}
      {tab === "results" ? <ClassResults hub={hub} /> : null}
    </div>
  );
}
