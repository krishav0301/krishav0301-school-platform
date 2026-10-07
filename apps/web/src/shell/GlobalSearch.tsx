"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { searchStudents } from "@/admissions/client";
import { loadClassHubList } from "@/classes/client";
import type { ClassHubItem } from "@/classes/model";
import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { loadPeople } from "@/people/access-client";
import { useSession } from "@/session/SessionProvider";
import { loadSubjects } from "@/setup/client";
import { Illustration } from "@/ui";

import { MIN_CHARS, PER_GROUP, groupsFor, matches, placeholderFor, seesAllStaff, studentHref, type SearchGroup, type SearchHit } from "./search-model";
import styles from "./shell.module.css";

const GROUP_TITLE: Record<SearchGroup, MessageKey> = {
  pages: "search.group.pages",
  classes: "search.group.classes",
  students: "search.group.students",
  staff: "search.group.staff",
  subjects: "search.group.subjects",
};

type Subject = { id: string; name: string; code: string | null; archived: boolean };
type Student = { id: string; sid: string; firstName: string; lastName: string; className: string | null };
type Staff = { id: string; fullName: string; email: string; role: string };
type Remote = { q: string; students: Student[]; staff: Staff[] };

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Search in the top bar (D-127): one field that finds pages, classes, students, staff and subjects, each from a list
 * the person can already read (`search-model.ts`). The classes and subjects are read once and searched here; students
 * and staff are searched on the server as the person types (after a pause), so nothing but names travels. Results are
 * plain links; the arrow keys move through them and Escape returns to the field. Ctrl+K (⌘K) jumps to the field.
 */
export function GlobalSearch({ pages }: { pages: readonly { label: string; href: string }[] }) {
  const { api, me } = useSession();
  const { term } = useConfig();
  const roles = me?.roles ?? [];
  const groups = groupsFor(roles);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // the field on a phone, behind its button
  const [lists, setLists] = useState<{ classes: ClassHubItem[]; subjects: Subject[] } | null>(null);
  const [remote, setRemote] = useState<Remote>({ q: "", students: [], staff: [] });
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const wantsClasses = groups.includes("classes");
  const wantsSubjects = groups.includes("subjects");
  const wantsStudents = groups.includes("students");
  const wantsStaff = groups.includes("staff");
  const allStaff = seesAllStaff(roles);

  /** The classes and subjects, read once, the first time the field is used. */
  function readLists() {
    if (asked.current || (!wantsClasses && !wantsSubjects)) return;
    asked.current = true;
    void Promise.all([wantsClasses ? loadClassHubList(api) : null, wantsSubjects ? loadSubjects(api) : null]).then(([c, s]) => {
      if ((c && !c.ok) || (s && !s.ok)) setFailed(true);
      setLists({ classes: c?.ok ? c.data.classes : [], subjects: s?.ok ? s.data.subjects : [] });
    });
  }

  // Students and staff are searched on the server, a moment after the typing stops; an older answer is ignored.
  useEffect(() => {
    const query = q.trim();
    if (query.length < MIN_CHARS || (!wantsStudents && !wantsStaff)) return;
    const mine = ++latest.current;
    const timer = setTimeout(() => {
      const staffGroups = wantsStaff ? (allStaff ? (["admin", "teaching"] as const) : (["teaching"] as const)) : [];
      void Promise.all([wantsStudents ? searchStudents(api, query) : null, ...staffGroups.map((group) => loadPeople(api, { group, q: query, pageSize: PER_GROUP }))]).then(([students, ...staff]) => {
        if (mine !== latest.current) return;
        setFailed((was) => was || (students !== null && !students.ok) || staff.some((s) => !s.ok));
        setRemote({ q: query, students: students && students.ok ? students.data : [], staff: staff.flatMap((s) => (s.ok ? s.people : [])) });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, api, wantsStudents, wantsStaff, allStaff]);

  // Ctrl+K (⌘K on a Mac) jumps to the field from anywhere in the portal.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShown(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const query = q.trim();
  const ready = query.length >= MIN_CHARS;
  const hits: Record<SearchGroup, SearchHit[]> = {
    pages: query ? pages.filter((p) => matches(query, p.label)).map((p) => ({ key: p.href, title: p.label, href: p.href })) : [],
    classes: ready
      ? (lists?.classes ?? [])
          .filter((c) => matches(query, c.course, c.level, c.section, c.wing, c.classTeacher))
          .map((c) => ({ key: c.id, title: [c.course, c.level, c.section].filter(Boolean).join(" · "), meta: c.termLabel, href: `/portal/classes/class?id=${c.id}` }))
      : [],
    subjects: ready
      ? (lists?.subjects ?? []).filter((s) => !s.archived && matches(query, s.name, s.code)).map((s) => ({ key: s.id, title: s.name, meta: s.code ?? undefined, href: "/portal/setup/subjects" }))
      : [],
    students:
      ready && remote.q === query
        ? remote.students.map((x) => ({ key: x.id, title: `${x.firstName} ${x.lastName}`, meta: [x.sid, x.className].filter(Boolean).join(" · "), href: studentHref(roles, x.id) }))
        : [],
    staff: ready && remote.q === query ? remote.staff.map((x) => ({ key: x.id, title: x.fullName, meta: `${term(`role.${x.role}`)} · ${x.email}`, href: "/portal/people" })) : [],
  };
  const waiting = ready && (wantsStudents || wantsStaff) && remote.q !== query;
  const total = groups.reduce((n, g) => n + Math.min(hits[g].length, PER_GROUP), 0);

  function close() {
    setOpen(false);
    setQ("");
    setShown(false);
  }

  function links(): HTMLAnchorElement[] {
    return Array.from(panel.current?.querySelectorAll("a") ?? []);
  }

  function onFieldKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      links()[0]?.focus();
    } else if (event.key === "Escape") {
      if (q) setQ("");
      else close();
    }
  }

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = at + (event.key === "ArrowDown" ? 1 : -1);
      if (next < 0) input.current?.focus();
      else all[Math.min(next, all.length - 1)]?.focus();
    } else if (event.key === "Escape") {
      setOpen(false);
      input.current?.focus();
    }
  }

  const showPanel = open && query.length > 0;
  return (
    <div
      className={styles.searchArea}
      data-shown={shown || undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button type="button" className={styles.searchToggle} aria-label={t("search.open")} aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        {shown ? <X aria-hidden /> : <Search aria-hidden />}
      </button>
      <div className={styles.searchField}>
        <Search aria-hidden className={styles.searchIcon} />
        <input
          ref={input}
          type="search"
          className={styles.searchInput}
          value={q}
          placeholder={t(placeholderFor(groups))}
          aria-label={t("search.label")}
          aria-controls={panelId}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setOpen(true);
            readLists();
          }}
          onChange={(event) => {
            setQ(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onFieldKey}
        />
        <kbd className={styles.searchKey} aria-hidden>
          {isMac() ? "⌘K" : "Ctrl K"}
        </kbd>
      </div>
      {showPanel ? (
        <div ref={panel} id={panelId} className={styles.searchPanel} role="region" aria-label={t("search.results")} onKeyDown={onPanelKey}>
          {groups.map((g) =>
            hits[g].length > 0 ? (
              <section key={g} className={styles.searchGroup} aria-labelledby={`${panelId}-${g}`}>
                <h2 id={`${panelId}-${g}`} className={styles.searchGroupTitle}>
                  {t(GROUP_TITLE[g])}
                </h2>
                <ul className={styles.searchList}>
                  {hits[g].slice(0, PER_GROUP).map((h) => (
                    <li key={h.key}>
                      <Link href={h.href} className={styles.searchHit} onClick={close}>
                        <span className={styles.searchHitTitle}>{h.title}</span>
                        {h.meta ? <span className={styles.searchHitMeta}>{h.meta}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
          {waiting ? <p className={styles.searchNote}>{t("search.searching")}</p> : null}
          {!waiting && total === 0 ? (
            ready || groups.length === 1 ? (
              <div className={styles.searchNone}>
                <Illustration code="E2" size="spot" />
                <p className={styles.searchNote}>{t("search.none", { q: query })}</p>
              </div>
            ) : (
              <p className={styles.searchNote}>{t("search.keepTyping")}</p>
            )
          ) : null}
          {failed ? <p className={styles.searchNote}>{t("search.partial")}</p> : null}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {showPanel && !waiting ? t("search.count", { n: total }) : ""}
      </p>
    </div>
  );
}
