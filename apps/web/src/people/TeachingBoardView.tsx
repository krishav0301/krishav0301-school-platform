"use client";

import { BookOpen, ChevronRight, Crown, LayoutGrid, Mail, Rows3, School, UsersRound } from "lucide-react";
import { useState } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { EmptyLine } from "@/read/ReadView";
import { Button } from "@/ui";

import { initials } from "./access-model";
import { FilterSelect, SearchBox } from "./ListParts";
import accessStyles from "./people-access.module.css";
import { filterMissing, filterTeachers, teachingBoard, type ClassRef, type TeacherStatus, type TeachingBoard } from "./teaching-board";
import type { ClassTeaching } from "./teaching-model";
import styles from "./teaching.module.css";
import { byTeacher, TeachersTable } from "./TeachingRead";
import type { SchoolClass } from "@/setup/model";

/** What the Principal's Teaching page shows, read only (PM, 2026-10-06: "just a UI design", no new actions). */
export interface BoardData {
  classes: SchoolClass[];
  teachings: ClassTeaching[];
  terms: { id: string; label: string }[];
  /** Teachers' emails by id, and how many teachers the school has; null when the staff list could not be read. */
  emails: Map<string, string>;
  allTeachers: number | null;
}

const SUBJECTS_SHOWN = 4;

/** The page below its header: figures, filters, the teachers, and the subjects without a teacher. Pure. */
/** `term`: the term chosen in the top bar (D-127), "" for every open term. */
export function TeachingBoardView({ data, term = "" }: { data: BoardData; term?: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TeacherStatus>("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const board = teachingBoard(data.classes, data.teachings, term);
  const teachers = filterTeachers(board.teachers, q, status);
  const termLabel = (id: string) => data.terms.find((x) => x.id === id)?.label ?? "";
  const filtered = Boolean(q || status);

  return (
    <>
      <Figures board={board} allTeachers={data.allTeachers} />

      <div className={styles.toolbar}>
        <SearchBox label="teaching.search" value={q} onChange={setQ} />
        <div className={accessStyles.filters}>
          <FilterSelect
            label="content.filterState"
            value={status}
            onChange={(v) => setStatus(v as TeacherStatus)}
            options={[
              { value: "", label: t("teaching.allTeachers") },
              { value: "lead", label: t("teaching.leads") },
              { value: "notLead", label: t("teaching.notLeads") },
            ]}
          />
          {filtered ? (
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                setStatus("");
              }}
            >
              {t("content.clearFilters")}
            </Button>
          ) : null}
        </div>
      </div>

      <section className={styles.board} aria-labelledby="teachers-title">
        <div className={styles.boardHead}>
          <div>
            <h2 id="teachers-title" className={styles.boardTitle}>
              {t("teaching.teachers.title", { n: teachers.length })}
            </h2>
            <p className={styles.muted}>{t("teaching.teachers.intro")}</p>
          </div>
          <div className={styles.views} role="group" aria-label={t("teaching.viewAs")}>
            <ViewButton icon={LayoutGrid} label="teaching.cardView" pressed={view === "cards"} onPress={() => setView("cards")} />
            <ViewButton icon={Rows3} label="teaching.tableView" pressed={view === "table"} onPress={() => setView("table")} />
          </div>
        </div>
        {teachers.length === 0 ? (
          <EmptyLine>{t(board.teachers.length === 0 ? "people.teaching.read.empty" : "teaching.noneFound")}</EmptyLine>
        ) : view === "cards" ? (
          <ul className={styles.cards}>
            {teachers.map((x) => (
              <TeacherCardView key={x.id} teacher={x} email={data.emails.get(x.id) ?? null} />
            ))}
          </ul>
        ) : (
          <TeachersTable teachers={byTeacher(data.classes, data.teachings).teachers.filter((line) => teachers.some((x) => x.id === line.id))} />
        )}
      </section>

      <Missing board={board} termLabel={termLabel} />
    </>
  );
}

function ViewButton({ icon: Icon, label, pressed, onPress }: { icon: typeof LayoutGrid; label: MessageKey; pressed: boolean; onPress: () => void }) {
  return (
    <button type="button" className={styles.viewButton} aria-pressed={pressed} onClick={onPress}>
      <Icon aria-hidden />
      {t(label)}
    </button>
  );
}

function Figures({ board, allTeachers }: { board: TeachingBoard; allTeachers: number | null }) {
  const f = board.figures;
  const cards: { icon: typeof BookOpen; tone: string; value: number; label: MessageKey; of?: string }[] = [
    { icon: UsersRound, tone: "primary", value: f.teachers, label: "teaching.fig.teachers", of: allTeachers === null ? undefined : t("teaching.fig.ofTeachers", { n: allTeachers }) },
    { icon: BookOpen, tone: "ok", value: f.assigned, label: "teaching.fig.assigned", of: t("teaching.fig.ofSubjects", { n: f.subjects }) },
    { icon: School, tone: "accent", value: f.classesTaught, label: "teaching.fig.classes", of: t("teaching.fig.ofClasses", { n: f.classes }) },
  ];
  return (
    <ul className={accessStyles.summary} aria-label={t("teaching.figures")}>
      {cards.map((c) => (
        <li key={c.label} className={accessStyles.summaryCard}>
          <span className={accessStyles.tile} data-tone={c.tone} aria-hidden>
            <c.icon />
          </span>
          <span className={accessStyles.summaryBody}>
            <span className={accessStyles.summaryValue}>{c.value}</span>
            <span>{t(c.label)}</span>
            {c.of ? <span className={accessStyles.muted}>{c.of}</span> : null}
          </span>
        </li>
      ))}
      <li className={accessStyles.summaryCard}>
        {/* The one figure to act on: it leads to its list below (the PM). */}
        <a href="#missing-teachers" className={styles.figureLink}>
          <span className={accessStyles.tile} data-tone="warn" aria-hidden>
            <BookOpen />
          </span>
          <span className={accessStyles.summaryBody}>
            <span className={accessStyles.summaryValue}>{f.missing}</span>
            <span>{t("teaching.fig.missing")}</span>
          </span>
          <ChevronRight aria-hidden className={styles.figureArrow} />
        </a>
      </li>
    </ul>
  );
}

function ClassChip({ cls }: { cls: ClassRef }) {
  return (
    <li className={styles.chip}>
      <span className={styles.chipMain}>{cls.name}</span>
      {cls.course ? <span className={styles.chipSub}>{cls.course}</span> : null}
    </li>
  );
}

/** One teacher: who, the subjects they teach, the classes they teach in, and apart, the class they lead. Pure. */
export function TeacherCardView({ teacher, email }: { teacher: TeachingBoard["teachers"][number]; email: string | null }) {
  const { term } = useConfig();
  const [allSubjects, setAllSubjects] = useState(false);
  const shown = allSubjects ? teacher.subjects : teacher.subjects.slice(0, SUBJECTS_SHOWN);
  const hidden = teacher.subjects.length - shown.length;
  return (
    <li className={styles.card}>
      <div className={styles.who}>
        <span className={accessStyles.avatar} aria-hidden>
          {initials(teacher.name)}
        </span>
        <span className={styles.whoText}>
          <h3 className={styles.name}>{teacher.name}</h3>
          <span className={styles.muted}>{term("role.teacher")}</span>
          {email ? (
            <span className={styles.email}>
              <Mail aria-hidden />
              {email}
            </span>
          ) : null}
        </span>
      </div>

      <div className={styles.part}>
        <h4 className={styles.partTitle}>
          <BookOpen aria-hidden />
          {t("teaching.subjects", { n: teacher.subjects.length })}
        </h4>
        {teacher.subjects.length === 0 ? (
          <p className={styles.muted}>{t("teaching.noSubjects")}</p>
        ) : (
          <ul className={styles.chips}>
            {shown.map((s) => (
              <li key={`${s.subject}-${s.course}`} className={styles.chip} data-kind="subject">
                <span className={styles.chipMain}>{s.subject}</span>
                {s.course ? <span className={styles.chipSub}>{s.course}</span> : null}
              </li>
            ))}
            {hidden > 0 ? (
              <li>
                <button type="button" className={styles.more} onClick={() => setAllSubjects(true)} aria-label={t("teaching.moreSubjectsOf", { n: hidden, name: teacher.name })}>
                  {t("teaching.more", { n: hidden })}
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <div className={styles.part}>
        <h4 className={styles.partTitle}>
          <UsersRound aria-hidden />
          {t("teaching.classes", { n: teacher.classes.length })}
        </h4>
        {teacher.classes.length === 0 ? (
          <p className={styles.muted}>{t("teaching.noClasses")}</p>
        ) : (
          <ul className={styles.chips}>
            {teacher.classes.map((c) => (
              <ClassChip key={c.classId} cls={c} />
            ))}
          </ul>
        )}
      </div>

      {/* Leading a class is a different job from teaching a subject (the PM): its own part, its own mark. */}
      <div className={styles.part} data-kind="lead">
        <h4 className={styles.partTitle}>
          <Crown aria-hidden className={styles.crown} />
          {t("teaching.classTeacher")}
        </h4>
        {teacher.classTeacherOf.length === 0 ? (
          <p className={styles.notLead}>{t("teaching.notClassTeacher")}</p>
        ) : (
          <ul className={styles.chips}>
            {teacher.classTeacherOf.map((c) => (
              <ClassChip key={c.classId} cls={c} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function Missing({ board, termLabel }: { board: TeachingBoard; termLabel: (id: string) => string }) {
  const [q, setQ] = useState("");
  const rows = filterMissing(board.missing, q);
  return (
    <section className={styles.board} aria-labelledby="missing-title" id="missing-teachers">
      <div className={styles.boardHead}>
        <div className={styles.missingHead}>
          <span className={accessStyles.tile} data-tone="warn" aria-hidden>
            <BookOpen />
          </span>
          <div>
            <h2 id="missing-title" className={styles.boardTitle}>{t("teaching.missing.title", { n: board.missing.length })}</h2>
            <p className={styles.muted}>{t("teaching.missing.intro")}</p>
          </div>
        </div>
        {board.missing.length > 0 ? <SearchBox label="teaching.missing.search" value={q} onChange={setQ} /> : null}
      </div>
      {board.missing.length === 0 ? (
        <EmptyLine>{t("teaching.missing.none")}</EmptyLine>
      ) : rows.length === 0 ? (
        <EmptyLine>{t("teaching.noneFound")}</EmptyLine>
      ) : (
        <table className={accessStyles.table}>
          <thead>
            <tr>
              <th scope="col">{t("teaching.col.subject")}</th>
              <th scope="col">{t("teaching.col.class")}</th>
              <th scope="col">{t("teaching.col.term")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key}>
                <td className={accessStyles.nameCell}>
                  <span className={accessStyles.personName}>{m.subject}</span>
                </td>
                <td data-label={t("teaching.col.class")}>
                  <span className={accessStyles.cellMain}>{m.cls.name}</span>
                  {m.cls.course ? <span className={accessStyles.muted}>{m.cls.course}</span> : null}
                </td>
                <td data-label={t("teaching.col.term")}>{termLabel(m.cls.termId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
