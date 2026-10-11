"use client";

import { ArrowRight, Users } from "lucide-react";
import { Fragment, useCallback } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { ReadHeader, StatusWord } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useTermChoice } from "@/shell/TermChoice";

import { loadSetupMap } from "./client";
import { formatHundredths, termWords, type SetupMap } from "./model";
import { Gate, useLoad } from "./useLoad";
import styles from "./setup-map.module.css";

type Term = SetupMap["terms"][number];
type Level = Term["wings"][number]["departments"][number]["levels"][number];
type Section = Level["sections"][number];

/** The arrow between two boxes: it points right where there is room and down where there is not. */
function Arrow() {
  return <ArrowRight aria-hidden className={styles.arrow} />;
}

function Node({ kind, name, detail }: { kind: string; name: string; detail?: string }) {
  return (
    <div className={styles.node}>
      <span className={styles.kind}>{kind}</span>
      <span className={styles.name}>{name}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
    </div>
  );
}

/** The term's exam pattern, and the terminals it runs, as the first box of the chart (D-117). */
export function ExamNode({ term }: { term: Term }) {
  const { exam } = term;
  if (!exam) return <Node kind={t("setup.map.exam")} name={t("setup.map.noExam")} />;
  const detail = [
    exam.graded ? t("setup.map.graded") : t("setup.map.notGraded"),
    t("setup.map.minimum", { theory: String(exam.theoryMinPercent), practical: String(exam.practicalMinPercent) }),
  ].join(" · ");
  return (
    <div className={styles.node}>
      <span className={styles.kind}>{t("setup.map.exam")}</span>
      <span className={styles.name}>{t("setup.map.examOutOf")}</span>
      <span className={styles.detail}>{detail}</span>
      {exam.terminals.length === 0 ? (
        <span className={styles.detail}>{t("setup.map.noTerminals")}</span>
      ) : (
        <ul className={styles.chips} aria-label={t("setup.map.terminals")}>
          {exam.terminals.map((x, i) => (
            <li key={i} className={styles.chip}>
              {x.name}
              {x.weight === null ? "" : ` · ${x.weight}%`}
              {x.hasPractical ? ` · ${t("setup.map.withPractical")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One section of a level: its Class Teacher, its students, and who teaches each subject in it. */
function SectionNode({ section, level, name }: { section: Section; level: Level; name: string }) {
  const { term: word } = useConfig();
  const teacherOf = new Map(section.teachers.map((x) => [x.subjectId, x.teacher]));
  return (
    <div className={styles.node} data-section>
      <span className={styles.kind}>{termWords(word).classSection}</span>
      <span className={styles.name}>{name}</span>
      <span className={styles.detail}>{section.classTeacher ? t("setup.map.classTeacher", { name: section.classTeacher }) : t("setup.map.noClassTeacher")}</span>
      {level.subjects.length === 0 ? null : (
        <ul className={styles.teaching} aria-label={t("setup.map.teaching")}>
          {level.subjects.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <span className={teacherOf.has(s.id) ? undefined : styles.missing}>{teacherOf.get(s.id) ?? t("setup.map.noTeacher")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Students({ n }: { n: number }) {
  return (
    <div className={styles.node} data-students>
      <span className={styles.kind}>
        <Users aria-hidden className={styles.kindIcon} />
        {t("setup.map.students")}
      </span>
      <span className={styles.name}>{n}</span>
    </div>
  );
}

/** One level: its subjects, then each of its sections flowing on to its students. */
function LevelFlow({ level }: { level: Level }) {
  const { term: word } = useConfig();
  const words = termWords(word);
  return (
    <li className={styles.flow}>
      <Node kind={words.level} name={level.name} detail={level.subjects.length === 0 ? t("setup.map.noSubjects") : undefined} />
      {level.subjects.length > 0 ? (
        <>
          <Arrow />
          <div className={styles.node}>
            <span className={styles.kind}>{t("setup.map.subjects")}</span>
            <ul className={styles.chips}>
              {level.subjects.map((s) => (
                <li key={s.id} className={styles.chip}>
                  {s.name}
                  {s.practicalHundredths === null ? "" : ` · ${t("setup.map.withPractical")}`}
                  {s.group ? ` · ${s.group}` : ""}
                  {s.fullMarksHundredths === 10_000 ? "" : ` · ${formatHundredths(s.fullMarksHundredths)}`}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
      <Arrow />
      {level.sections.length === 0 ? (
        <Node kind={words.classSection} name={t("setup.map.noSections")} />
      ) : (
        <ul className={styles.sections}>
          {level.sections.map((s) => (
            <li key={s.id} className={styles.sectionRow}>
              <SectionNode section={s} level={level} name={s.label || t("setup.map.unnamedSection")} />
              <Arrow />
              <Students n={s.students} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The chart of one term: Term, then its Exam, then Wing, Department and Level flowing on to sections and students. */
export function TermFlow({ term }: { term: Term }) {
  const { term: word } = useConfig();
  const words = termWords(word);
  return (
    <section className={styles.term} aria-label={term.label}>
      <div className={styles.termHead}>
        <h2 className={styles.termName}>{term.label}</h2>
        <StatusWord tone={term.status === "active" ? "ok" : "neutral"}>{t(term.status === "active" ? "setup.map.active" : "setup.map.draft")}</StatusWord>
      </div>
      <div className={styles.flow}>
        <Node kind={t("setup.map.term")} name={term.label} />
        <Arrow />
        <ExamNode term={term} />
      </div>
      {term.wings.length === 0 ? (
        <p className={styles.empty}>{t("setup.map.noLevels", words)}</p>
      ) : (
        term.wings.map((wing) => (
          <div key={wing.key} className={styles.wing}>
            {wing.departments.map((department) => (
              <Fragment key={department.id}>
                <div className={styles.flow}>
                  <Node kind={words.section} name={wing.name} />
                  <Arrow />
                  <Node kind={words.programme} name={department.name} />
                </div>
                <ul className={styles.levels}>
                  {department.levels.map((level) => (
                    <LevelFlow key={level.id} level={level} />
                  ))}
                </ul>
              </Fragment>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

export function SetupMapView({ map }: { map: SetupMap }) {
  const { term } = useConfig();
  const words = termWords(term);
  if (map.terms.length === 0) return <p className={styles.empty}>{t("setup.map.noTerms")}</p>;
  return (
    <div className={styles.chart}>
      <p className={styles.legend}>{t("setup.map.legend", words)}</p>
      {map.terms.map((x) => (
        <TermFlow key={x.id} term={x} />
      ))}
    </div>
  );
}

/** The setup map (the PM, 2026-10-10): the whole setup of the chosen term, or of every open term, as a chart. */
export function SetupMapScreen() {
  const { api } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const { choice } = useTermChoice();
  const load = useCallback(() => loadSetupMap(api, choice), [api, choice]);
  const { view, reload } = useLoad(load);
  return (
    <>
      <ReadHeader title={t("setup.map.title")} subtitle={t("setup.map.intro", words)} />
      <Gate view={view} onRetry={() => void reload()}>
        {(map) => <SetupMapView map={map} />}
      </Gate>
    </>
  );
}
