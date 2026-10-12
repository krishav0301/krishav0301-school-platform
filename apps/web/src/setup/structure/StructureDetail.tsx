"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { t } from "@/i18n/messages";
import { Facts, PanelSection, SidePanel } from "@/read/SidePanel";
import { Button } from "@/ui";

import { formatHundredths } from "../model";
import type { Counts, StructNode } from "./model";
import { ICONS, kindWord, metaLine, nodeTitle, type Words } from "./parts";
import styles from "./structure.module.css";

/** Who may change what is shown here: only tidiness, the API decides (D-025). Without it the panel only reads and links to what a person can open. */
export interface Reach {
  /** The Co-ordinator and Support: curriculum, teaching and the exam pattern. */
  structure: boolean;
  /** The Principal and Support: wings, courses and levels. */
  programmes: boolean;
}

const GO = {
  programmes: "/portal/setup/programmes",
  exam: "/portal/setup/terminals",
  curriculum: "/portal/setup/curriculum",
  teaching: "/portal/setup/teaching",
  classPage: (id: string) => `/portal/classes/class?id=${id}`,
  students: (id: string) => `/portal/classes/class?id=${id}&tab=students`,
} as const;

const Action = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className={styles.action}>
    {children}
  </Link>
);

function CountFacts({ counts, which }: { counts: Counts; which: readonly (keyof Counts)[] }) {
  const name: Record<keyof Counts, string> = { courses: t("structure.fact.courses"), classes: t("structure.fact.classes"), sections: t("structure.fact.sections"), students: t("structure.fact.students") };
  return <Facts rows={which.map((k) => ({ name: name[k], value: String(counts[k]) }))} />;
}

/** What a chosen box holds, as a side panel: facts, then where to go to look at it or change it. Nothing is stored here. */
export function StructureDetail({ node, words, reach, termHref, canFocus, onFocus, onClose }: { node: StructNode; words: Words; reach: Reach; termHref: string; canFocus: boolean; onFocus: () => void; onClose: () => void }) {
  const Icon = ICONS[node.kind];
  const p = node.payload;
  return (
    <SidePanel
      title={nodeTitle(node)}
      subtitle={`${kindWord(node.kind, words)} · ${metaLine(node)}`}
      lead={
        <span className={styles.nodeIcon} data-kind={node.kind} aria-hidden>
          <Icon />
        </span>
      }
      onClose={onClose}
      foot={canFocus ? <Button variant="secondary" onClick={onFocus}>{t("structure.focus")}</Button> : undefined}
    >
      {p.kind === "term" ? (
        <>
          {p.term.exam ? (
            <PanelSection title={t("setup.map.exam")}>
              <Facts
                rows={[
                  { name: t("structure.exam.format"), value: t("setup.map.examOutOf") },
                  { name: t("structure.exam.graded"), value: p.term.exam.graded ? t("structure.yes") : t("structure.no") },
                  { name: t("structure.exam.minimum"), value: t("setup.map.minimum", { theory: String(p.term.exam.theoryMinPercent), practical: String(p.term.exam.practicalMinPercent) }) },
                ]}
              />
              {p.term.exam.terminals.length === 0 ? (
                <p className={styles.muted}>{t("setup.map.noTerminals")}</p>
              ) : (
                <ul className={styles.plainList} aria-label={t("setup.map.terminals")}>
                  {p.term.exam.terminals.map((x, i) => (
                    <li key={i}>
                      {x.name}
                      {x.weight === null ? "" : ` · ${x.weight}%`}
                      {x.hasPractical ? ` · ${t("setup.map.withPractical")}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>
          ) : (
            <p className={styles.muted}>{t("setup.map.noExam")}</p>
          )}
          <div className={styles.actions}>
            <Action href={termHref}>{t("structure.action.term")}</Action>
            {reach.structure ? <Action href={GO.exam}>{t("structure.action.exam")}</Action> : null}
          </div>
        </>
      ) : null}

      {p.kind === "wing" ? (
        <>
          <CountFacts counts={node.counts} which={["courses", "classes", "sections", "students"]} />
          {reach.programmes ? (
            <div className={styles.actions}>
              <Action href={GO.programmes}>{t("structure.action.programmes")}</Action>
            </div>
          ) : null}
        </>
      ) : null}

      {p.kind === "course" ? (
        <>
          <CountFacts counts={node.counts} which={["classes", "sections", "students"]} />
          {reach.programmes ? (
            <div className={styles.actions}>
              <Action href={GO.programmes}>{t("structure.action.programmes")}</Action>
            </div>
          ) : null}
        </>
      ) : null}

      {p.kind === "level" ? (
        <>
          <CountFacts counts={node.counts} which={["sections", "students"]} />
          <PanelSection title={t("setup.map.subjects")}>
            {p.level.subjects.length === 0 ? (
              <p className={styles.muted}>{t("setup.map.noSubjects")}</p>
            ) : (
              <ul className={styles.chips}>
                {p.level.subjects.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
            )}
          </PanelSection>
          <PanelSection title={words.classSection}>
            {p.level.sections.length === 0 ? (
              <p className={styles.muted}>{t("setup.map.noSections")}</p>
            ) : (
              <ul className={styles.plainList}>
                {p.level.sections.map((s) => (
                  <li key={s.id}>
                    <Link href={GO.classPage(s.id)}>{s.label || t("setup.map.unnamedSection")}</Link>
                    {` · ${t(s.students === 1 ? "classes.studentsOne" : "classes.studentsMany", { n: s.students })}`}
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>
          {reach.structure ? (
            <div className={styles.actions}>
              <Action href={GO.curriculum}>{t("structure.action.curriculum")}</Action>
            </div>
          ) : null}
        </>
      ) : null}

      {p.kind === "subjects" ? (
        <>
          <ul className={styles.plainList}>
            {p.level.subjects.map((s) => (
              <li key={s.id}>
                {s.name}
                {s.practicalHundredths === null ? "" : ` · ${t("setup.map.withPractical")}`}
                {s.group ? ` · ${s.group}` : ""}
                {s.fullMarksHundredths === 10_000 ? "" : ` · ${formatHundredths(s.fullMarksHundredths)}`}
              </li>
            ))}
          </ul>
          {reach.structure ? (
            <div className={styles.actions}>
              <Action href={GO.curriculum}>{t("structure.action.curriculum")}</Action>
            </div>
          ) : null}
        </>
      ) : null}

      {p.kind === "section" ? (
        <>
          <Facts
            rows={[
              { name: t("structure.fact.classTeacher"), value: p.section.classTeacher ?? t("setup.map.noClassTeacher") },
              { name: t("structure.fact.students"), value: String(p.section.students) },
            ]}
          />
          <PanelSection title={t("setup.map.teaching")}>
            {p.level.subjects.length === 0 ? (
              <p className={styles.muted}>{t("setup.map.noSubjects")}</p>
            ) : (
              <ul className={styles.plainList}>
                {p.level.subjects.map((s) => {
                  const teacher = p.section.teachers.find((x) => x.subjectId === s.id)?.teacher;
                  return (
                    <li key={s.id}>
                      {s.name}: <span className={teacher ? undefined : styles.missing}>{teacher ?? t("setup.map.noTeacher")}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelSection>
          <div className={styles.actions}>
            <Action href={GO.classPage(p.section.id)}>{t("structure.action.class")}</Action>
            <Action href={GO.students(p.section.id)}>{t("structure.action.students", { n: p.section.students })}</Action>
            {reach.structure ? <Action href={GO.teaching}>{t("structure.action.teachers")}</Action> : null}
          </div>
        </>
      ) : null}
    </SidePanel>
  );
}
