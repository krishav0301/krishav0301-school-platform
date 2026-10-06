"use client";

import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { EmptyLine, Panel, ReadHeader, ReadTable, StatusWord, readStyles, type Column } from "@/read/ReadView";

import { classTitle, formatHundredths, type Curriculum, type SchoolClass, type Subject, type Terminal } from "./model";

/**
 * School setup as the Principal reads it (D-104, after the PM's topic 7 reference): the same facts the Co-ordinator
 * manages, in the read pages' language. A header that leads back to Reports, tables with status in words, no controls.
 */
/** The school's own words in the middle of a sentence: "the terminals of the year", not "the Terminals". */
export const midSentence = (words: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(words).map(([k, v]) => [k, v.toLowerCase()]));

/**
 * The Co-ordinator's controls on a row (D-106): the same tables the Principal reads, with one more column. On a phone
 * the control sits at the end of its stacked row with no label before it.
 */
export interface RowAction<R> {
  label: string;
  cell: (row: R) => ReactNode;
}

const withAction = <R,>(columns: Column<R>[], action?: RowAction<R>): Column<R>[] =>
  action ? [...columns, { key: "action", label: action.label, align: "end", plain: true, cell: (row: R) => action.cell(row) }] : columns;

export function ReadSetupHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <ReadHeader title={title} subtitle={subtitle} crumbs={[{ label: t("reports.title"), href: "/portal/reports" }, { label: title }]} />;
}

export function ClassesTable({ classes, action }: { classes: readonly SchoolClass[]; action?: RowAction<SchoolClass> }) {
  if (classes.length === 0) return <EmptyLine>{t("setup.classes.empty")}</EmptyLine>;
  return (
    <Panel>
      <ReadTable
        caption={t("setup.classes.title")}
        rows={classes}
        rowKey={(c) => c.id}
        columns={withAction(
          [
            { key: "class", label: t("attendance.col.class"), primary: true, cell: (c) => classTitle(c) },
            { key: "programme", label: t("setup.read.programme"), cell: (c) => c.programmeName },
            { key: "level", label: t("setup.read.level"), cell: (c) => c.levelName },
            { key: "status", label: t("attendance.class.status"), cell: (c) => (c.active ? <StatusWord tone="ok">{t("setup.read.inUse")}</StatusWord> : <StatusWord>{t("setup.classes.off")}</StatusWord>) },
          ],
          action,
        )}
      />
    </Panel>
  );
}

export function TerminalsTable({ terminals, words }: { terminals: readonly Terminal[]; words: Record<string, string> }) {
  if (terminals.length === 0) return <EmptyLine>{t("setup.terminals.empty", words)}</EmptyLine>;
  return (
    <Panel>
      <ReadTable
        caption={t("setup.terminals.title", words)}
        rows={terminals}
        rowKey={(x) => x.id}
        columns={[
          { key: "n", label: "#", cell: (x) => <span className={readStyles.number}>{x.ordinal}</span> },
          { key: "name", label: t("setup.read.name"), primary: true, cell: (x) => x.name },
        ]}
      />
    </Panel>
  );
}

export function SubjectsTable({
  subjects,
  action,
  empty = "setup.subjects.emptyReadOnly",
  wings = [],
}: {
  subjects: readonly Subject[];
  action?: RowAction<Subject>;
  empty?: "setup.subjects.emptyReadOnly" | "setup.subjects.empty";
  /** The school's wings, to name each subject's (D-114). */
  wings?: readonly { key: string; name: string }[];
}) {
  if (subjects.length === 0) return <EmptyLine>{t(empty)}</EmptyLine>;
  const wingName = (key: string | null) => (key === null ? null : (wings.find((w) => w.key === key)?.name ?? key));
  return (
    <Panel>
      <ReadTable
        caption={t("setup.subjects.title")}
        rows={subjects}
        rowKey={(x) => x.id}
        columns={withAction(
          [
            { key: "name", label: t("setup.read.subject"), primary: true, cell: (x) => x.name },
            { key: "code", label: t("setup.read.code"), cell: (x) => x.code ?? "—" },
            { key: "wing", label: t("setup.subjects.wing"), cell: (x) => wingName(x.sectionKey) ?? <StatusWord tone="warn">{t("setup.subjects.noWing")}</StatusWord> },
            { key: "status", label: t("attendance.class.status"), cell: (x) => (x.archived ? <StatusWord>{t("setup.subjects.archived")}</StatusWord> : <StatusWord tone="ok">{t("setup.read.inUse")}</StatusWord>) },
          ],
          action,
        )}
      />
    </Panel>
  );
}

/** One level's curriculum, read: each subject with its credit hours, how it is marked, and its elective group in words. */
export function CurriculumTable({ curriculum }: { curriculum: Curriculum }) {
  const offerings = curriculum.offerings.filter((o) => o.active);
  if (offerings.length === 0) return <EmptyLine>{t("setup.read.noSubjects")}</EmptyLine>;
  const groupLine = (groupId: string) => {
    const group = curriculum.groups.find((g) => g.id === groupId);
    const names = offerings.filter((o) => o.group?.id === groupId).map((o) => o.subject.name);
    return t("setup.read.choose", { n: group?.pickCount ?? 1, names: names.join(", ") });
  };
  return (
    <Panel title={`${curriculum.level.programmeName} · ${curriculum.level.name}`} labelledBy="curriculum-level">
      <ReadTable
        caption={t("setup.curriculum.subjects")}
        rows={offerings}
        rowKey={(o) => o.id}
        columns={[
          { key: "subject", label: t("setup.read.subject"), primary: true, cell: (o) => o.subject.name },
          { key: "credit", label: t("setup.read.credit"), align: "end", cell: (o) => (o.creditHundredths === null ? "—" : formatHundredths(o.creditHundredths)) },
          {
            key: "marks",
            label: t("setup.curriculum.marks"),
            cell: (o) =>
              o.components.filter((c) => c.active).length === 0
                ? "—"
                : o.components
                    .filter((c) => c.active)
                    .map((c) => t("setup.read.markPart", { name: c.name, max: formatHundredths(c.maxHundredths) }))
                    .join(" · "),
          },
          { key: "group", label: t("setup.read.elective"), cell: (o) => (o.group ? groupLine(o.group.id) : t("setup.read.compulsory")) },
        ]}
      />
    </Panel>
  );
}
