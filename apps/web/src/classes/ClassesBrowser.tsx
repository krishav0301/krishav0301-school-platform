"use client";

import { BookOpen, ChevronDown, Plus, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { FilterSelect, SearchBox } from "@/people/ListParts";
import accessStyles from "@/people/people-access.module.css";
import { setClassTeacher, loadTeaching } from "@/people/teaching-client";
import { REASON_MESSAGE as TEACHING_REASON } from "@/people/teaching-model";
import { EmptyLine } from "@/read/ReadView";
import { SidePanel } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { ClassSectionForm } from "@/setup/ClassesScreen";
import { createClass, renameClass, setClassActive } from "@/setup/client";
import { REASON_MESSAGE } from "@/setup/model";
import { AddDialog, Button, Field, Notice, RowMenu, Select, buttonClass, type MenuAction } from "@/ui";

import styles from "./classes.module.css";
import {
  classFilterOptions,
  classPlace,
  groupClasses,
  nextClassFilters,
  NO_CLASS_FILTERS,
  NO_SECTION,
  bareSection,
  sectionBadge,
  type ClassFilters,
  type ClassHubItem,
  type CourseGroup,
  type LevelGroup,
} from "./model";

/** Each course card's soft tint, in turn, from the theme's tones (never a colour of its own). */
const TONES = ["primary", "ok", "accent", "warn"] as const;

type Acting = { kind: "rename" | "teacher" | "off"; cls: ClassHubItem } | null;
type Flash = { tone: "ok" | "bad"; text: string } | null;

const count = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) => t(n === 1 ? one : many, { n });

/**
 * The Classes page grouped (PM, 2026-10-06): one card per course with its wing once, its levels inside, and each
 * level's sections as rows; never "Wing · Course · Level · Section" on every row. The first course starts open
 * (`startOpen` for tests); while a search or filter is set every matching course is open. The Co-ordinator (and
 * Support) also add classes and sections, rename a section, set its Class Teacher and switch a class off, through the
 * same API calls as Setup; the server checks each.
 */
export function ClassesBrowser({ classes, canManage, onChanged, startOpen }: { classes: readonly ClassHubItem[]; canManage: boolean; onChanged: () => void; startOpen?: readonly string[] }) {
  const [filters, setFilters] = useState<ClassFilters>(NO_CLASS_FILTERS);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [acting, setActing] = useState<Acting>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const groups = groupClasses(classes, filters);
  const options = classFilterOptions(classes, filters);
  const filtered = Object.values(filters).some(Boolean);
  const openAtFirst = startOpen ?? (groups[0] ? [groups[0].courseId] : []);
  const isOpen = (id: string) => toggled[id] ?? (filtered || openAtFirst.includes(id));
  const done = useCallback(
    (text: string) => {
      setActing(null);
      setFlash({ tone: "ok", text });
      onChanged();
    },
    [onChanged],
  );

  if (classes.length === 0) return <EmptyLine>{t("classes.empty")}</EmptyLine>;
  return (
    <>
      <div className={styles.toolbar}>
        <SearchBox label="classes.search" value={filters.q} onChange={(q) => setFilters((f) => ({ ...f, q }))} />
        <div className={accessStyles.filters}>
          <FilterSelect label="classes.filter.wing" value={filters.wing} onChange={(v) => setFilters((f) => nextClassFilters(f, { wing: v }))} options={[{ value: "", label: t("content.filterAll") }, ...options.wings.map((w) => ({ value: w, label: w }))]} />
          <FilterSelect label="classes.filter.course" value={filters.course} onChange={(v) => setFilters((f) => nextClassFilters(f, { course: v }))} options={[{ value: "", label: t("content.filterAll") }, ...options.courses.map((c) => ({ value: c.id, label: c.name }))]} />
          <FilterSelect
            label="classes.filter.level"
            value={filters.level}
            onChange={(v) => setFilters((f) => nextClassFilters(f, { level: v }))}
            options={[{ value: "", label: t("content.filterAll") }, ...options.levels.map((l) => ({ value: l.id, label: filters.course ? l.name : t("classes.levelOf", { level: l.name, course: l.course }) }))]}
          />
          <FilterSelect
            label="classes.filter.section"
            value={filters.section}
            onChange={(v) => setFilters((f) => nextClassFilters(f, { section: v }))}
            options={[{ value: "", label: t("content.filterAll") }, ...options.sections.map((s) => ({ value: s, label: s === NO_SECTION ? t("classes.noSection") : s }))]}
          />
          {filtered ? (
            <Button variant="secondary" className={styles.clear} onClick={() => setFilters(NO_CLASS_FILTERS)}>
              {t("content.clearFilters")}
            </Button>
          ) : null}
        </div>
      </div>

      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      {groups.length === 0 ? <EmptyLine>{t("classes.noneFound")}</EmptyLine> : null}

      <ul className={styles.courses}>
        {groups.map((group, i) => (
          <CourseCard
            key={group.courseId}
            group={group}
            tone={TONES[i % TONES.length]!}
            open={isOpen(group.courseId)}
            onToggle={() => setToggled((now) => ({ ...now, [group.courseId]: !isOpen(group.courseId) }))}
            canManage={canManage}
            onAct={setActing}
            onAdded={() => done(t("classes.done.added"))}
          />
        ))}
      </ul>

      {acting?.kind === "rename" ? <RenamePanel cls={acting.cls} onClose={() => setActing(null)} onDone={() => done(t("classes.done.renamed"))} /> : null}
      {acting?.kind === "teacher" ? <TeacherPanel cls={acting.cls} onClose={() => setActing(null)} onDone={() => done(t("classes.done.teacher"))} /> : null}
      {acting?.kind === "off" ? <SwitchOffPanel cls={acting.cls} onClose={() => setActing(null)} onDone={() => done(t("classes.done.off"))} /> : null}
    </>
  );
}

function CourseCard({ group, tone, open, onToggle, canManage, onAct, onAdded }: { group: CourseGroup; tone: string; open: boolean; onToggle: () => void; canManage: boolean; onAct: (acting: Acting) => void; onAdded: () => void }) {
  const bodyId = useId();
  return (
    <li className={styles.course} data-tone={tone}>
      <div className={styles.courseHead}>
        <span className={accessStyles.tile} data-tone={tone} aria-hidden>
          <BookOpen />
        </span>
        <div className={styles.courseName}>
          <h2 className={styles.courseTitle}>{group.name}</h2>
          <p className={styles.muted}>{group.wing}</p>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>{t("classes.stat.sections")}</dt>
            <dd>{group.sections}</dd>
          </div>
          <div>
            <dt>{t("classes.stat.students")}</dt>
            <dd>{group.students}</dd>
          </div>
          <div>
            <dt>{t("classes.stat.unassigned")}</dt>
            <dd>{group.unassigned}</dd>
          </div>
        </dl>
        <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={bodyId} aria-label={t(open ? "classes.hide" : "classes.show", { name: group.name })} onClick={onToggle}>
          <ChevronDown aria-hidden data-open={open} />
        </button>
      </div>
      {open ? (
        <div id={bodyId} className={styles.levels}>
          {group.levels.map((level) => (
            <LevelBlock key={level.levelId} level={level} canManage={canManage} onAct={onAct} onAdded={onAdded} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function LevelBlock({ level, canManage, onAct, onAdded }: { level: LevelGroup; canManage: boolean; onAct: (acting: Acting) => void; onAdded: () => void }) {
  return (
    <section className={styles.level} aria-label={level.name}>
      <div className={styles.levelHead}>
        <h3 className={styles.levelTitle}>{level.name}</h3>
        <span className={styles.term}>{level.termLabel}</span>
        <span className={styles.levelCounts}>
          {count(level.classes.length, "classes.sectionsOne", "classes.sectionsMany")} · {count(level.students, "classes.studentsOne", "classes.studentsMany")}
        </span>
        {canManage ? (
          <AddDialog label={t("classes.addSection")} title={t("classes.addSectionTo", { level: level.name })} variant="secondary">
            {(close) => (
              <AddSectionForm
                level={level}
                onAdded={() => {
                  close();
                  onAdded();
                }}
              />
            )}
          </AddDialog>
        ) : null}
      </div>
      <ul className={styles.sections}>
        {level.classes.map((c) => (
          <SectionRow key={c.id} cls={c} canManage={canManage} onAct={onAct} />
        ))}
      </ul>
    </section>
  );
}

/** One section: its badge and name, its Class Teacher, its students, and its menu. The name opens the class. Pure. */
export function SectionRow({ cls, canManage, onAct }: { cls: ClassHubItem; canManage: boolean; onAct: (acting: Acting) => void }) {
  const router = useRouter();
  const href = `/portal/classes/class?id=${cls.id}`;
  const name = classPlace(cls);
  const actions: MenuAction[] = [
    { key: "open", label: t("classes.action.open"), onSelect: () => router.push(href) },
    { key: "students", label: t("classes.action.students"), onSelect: () => router.push(`${href}&tab=students`) },
    ...(canManage
      ? [
          ...(cls.section ? [{ key: "rename", label: t("classes.menu.rename"), onSelect: () => onAct({ kind: "rename", cls }) }] : []),
          { key: "teacher", label: t("classes.menu.teacher"), onSelect: () => onAct({ kind: "teacher", cls }) },
          { key: "off", label: t("classes.menu.off"), onSelect: () => onAct({ kind: "off", cls }) },
        ]
      : []),
  ];
  return (
    <li className={styles.section}>
      <span className={styles.badge} aria-hidden>
        {sectionBadge(cls.section)}
      </span>
      <Link href={href} className={styles.sectionName} aria-label={t("classes.openNamed", { name })}>
        {cls.section ? t("classes.section", { name: bareSection(cls.section) }) : t("classes.noSection")}
      </Link>
      <span className={styles.teacher}>
        <UserRound aria-hidden />
        <span>
          <span className={styles.cellLabel}>{t("classes.col.classTeacher")}</span>
          <span className={cls.classTeacher ? undefined : styles.muted}>{cls.isClassTeacher ? t("classes.you") : (cls.classTeacher ?? t("classes.noClassTeacher"))}</span>
        </span>
      </span>
      <span className={styles.students}>
        <UsersRound aria-hidden />
        {count(cls.students, "classes.studentsOne", "classes.studentsMany")}
      </span>
      <RowMenu label={t("classes.menu", { name })} actions={actions} />
    </li>
  );
}

// --- The Co-ordinator's actions --------------------------------------------------------------------------------------

function AddSectionForm({ level, onAdded }: { level: LevelGroup; onAdded: () => void }) {
  const { api } = useSession();
  const [label, setLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const result = await createClass(api, { yearId: level.termId, levelId: level.levelId, label: label.trim() });
    setSaving(false);
    if (result.ok) onAdded();
    else setProblem(t(REASON_MESSAGE[result.reason]));
  }
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("setup.classes.label")} hint={t("setup.classes.labelHint")} value={label} maxLength={40} autoComplete="off" onChange={(event) => setLabel(event.target.value)} />
      <Button type="submit" loading={saving} loadingLabel={t("setup.working")}>
        {t("classes.addSection")}
      </Button>
    </form>
  );
}

function RenamePanel({ cls, onClose, onDone }: { cls: ClassHubItem; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  return (
    <SidePanel title={t("classes.action.rename")} subtitle={classPlace(cls)} onClose={onClose}>
      <ClassSectionForm
        initial={cls.section}
        onSave={async (label) => {
          const result = await renameClass(api, cls.id, label);
          if (result.ok) {
            onDone();
            return true;
          }
          return t(REASON_MESSAGE[result.reason]);
        }}
      />
    </SidePanel>
  );
}

function TeacherPanel({ cls, onClose, onDone }: { cls: ClassHubItem; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const loadNow = useCallback(() => loadTeaching(api, cls.id), [api, cls.id]);
  const { view } = useLoad(loadNow);
  const teachers = view.status === "ready" ? view.data.teachers : null;
  const [picked, setPicked] = useState(cls.classTeacherId ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const result = await setClassTeacher(api, cls.id, picked || null);
    setSaving(false);
    if (result.ok) onDone();
    else setProblem(t(TEACHING_REASON[result.reason]));
  }
  return (
    <SidePanel
      title={t("classes.action.teacher")}
      subtitle={classPlace(cls)}
      onClose={onClose}
      busy={saving}
      foot={
        <Button onClick={() => void save()} loading={saving} loadingLabel={t("setup.working")} disabled={teachers === null}>
          {t("classes.teacher.save")}
        </Button>
      }
    >
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      {view.status === "failed" || view.status === "forbidden" ? <Notice tone="bad">{t("classes.loadFailed")}</Notice> : null}
      <Select
        label={t("classes.col.classTeacher")}
        value={picked}
        disabled={teachers === null}
        onChange={(event) => setPicked(event.target.value)}
        options={[{ value: "", label: t("classes.noClassTeacher") }, ...(teachers ?? []).map((tch) => ({ value: tch.id, label: tch.fullName }))]}
      />
    </SidePanel>
  );
}

function SwitchOffPanel({ cls, onClose, onDone }: { cls: ClassHubItem; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function confirm() {
    setSaving(true);
    const result = await setClassActive(api, cls.id, false);
    setSaving(false);
    if (result.ok) onDone();
    else setProblem(t(REASON_MESSAGE[result.reason]));
  }
  return (
    <SidePanel
      title={t("classes.off.title")}
      subtitle={classPlace(cls)}
      onClose={onClose}
      busy={saving}
      foot={
        <Button onClick={() => void confirm()} loading={saving} loadingLabel={t("setup.working")}>
          {t("classes.action.off")}
        </Button>
      }
    >
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <p className={styles.muted}>{t("classes.off.body", { coordinator: term("role.coordinator") })}</p>
    </SidePanel>
  );
}

/** "+ Add Class": the full form, with the term and level to choose, is Setup's (D-114). */
export function AddClassLink() {
  return (
    <Link href="/portal/setup/classes" className={buttonClass()}>
      <Plus aria-hidden />
      {t("classes.add")}
    </Link>
  );
}
