"use client";

import { useCallback } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { ReadFailure, ReadOnlyNote, ReadTable, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { loadClasses, loadYears, type Loaded } from "@/setup/client";
import { classTitle, type SchoolClass } from "@/setup/model";
import { ReadSetupHeader } from "@/setup/ReadSetup";
import { useLoad } from "@/setup/useLoad";

import { loadPeople } from "./access-client";
import { loadYearTeaching } from "./teaching-client";
import { TeachingBoardView, type BoardData } from "./TeachingBoardView";
import type { ClassTeaching } from "./teaching-model";

export interface TeacherLine {
  id: string;
  name: string;
  teaches: string[];
  classTeacherOf: string[];
}

/** Who teaches what, by teacher (D-104): each teacher's subjects and classes, and the class they lead. Pure. */
export function byTeacher(classes: readonly SchoolClass[], teachings: readonly ClassTeaching[]): { teachers: TeacherLine[]; unassigned: number } {
  const lines = new Map<string, TeacherLine>();
  const line = (id: string, name: string) => lines.get(id) ?? lines.set(id, { id, name, teaches: [], classTeacherOf: [] }).get(id)!;
  const classById = new Map(classes.map((c) => [c.id, c]));
  let unassigned = 0;
  for (const teaching of teachings) {
    const cls = classById.get(teaching.classId);
    const name = cls ? classTitle(cls) : teaching.levelName;
    if (teaching.classTeacher) line(teaching.classTeacher.id, teaching.classTeacher.fullName).classTeacherOf.push(name);
    for (const a of teaching.assignments) {
      if (a.teacher) line(a.teacher.id, a.teacher.fullName).teaches.push(t("people.teaching.read.subjectIn", { subject: a.subjectName, class: name }));
      else unassigned += 1;
    }
  }
  return { teachers: [...lines.values()].sort((a, b) => a.name.localeCompare(b.name)), unassigned };
}

/** Teaching as the Principal reads it: every teacher in the open terms, what they teach where, and the class they lead. */
export function TeachingRead() {
  const { api } = useSession();
  const { term } = useConfig();
  // The terms, then each open term's classes and teaching together (D-108): every open term, not only the first (D-114).
  const loadNow = useCallback(async (): Promise<Loaded<BoardData>> => {
    const [years, staff] = await Promise.all([loadYears(api), loadPeople(api, { group: "teaching", pageSize: 50 })]);
    if (!years.ok) return { ok: false, reason: years.reason };
    const open = years.data.years.filter((y) => y.status !== "closed");
    const loaded = await Promise.all(open.map((y) => Promise.all([loadClasses(api, y.id), loadYearTeaching(api, y.id)])));
    const classes: SchoolClass[] = [];
    const teachings: ClassTeaching[] = [];
    for (const [c, tg] of loaded) {
      if (!c.ok) return { ok: false, reason: c.reason };
      if (!tg.ok) return { ok: false, reason: tg.reason };
      classes.push(...c.data.classes.filter((x) => x.active));
      teachings.push(...tg.data);
    }
    // OPEN: only the first 50 teachers (by name) get their email shown (D-124).
    // Emails and the number of teachers only dress the page; without the staff list it still shows (UI only, PM 2026-10-06).
    const emails = new Map(staff.ok ? staff.people.map((p) => [p.id, p.email] as const) : []);
    return { ok: true, data: { classes, teachings, terms: open.map((y) => ({ id: y.id, label: y.label })), emails, allTeachers: staff.ok ? staff.counts.teachers : null } };
  }, [api]);
  const { view, reload } = useLoad(loadNow);

  return (
    <div className={readStyles.page}>
      <ReadSetupHeader title={t("people.teaching.title")} subtitle={t("people.teaching.read.subtitle")} />
      {view.status === "loading" ? <TableSkeleton rows={6} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? <TeachingBoardView data={view.data} /> : null}
      <ReadOnlyNote>{t("setup.read.readOnly", { coordinator: term("role.coordinator") })}</ReadOnlyNote>
    </div>
  );
}

export function TeachersTable({ teachers }: { teachers: readonly TeacherLine[] }) {
  return (
    <ReadTable
      caption={t("people.teaching.title")}
      rows={teachers}
      rowKey={(x) => x.id}
      columns={[
        { key: "name", label: t("people.teaching.read.teacher"), primary: true, cell: (x) => x.name },
        { key: "teaches", label: t("people.teaching.read.teaches"), cell: (x) => (x.teaches.length === 0 ? "—" : x.teaches.join(" · ")) },
        { key: "lead", label: t("people.teaching.read.classTeacherOf"), cell: (x) => (x.classTeacherOf.length === 0 ? <StatusWord>{t("people.teaching.read.noClass")}</StatusWord> : x.classTeacherOf.join(", ")) },
      ]}
    />
  );
}
