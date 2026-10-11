"use client";

import { ArrowRight, CornerDownRight, Users } from "lucide-react";
import Link from "next/link";
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

/** Where each box opens (the PM, 2026-10-11): the screen where that part of the setup is looked at or changed. */
const GO = {
  structure: "/portal/setup/programmes",
  exam: "/portal/setup/terminals",
  curriculum: "/portal/setup/curriculum",
  teaching: "/portal/setup/teaching",
  classPage: (id: string) => `/portal/classes/class?id=${id}`,
  students: (id: string) => `/portal/classes/class?id=${id}&tab=students`,
} as const;

/** The arrow between two boxes: it points right where there is room and down where there is not. */
function Arrow() {
  return <ArrowRight aria-hidden className={styles.arrow} />;
}

/** One box. With an `href` the whole box is a link, so a person can go from the picture to the screen behind it. */
function Box({ href, label, children, ...rest }: { href?: string; label?: string; children: React.ReactNode } & { [key: `data-${string}`]: true | undefined }) {
  return href ? (
    <Link href={href} className={styles.node} aria-label={label} {...rest}>
      {children}
    </Link>
  ) : (
    <div className={styles.node} {...rest}>
      {children}
    </div>
  );
}

function Node({ kind, name, detail, href }: { kind: string; name: string; detail?: string; href?: string }) {
  return (
    <Box href={href} label={href ? t("setup.map.open", { kind, name }) : undefined}>
      <span className={styles.kind}>{kind}</span>
      <span className={styles.name}>{name}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
    </Box>
  );
}

/** The term's exam pattern, and the terminals it runs, as the first box of the chart (D-117). */
export function ExamNode({ term }: { term: Term }) {
  const { exam } = term;
  if (!exam) return <Node kind={t("setup.map.exam")} name={t("setup.map.noExam")} href={GO.exam} />;
  const detail = [
    exam.graded ? t("setup.map.graded") : t("setup.map.notGraded"),
    t("setup.map.minimum", { theory: String(exam.theoryMinPercent), practical: String(exam.practicalMinPercent) }),
  ].join(" · ");
  return (
    <Box href={GO.exam} label={t("setup.map.open", { kind: t("setup.map.exam"), name: term.label })}>
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
    </Box>
  );
}

/** One section of a level: its Class Teacher, its students, and who teaches each subject in it. It opens the class. */
function SectionNode({ section, level, name }: { section: Section; level: Level; name: string }) {
  const { term: word } = useConfig();
  const kind = termWords(word).classSection;
  const teacherOf = new Map(section.teachers.map((x) => [x.subjectId, x.teacher]));
  return (
    <Box href={GO.classPage(section.id)} label={t("setup.map.open", { kind, name })} data-section>
      <span className={styles.kind}>{kind}</span>
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
    </Box>
  );
}

function Students({ id, n }: { id: string; n: number }) {
  return (
    <Box href={GO.students(id)} label={t("setup.map.openStudents", { n: String(n) })} data-students>
      <span className={styles.kind}>
        <Users aria-hidden className={styles.kindIcon} />
        {t("setup.map.students")}
      </span>
      <span className={styles.name}>{n}</span>
    </Box>
  );
}

/** One level: first the level and its subjects, then below them each section, flowing on to its students. */
function LevelFlow({ level }: { level: Level }) {
  const { term: word } = useConfig();
  const words = termWords(word);
  return (
    <li className={styles.level}>
      <div className={styles.flow}>
        <Node kind={words.level} name={level.name} detail={level.subjects.length === 0 ? t("setup.map.noSubjects") : undefined} href={GO.curriculum} />
        {level.subjects.length > 0 ? (
          <>
            <Arrow />
            <Box href={GO.curriculum} label={t("setup.map.open", { kind: t("setup.map.subjects"), name: level.name })}>
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
            </Box>
          </>
        ) : null}
      </div>
      {level.sections.length === 0 ? (
        <div className={styles.under}>
          <CornerDownRight aria-hidden className={styles.arrow} />
          <Node kind={words.classSection} name={t("setup.map.noSections")} />
        </div>
      ) : (
        <ul className={styles.sections}>
          {level.sections.map((s) => (
            <li key={s.id} className={styles.sectionRow}>
              <CornerDownRight aria-hidden className={styles.arrow} />
              <SectionNode section={s} level={level} name={s.label || t("setup.map.unnamedSection")} />
              <Arrow />
              <Students id={s.id} n={s.students} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The chart of one term: Term, then its Exam, then Wing, Department and Level flowing on to sections and students. */
export function TermFlow({ term, termHref = "/portal/setup" }: { term: Term; termHref?: string }) {
  const { term: word } = useConfig();
  const words = termWords(word);
  return (
    <section className={styles.term} aria-label={term.label}>
      <div className={styles.termHead}>
        <h2 className={styles.termName}>{term.label}</h2>
        <StatusWord tone={term.status === "active" ? "ok" : "neutral"}>{t(term.status === "active" ? "setup.map.active" : "setup.map.draft")}</StatusWord>
      </div>
      <div className={styles.flow}>
        <Node kind={t("setup.map.term")} name={term.label} href={termHref} />
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
                  <Node kind={words.section} name={wing.name} href={GO.structure} />
                  <Arrow />
                  <Node kind={words.programme} name={department.name} href={GO.structure} />
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

/** `termHref`: where the term's box opens, which differs by who is looking (the Principal's own Academic Term page, or Setup's). */
export function SetupMapView({ map, termHref }: { map: SetupMap; termHref?: string }) {
  const { term } = useConfig();
  const words = termWords(term);
  if (map.terms.length === 0) return <p className={styles.empty}>{t("setup.map.noTerms")}</p>;
  return (
    <div className={styles.chart}>
      <p className={styles.legend}>{t("setup.map.legend", words)}</p>
      {map.terms.map((x) => (
        <TermFlow key={x.id} term={x} termHref={termHref} />
      ))}
    </div>
  );
}

/** The setup overview (the PM, 2026-10-10): the whole setup of the chosen term, or of every open term, as a chart. */
export function SetupMapScreen() {
  const { api, me } = useSession();
  const { term } = useConfig();
  const words = termWords(term);
  const { choice } = useTermChoice();
  const load = useCallback(() => loadSetupMap(api, choice), [api, choice]);
  const { view, reload } = useLoad(load);
  // The Principal makes and opens the terms on their own page; the Co-ordinator reads them in Setup.
  const termHref = me?.roles.some((r) => r.role === "admin") && !me.roles.some((r) => r.role === "coordinator" || r.role === "super_admin") ? "/portal/terms" : "/portal/setup";
  return (
    <>
      <ReadHeader title={t("setup.map.title")} subtitle={t("setup.map.intro", words)} />
      <Gate view={view} onRetry={() => void reload()}>
        {(map) => <SetupMapView map={map} termHref={termHref} />}
      </Gate>
    </>
  );
}
