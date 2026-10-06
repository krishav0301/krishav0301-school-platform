"use client";

import { GraduationCap, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { t, type MessageKey } from "@/i18n/messages";
import { initials } from "@/people/access-model";
import { FilterSelect, ListSkeleton, Pager, SearchBox } from "@/people/ListParts";
import styles from "@/people/people-access.module.css";
import { useSession } from "@/session/SessionProvider";
import { Button, Notice, Skeleton } from "@/ui";

import { browseStudents, type BrowsedStudent, type StudentBrowse, type StudentFilter } from "./client";

const PAGE_SIZE = 10;

/**
 * The Students page (PM, 2026-10-06), on the People & Access layout: the counts on top, then every student straight
 * away, narrowed by wing, course, level and class (each list offering only what has students, and each shown once the
 * one before it is chosen), a search, a status and a term; paged on the server.
 */
export function StudentsScreen() {
  const list = useStudents();
  const data = list.view.status === "ready" ? list.view : null;
  return (
    <div className={styles.page}>
      <div className={styles.topMain}>
        <h1 className={styles.title}>{t("students.title")}</h1>
        <p className={styles.intro}>{t("students.intro")}</p>
        <Summary counts={list.counts} />
      </div>

      <section className={styles.panel} aria-label={t("students.list")}>
        <div className={styles.panelHead}>
          <div className={styles.panelTools}>
            <SearchBox label="students.search" value={list.typed} onChange={list.setTyped} />
          </div>
        </div>
        <StudentFilters filters={list.filters} data={list.lists} onChange={list.filterBy} />

        <ListState view={list.view} filtered={list.filtered} onRetry={list.reload} onClear={list.clear} />
        {data && data.students.length > 0 ? (
          <>
            <StudentsTable students={data.students} />
            <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={list.setPage} noun="students.showing" />
          </>
        ) : null}
      </section>
    </div>
  );
}

// --- Loading, filters, paging --------------------------------------------------------------------

type View = { status: "loading" } | ({ status: "ready" } & StudentBrowse) | { status: "failed" | "forbidden" };

export interface Filters {
  q: string;
  term: string;
  status: "" | "left" | "graduated" | "all";
  wing: string;
  course: string;
  level: string;
  class: string;
}
const NO_FILTERS: Filters = { q: "", term: "", status: "", wing: "", course: "", level: "", class: "" };

/**
 * A changed filter clears the ones under it: a new term or status can change which wings have students, a new wing
 * which courses, and so on down. Pure.
 */
export function nextFilters(current: Filters, patch: Partial<Filters>): Filters {
  const next = { ...current, ...patch };
  if ("term" in patch || "status" in patch) return { ...next, wing: "", course: "", level: "", class: "" };
  if ("wing" in patch) return { ...next, course: "", level: "", class: "" };
  if ("course" in patch) return { ...next, level: "", class: "" };
  if ("level" in patch) return { ...next, class: "" };
  return next;
}

/** Loads one page as the filters change; the newest request wins. The counts and lists stay while a new page loads. */
function useStudents() {
  const { api } = useSession();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<View>({ status: "loading" });
  const [lists, setLists] = useState<Pick<StudentBrowse, "wings" | "terms"> | null>(null);
  const [counts, setCounts] = useState<StudentBrowse["counts"] | null>(null);

  useEffect(() => {
    let active = true;
    const query: StudentFilter = { page, pageSize: PAGE_SIZE };
    for (const key of ["q", "term", "wing", "course", "level", "class"] as const) if (filters[key]) query[key] = filters[key];
    if (filters.status) query.status = filters.status;
    void browseStudents(api, query).then((result) => {
      if (!active) return;
      if (!result.ok) return setView({ status: result.reason });
      const lastPage = Math.max(1, Math.ceil(result.data.total / PAGE_SIZE));
      if (page > lastPage) return setPage(lastPage);
      setView({ status: "ready", ...result.data });
      setLists({ wings: result.data.wings, terms: result.data.terms });
      setCounts(result.data.counts);
    });
    return () => {
      active = false;
    };
  }, [api, filters, page, version]);

  // The search goes a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== filters.q) {
        setFilters((f) => ({ ...f, q: typed.trim() }));
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [typed, filters.q]);

  const filterBy = (patch: Partial<Filters>) => {
    setFilters((f) => nextFilters(f, patch));
    setPage(1);
    setView({ status: "loading" });
  };
  const clear = () => {
    setTyped("");
    filterBy(NO_FILTERS);
  };
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  const filtered = Object.values(filters).some(Boolean);
  const changePage = (n: number) => {
    setPage(n);
    setView({ status: "loading" });
  };
  return { view, lists, counts, filters, typed, setTyped, filterBy, clear, setPage: changePage, reload, filtered };
}

const counted = (name: string, count: number) => t("students.option", { name, count });

/**
 * Term and status, then wing, course, level and class, always on screen (PM, 2026-10-06). The course list is every
 * course, or the chosen wing's; a course named alike in two wings carries its wing. Level and class need the one
 * before them (a "4th Semester" is a different level in each course), and say so while it is not chosen.
 */
export function StudentFilters({ filters, data, onChange }: { filters: Filters; data: Pick<StudentBrowse, "wings" | "terms"> | null; onChange: (patch: Partial<Filters>) => void }) {
  const all = { value: "", label: t("content.filterAll") };
  const wings = data?.wings ?? [];
  const wing = wings.find((w) => w.key === filters.wing);
  const courses = (wing ? [wing] : wings).flatMap((w) => w.courses.map((c) => ({ ...c, wingName: w.name })));
  const repeated = (name: string) => courses.filter((c) => c.name === name).length > 1;
  const course = courses.find((c) => c.id === filters.course);
  const level = course?.levels.find((l) => l.id === filters.level);
  return (
    <div className={styles.filters}>
      <FilterSelect
        label="students.filter.term"
        value={filters.term}
        onChange={(v) => onChange({ term: v })}
        options={[{ value: "", label: t("students.openTerms") }, ...(data?.terms ?? []).map((term) => ({ value: term.id, label: term.open ? term.label : t("students.closedTerm", { term: term.label }) }))]}
      />
      <FilterSelect
        label="content.filterState"
        value={filters.status}
        onChange={(v) => onChange({ status: v as Filters["status"] })}
        options={[
          { value: "", label: t("admissions.student.active") },
          { value: "left", label: t("admissions.student.left") },
          { value: "graduated", label: t("admissions.student.graduated") },
          { value: "all", label: t("content.filterAll") },
        ]}
      />
      <FilterSelect label="students.filter.wing" value={filters.wing} onChange={(v) => onChange({ wing: v })} options={[all, ...wings.map((w) => ({ value: w.key, label: counted(w.name, w.count) }))]} />
      <FilterSelect
        label="students.filter.course"
        value={filters.course}
        onChange={(v) => onChange({ course: v })}
        options={[all, ...courses.map((c) => ({ value: c.id, label: counted(repeated(c.name) ? t("students.inWing", { name: c.name, wing: c.wingName }) : c.name, c.count) }))]}
      />
      {course ? (
        <FilterSelect label="students.filter.level" value={filters.level} onChange={(v) => onChange({ level: v })} options={[all, ...course.levels.map((l) => ({ value: l.id, label: counted(l.name, l.count) }))]} />
      ) : (
        <FilterSelect label="students.filter.level" value="" disabled onChange={() => {}} options={[{ value: "", label: t("students.chooseCourse") }]} />
      )}
      {level ? (
        <FilterSelect
          label="students.filter.class"
          value={filters.class}
          onChange={(v) => onChange({ class: v })}
          options={[all, ...level.classes.map((c) => ({ value: c.id, label: counted(c.label || level.name, c.count) }))]}
        />
      ) : (
        <FilterSelect label="students.filter.class" value="" disabled onChange={() => {}} options={[{ value: "", label: t("students.chooseLevel") }]} />
      )}
    </div>
  );
}

// --- The top and the list ------------------------------------------------------------------------

const SUMMARY: { key: keyof StudentBrowse["counts"]; label: MessageKey; icon: LucideIcon; tone: string }[] = [
  { key: "active", label: "students.count.active", icon: UsersRound, tone: "primary" },
  { key: "leftOrGraduated", label: "students.count.gone", icon: GraduationCap, tone: "ok" },
];

function Summary({ counts }: { counts: StudentBrowse["counts"] | null }) {
  return (
    <ul className={styles.summary} aria-label={t("students.summary")}>
      {SUMMARY.map(({ key, label, icon: Icon, tone }) => (
        <li key={key} className={styles.summaryCard}>
          <span className={styles.tile} data-tone={tone} aria-hidden>
            <Icon />
          </span>
          <span className={styles.summaryBody}>
            {counts ? <span className={styles.summaryValue}>{counts[key]}</span> : <Skeleton width="2.5rem" height="2rem" />}
            <span className={styles.muted}>{t(label)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ListState({ view, filtered, onRetry, onClear }: { view: View; filtered: boolean; onRetry: () => void; onClear: () => void }) {
  if (view.status === "loading") return <ListSkeleton label="students.loading" />;
  if (view.status === "forbidden") return <Notice tone="bad">{t("people.error.forbidden")}</Notice>;
  if (view.status === "failed") {
    return (
      <div className={styles.state}>
        <p className={styles.stateTitle}>{t("students.loadFailed")}</p>
        <Button variant="secondary" onClick={onRetry}>
          {t("content.retry")}
        </Button>
      </div>
    );
  }
  if (view.status !== "ready" || view.students.length > 0) return null;
  return filtered ? (
    <div className={styles.state}>
      <p className={styles.stateTitle}>{t("students.noneFound")}</p>
      <Button variant="secondary" onClick={onClear}>
        {t("content.clearFilters")}
      </Button>
    </div>
  ) : (
    <div className={styles.state}>
      <p className={styles.stateTitle}>{t("students.empty")}</p>
      <p className={styles.muted}>{t("students.emptyBody")}</p>
    </div>
  );
}

const STATUS_WORD: Record<BrowsedStudent["status"], MessageKey> = { active: "admissions.student.active", left: "admissions.student.left", graduated: "admissions.student.graduated" };

/** One row per student: name and SID, class, term, guardian's phone, status, and the record. Pure. */
export function StudentsTable({ students }: { students: readonly BrowsedStudent[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{t("students.col.name")}</th>
          <th scope="col">{t("students.col.course")}</th>
          <th scope="col">{t("students.col.class")}</th>
          <th scope="col">{t("students.col.term")}</th>
          <th scope="col">{t("students.col.guardian")}</th>
          <th scope="col">{t("content.col.status")}</th>
          <th scope="col">
            <span className="sr-only">{t("content.col.actions")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {students.map((s) => {
          const name = `${s.firstName} ${s.lastName}`;
          const href = `/portal/admissions/student?id=${s.id}`;
          return (
            <tr key={s.id}>
              <td className={styles.nameCell}>
                <div className={styles.nameWrap}>
                  <span className={styles.avatar} aria-hidden>
                    {initials(name)}
                  </span>
                  <span>
                    <Link href={href} className={styles.personName}>
                      {name}
                    </Link>
                    <span className={styles.muted}>{s.sid}</span>
                  </span>
                </div>
              </td>
              <td data-label={t("students.col.course")}>
                {s.class ? (
                  <>
                    <span className={styles.cellMain}>{s.class.courseName}</span>
                    <span className={styles.muted}>{s.class.wingName}</span>
                  </>
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </td>
              <td data-label={t("students.col.class")}>
                {s.class ? (
                  <span className={styles.cellMain}>{s.class.label ? t("students.classIs", { level: s.class.levelName, section: s.class.label }) : s.class.levelName}</span>
                ) : (
                  <span className={styles.muted}>{t("students.noClass")}</span>
                )}
              </td>
              <td data-label={t("students.col.term")}>{s.term ? s.term.label : <span className={styles.muted}>—</span>}</td>
              <td data-label={t("students.col.guardian")}>{s.guardianPhone}</td>
              <td data-label={t("content.col.status")}>
                <span className={styles.statusPill} data-active={s.status === "active"}>
                  <span className={styles.dot} aria-hidden />
                  {t(STATUS_WORD[s.status])}
                </span>
              </td>
              <td className={styles.actionsCell}>
                <Link href={href} className={styles.viewLink} aria-label={t("admissions.search.open", { name })}>
                  {t("students.openRecord")}
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
