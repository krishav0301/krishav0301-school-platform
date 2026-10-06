"use client";

import { useCallback, useState } from "react";

import { ClassAttendanceScreen } from "@/attendance/ClassAttendanceScreen";
import { ClassActivityScreen } from "@/classwork/ClassActivityScreen";
import { useConfig } from "@/config/ConfigProvider";
import { useAddressQuery } from "@/content/address";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine, OpenLink, Panel, ReadFailure, ReadHeader, ReadTable, Segments, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { ClassSheetView } from "@/results/StaffScreens";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";

import { loadClassHub, loadClassHubList } from "./client";
import { classPlace, classTabs, pickTab, type ClassHub, type ClassHubItem, type ClassTab } from "./model";

/**
 * A class as one page (FUT point 19, D-116). The list shows the classes a person opens; a class shows its students, and
 * the attendance, classwork and results the person may see of it. The API decides who sees what; these screens only
 * leave out what it did not send.
 */

/** Every class the person opens, with where it sits, its Class Teacher and its students. Pure. */
export function ClassesTable({ classes }: { classes: readonly ClassHubItem[] }) {
  if (classes.length === 0) return <EmptyLine>{t("classes.empty")}</EmptyLine>;
  return (
    <Panel>
      <ReadTable
        caption={t("classes.title")}
        rows={classes}
        rowKey={(c) => c.id}
        columns={[
          { key: "class", label: t("classes.col.class"), primary: true, cell: (c) => classPlace(c) },
          { key: "term", label: t("classes.col.term"), cell: (c) => c.termLabel },
          { key: "teacher", label: t("classes.col.classTeacher"), cell: (c) => (c.isClassTeacher ? <StatusWord tone="ok">{t("classes.you")}</StatusWord> : (c.classTeacher ?? t("classes.noClassTeacher"))) },
          { key: "students", label: t("classes.col.students"), align: "end", cell: (c) => String(c.students) },
          { key: "open", label: t("classes.col.open"), align: "end", plain: true, cell: (c) => <OpenLink href={`/portal/classes/class?id=${c.id}`} label={t("classes.openNamed", { name: classPlace(c) })} text={t("classes.open")} /> },
        ]}
      />
    </Panel>
  );
}

export function ClassesScreen() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadClassHubList(api), [api]);
  const { view, reload } = useLoad(loadNow);
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("classes.title")} subtitle={t("classes.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={5} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? <ClassesTable classes={view.data.classes} /> : null}
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
    return (
      <>
        {published.map((x) => (
          <ClassSheetView key={x.id} classId={hub.class.id} terminalId={x.id} exportable={hub.viewer.staff} />
        ))}
      </>
    );
  }
  if (hub.mySubjects.length === 0) return <EmptyLine>{t("classes.noSubjects")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("classes.yourMarks")}
      rows={hub.mySubjects.flatMap((s) => hub.terminals.map((x) => ({ key: `${s.offeringId}-${x.id}`, subject: s, terminal: x })))}
      rowKey={(r) => r.key}
      columns={[
        { key: "subject", label: t("classes.col.subject"), primary: true, cell: (r) => r.subject.name },
        { key: "exam", label: t("classes.col.exam"), cell: (r) => r.terminal.name },
        {
          key: "open",
          label: t("classes.col.open"),
          align: "end",
          plain: true,
          cell: (r) => (
            <OpenLink
              href={`/portal/results/sheet?class=${hub.class.id}&subject=${r.subject.offeringId}&terminal=${r.terminal.id}`}
              label={t("classes.marksNamed", { subject: r.subject.name, exam: r.terminal.name })}
              text={t("classes.open")}
            />
          ),
        },
      ]}
    />
  );
}

/** One class (`?id=`, and `&tab=` to open on a tab). */
export function ClassPageScreen() {
  const { api, me } = useSession();
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
  const tabs = classTabs(hub);
  const tab = pickTab(tabs, chosen ?? askedTab);
  const place = classPlace(hub.class);
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
        <Panel>
          <StudentsTable hub={hub} canOpenRecord={canOpenRecord} />
        </Panel>
      ) : null}
      {tab === "attendance" ? <ClassAttendanceScreen embedded /> : null}
      {tab === "classwork" ? <ClassActivityScreen embedded /> : null}
      {tab === "results" ? <ClassResults hub={hub} /> : null}
    </div>
  );
}
