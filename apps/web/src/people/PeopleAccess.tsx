"use client";

import { ArrowDown, Crown, GraduationCap, Info, Plus, UserCog, UsersRound, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { t, type MessageKey } from "@/i18n/messages";
import { useAddressQuery } from "@/content/address";
import { useSession } from "@/session/SessionProvider";
import { Button, HeroBand, Notice, RowMenu, Skeleton, type MenuAction } from "@/ui";

import { AddPersonDialog, ManageAccessDialog } from "./AccessDialogs";
import { loadPeople, loadProgrammeOptions, type PeopleGroup, type PeoplePage, type Person, type ProgrammeOption } from "./access-client";
import { FilterSelect, ListSkeleton, Pager, SearchBox } from "./ListParts";
import { initials, lastSignIn, scopeWords, signInLine } from "./access-model";
import { issueTemporaryPassword, setStaffActive } from "./client";
import { REASON_MESSAGE } from "./model";
import { TemporaryPasswordNotice } from "./StaffScreen";
import styles from "./people-access.module.css";

const PAGE_SIZE = 10;

/** The school's own words for the roles (a school may call the Admin "Principal"), for sentences that name them. */
const roleWords = (term: (key: string) => string) => ({ admin: term("role.admin"), coordinator: term("role.coordinator"), accountant: term("role.accountant") });

type View = { status: "loading" } | ({ status: "ready" } & PeoplePage) | { status: "failed" | "forbidden" };
type Flash = { tone: "ok" | "bad"; text: string };

/**
 * People & Access (D-099, after the PM's reference): the Principal's access-control centre. It answers at a glance who
 * can reach the school's platform, whom the Principal gave access to (Co-ordinators and Accountants), who manages the
 * teachers (the Co-ordinators), how many teachers there are, and each person's access, account status and last
 * sign-in. Teachers are shown for oversight only: there is no "create teacher" here. Lists are searched, filtered and
 * paged on the server.
 */
export function PeopleAccess() {
  const [tab, setTab] = useState<PeopleGroup>("admin");
  const [counts, setCounts] = useState<PeoplePage["counts"] | null>(null);
  const tabsId = useId();

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <div className={styles.topMain}>
          <HeroBand>
            <h1 className={styles.title}>{t("access.title")}</h1>
            <p className={styles.intro}>{t("access.intro")}</p>
          </HeroBand>
          <Summary counts={counts} />
        </div>
        <HowAccessWorks />
      </div>

      <Tabs id={tabsId} tab={tab} onTab={setTab} />
      <div role="tabpanel" id={`${tabsId}-${tab}`} aria-labelledby={`${tabsId}-tab-${tab}`}>
        {tab === "admin" ? <AdminPanel onCounts={setCounts} /> : <TeachingPanel onCounts={setCounts} />}
      </div>
    </div>
  );
}

// --- The top -------------------------------------------------------------------------------------

const SUMMARY: { key: keyof PeoplePage["counts"]; label: MessageKey; icon: LucideIcon; tone: string }[] = [
  { key: "teachers", label: "access.count.teachers", icon: UsersRound, tone: "primary" },
  { key: "coordinators", label: "access.count.coordinators", icon: UserCog, tone: "accent" },
  { key: "accountants", label: "access.count.accountants", icon: Wallet, tone: "ok" },
];

function Summary({ counts }: { counts: PeoplePage["counts"] | null }) {
  const { term } = useConfig();
  const words = roleWords(term);
  return (
    <ul className={styles.summary} aria-label={t("access.summary")}>
      {SUMMARY.map(({ key, label, icon: Icon, tone }) => (
        <li key={key} className={styles.summaryCard}>
          <span className={styles.tile} data-tone={tone} aria-hidden>
            <Icon />
          </span>
          <span className={styles.summaryBody}>
            {counts ? <span className={styles.summaryValue}>{counts[key]}</span> : <Skeleton width="2.5rem" height="2rem" />}
            <span className={styles.muted}>{t(label, words)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The hierarchy in plain words and a small picture (D-099): Principal, then Co-ordinators and Accountants, then teachers. */
function HowAccessWorks() {
  const { term } = useConfig();
  return (
    <section className={styles.how} aria-labelledby="how-access-title">
      <div className={styles.howText}>
        <h2 id="how-access-title" className={styles.howTitle}>
          <Info aria-hidden />
          {t("access.how.title")}
        </h2>
        <p className={styles.muted}>{t("access.how.body", roleWords(term))}</p>
        <details className={styles.more}>
          <summary>{t("access.how.more")}</summary>
          <p className={styles.muted}>{t("access.how.moreBody", roleWords(term))}</p>
        </details>
      </div>
      <ol className={styles.tree} aria-label={t("access.how.tree")}>
        <li className={styles.node} data-tone="warn">
          <Crown aria-hidden />
          <span>{term("role.admin")}</span>
        </li>
        <li className={styles.branch}>
          <ArrowDown aria-hidden className={styles.arrow} />
          <ul className={styles.pair}>
            <li className={styles.node} data-tone="accent">
              <UserCog aria-hidden />
              <span>
                {term("role.coordinator")}
                <small>{t("access.how.managesTeachers")}</small>
              </span>
            </li>
            <li className={styles.node} data-tone="ok">
              <Wallet aria-hidden />
              <span>
                {term("role.accountant")}
                <small>{t("access.how.managesFees")}</small>
              </span>
            </li>
          </ul>
        </li>
        <li className={styles.branch}>
          <ArrowDown aria-hidden className={styles.arrow} />
          <span className={styles.node} data-tone="primary">
            <GraduationCap aria-hidden />
            <span>
              {term("role.teacher")}
              <small>{t("access.how.theirClasses")}</small>
            </span>
          </span>
        </li>
      </ol>
    </section>
  );
}

/** Two tabs, with the arrow keys moving between them (the WAI-ARIA tabs pattern). */
function Tabs({ id, tab, onTab }: { id: string; tab: PeopleGroup; onTab: (tab: PeopleGroup) => void }) {
  const tabs: { key: PeopleGroup; label: MessageKey }[] = [
    { key: "admin", label: "access.tab.admin" },
    { key: "teaching", label: "access.tab.teaching" },
  ];
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "admin" ? "teaching" : "admin";
    onTab(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }
  return (
    <div role="tablist" aria-label={t("people.tabs")} className={styles.tabs} onKeyDown={onKey}>
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          id={`${id}-tab-${key}`}
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={tab === key}
          aria-controls={`${id}-${key}`}
          tabIndex={tab === key ? 0 : -1}
          onClick={() => onTab(key)}
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}

// --- A list: loading, filters, paging ---------------------------------------------------------------

interface Filters {
  q: string;
  role: "" | "coordinator" | "accountant";
  status: "" | "active" | "off";
  section: string;
  programme: string;
}
const NO_FILTERS: Filters = { q: "", role: "", status: "", section: "", programme: "" };

/** Loads one page of a list as the filters change; the newest request wins. `version` asks for a reload. */
function usePeople(group: PeopleGroup, onCounts: (counts: PeoplePage["counts"]) => void) {
  const { api } = useSession();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<View>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadPeople(api, {
      group,
      ...(filters.q && { q: filters.q }),
      ...(filters.role && { role: filters.role }),
      ...(filters.status && { status: filters.status }),
      ...(filters.section && { section: filters.section }),
      ...(filters.programme && { programme: filters.programme }),
      page,
      pageSize: PAGE_SIZE,
    }).then((result) => {
      if (!active) return;
      if (!result.ok) return setView({ status: result.reason });
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (page > lastPage) return setPage(lastPage);
      const { ok, ...data } = result;
      if (ok) {
        setView({ status: "ready", ...data });
        onCounts(data.counts);
      }
    });
    return () => {
      active = false;
    };
  }, [api, group, filters, page, version, onCounts]);

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
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    setView({ status: "loading" });
  };
  const clear = () => {
    setTyped("");
    filterBy(NO_FILTERS);
  };
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  const filtered = Object.values(filters).some(Boolean);
  return { view, filters, typed, setTyped, filterBy, clear, page, setPage, reload, filtered };
}

function ListState({
  view,
  filtered,
  empty,
  emptyBody,
  words,
  onRetry,
  onClear,
  action,
}: {
  view: View;
  filtered: boolean;
  empty: MessageKey;
  emptyBody: MessageKey;
  words: Record<string, string>;
  onRetry: () => void;
  onClear: () => void;
  action?: ReactNode;
}) {
  if (view.status === "loading") return <ListSkeleton label="access.loading" />;
  if (view.status === "forbidden") return <Notice tone="bad">{t("people.error.forbidden")}</Notice>;
  if (view.status === "failed") {
    return (
      <div className={styles.state}>
        <p className={styles.stateTitle}>{t("access.loadFailed")}</p>
        <Button variant="secondary" onClick={onRetry}>
          {t("content.retry")}
        </Button>
      </div>
    );
  }
  if (view.status !== "ready" || view.people.length > 0) return null;
  return filtered ? (
    <div className={styles.state}>
      <p className={styles.stateTitle}>{t("access.noneFound")}</p>
      <Button variant="secondary" onClick={onClear}>
        {t("content.clearFilters")}
      </Button>
    </div>
  ) : (
    <div className={styles.state}>
      <p className={styles.stateTitle}>{t(empty)}</p>
      <p className={styles.muted}>{t(emptyBody, words)}</p>
      {action}
    </div>
  );
}

type AddOpen = false | "any" | "coordinator" | "accountant";

/** Which Add pop-up is open: one chosen here, else the one the address asked for (`?add=`) until it is dismissed. Pure. */
export function addOpen(chosen: AddOpen, asked: "coordinator" | "accountant" | null, dismissed: boolean): AddOpen {
  if (chosen !== false) return chosen;
  return asked !== null && !dismissed ? asked : false;
}

// --- Staff & Access ---------------------------------------------------------------------------------

/** The people the Principal gives access to, with what each may reach, their account and their last sign-in. */
function AdminPanel({ onCounts }: { onCounts: (counts: PeoplePage["counts"]) => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const list = usePeople("admin", onCounts);
  // `?add=coordinator` or `?add=accountant` (the dashboard's quick actions) opens Add on its second step with that role.
  const search = useAddressQuery();
  const asked = search === null ? null : new URLSearchParams(search).get("add");
  const askedRole = asked === "coordinator" || asked === "accountant" ? asked : null;
  const [chosen, setChosen] = useState<AddOpen>(false);
  // Closing must change state even when nothing was chosen here: the pop-up the address opened is then "dismissed".
  // (Before, Close set `chosen` to false, which it already was, so nothing redrew and the pop-up stayed.)
  const [dismissed, setDismissed] = useState(false);
  const adding = addOpen(chosen, askedRole, dismissed);
  const closeAdd = () => {
    setChosen(false);
    setDismissed(true);
    if (askedRole) window.history.replaceState(null, "", window.location.pathname); // so a reload does not open it again
  };
  const [managing, setManaging] = useState<Person | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [list.view]); // eslint-disable-line react-hooks/exhaustive-deps -- "x ago" is worked out when a page arrives
  const sections = list.view.status === "ready" ? list.view.sections : [];

  async function toggle(person: Person) {
    if (busy) return;
    setBusy(person.id);
    const result = await setStaffActive(api, person.id, !person.active);
    setBusy(null);
    setManaging(null);
    setFlash(result.ok ? { tone: "ok", text: t(person.active ? "people.done.switchedOff" : "people.done.switchedOn", { name: person.fullName }) } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    list.reload();
  }

  async function newPassword(person: Person) {
    if (busy) return;
    setBusy(person.id);
    const result = await issueTemporaryPassword(api, person.id);
    setBusy(null);
    setManaging(null);
    if (result.ok) setSecret({ name: person.fullName, password: result.temporaryPassword });
    else setFlash({ tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
  }

  const addButton = (
    <Button className={styles.addButton} onClick={() => setChosen("any")}>
      <Plus aria-hidden />
      {t("people.add")}
    </Button>
  );

  return (
    <section className={styles.panel} aria-labelledby="admin-staff-title">
      <div className={styles.panelHead}>
        <div>
          <h2 id="admin-staff-title" className={styles.panelTitle}>
            {t("access.admin.title")}
          </h2>
          <p className={styles.muted}>{t("access.admin.intro", roleWords(term))}</p>
        </div>
        <div className={styles.panelTools}>
          <SearchBox label="access.searchStaff" value={list.typed} onChange={list.setTyped} />
          {addButton}
        </div>
      </div>
      <div className={styles.filters}>
        <FilterSelect
          label="people.role"
          value={list.filters.role}
          onChange={(v) => list.filterBy({ role: v as Filters["role"] })}
          options={[{ value: "", label: t("content.filterAll") }, { value: "coordinator", label: term("role.coordinator") }, { value: "accountant", label: term("role.accountant") }]}
        />
        <FilterSelect
          label="content.filterState"
          value={list.filters.status}
          onChange={(v) => list.filterBy({ status: v as Filters["status"] })}
          options={[{ value: "", label: t("content.filterAll") }, { value: "active", label: t("access.active") }, { value: "off", label: t("people.off") }]}
        />
        <FilterSelect
          label="access.scope"
          value={list.filters.section}
          onChange={(v) => list.filterBy({ section: v })}
          options={[{ value: "", label: t("content.filterAll") }, ...sections.map((s) => ({ value: s.key, label: s.name }))]}
        />
      </div>

      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      {secret ? <TemporaryPasswordNotice name={secret.name} password={secret.password} onDone={() => setSecret(null)} /> : null}

      <ListState view={list.view} filtered={list.filtered} empty="access.admin.empty" emptyBody="access.admin.emptyBody" words={roleWords(term)} onRetry={list.reload} onClear={list.clear} action={addButton} />

      {list.view.status === "ready" && list.view.people.length > 0 ? (
        <>
          <ul className={styles.cards}>
            {list.view.people.map((person) => {
              const more: MenuAction[] = [
                { key: "toggle", label: t(person.active ? "people.switchOff" : "people.switchOn"), onSelect: () => void toggle(person) },
                ...(person.active ? [{ key: "password", label: t("people.newPassword"), onSelect: () => void newPassword(person) }] : []),
              ];
              return (
                <li key={person.id} className={styles.personCard} data-busy={busy === person.id ? true : undefined}>
                  <span className={styles.avatar} aria-hidden>
                    {initials(person.fullName)}
                  </span>
                  <div className={styles.personMain}>
                    <p className={styles.personName}>{person.fullName}</p>
                    <p className={styles.muted}>{person.email}</p>
                  </div>
                  <div className={styles.chips}>
                    <span className={styles.roleChip} data-tone={person.role === "coordinator" ? "accent" : "ok"}>
                      {term(`role.${person.role}`)}
                    </span>
                    <span className={styles.scopeChip}>{scopeWords(person)}</span>
                  </div>
                  <div className={styles.personStatus}>
                    <span className={styles.status} data-active={person.active}>
                      <span className={styles.dot} aria-hidden />
                      {t(person.active ? "access.active" : "people.off")}
                    </span>
                    <span className={styles.muted}>{signInLine(person.lastSignInAt, now)}</span>
                  </div>
                  <div className={styles.personActions}>
                    {person.active ? (
                      <Button variant="secondary" disabled={busy !== null} aria-label={t("access.manageItem", { name: person.fullName })} onClick={() => setManaging(person)}>
                        {t("access.manage")}
                      </Button>
                    ) : (
                      <Button variant="secondary" disabled={busy !== null} aria-label={t("people.switchOnItem", { name: person.fullName })} onClick={() => void toggle(person)}>
                        {t("people.switchOn")}
                      </Button>
                    )}
                    <RowMenu
                      label={t("access.moreFor", { name: person.fullName })}
                      disabled={busy !== null}
                      actions={person.active ? more : [{ key: "manage", label: t("access.manage"), onSelect: () => setManaging(person) }, ...more]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager page={list.view.page} total={list.view.total} pageSize={list.view.pageSize} onPage={list.setPage} noun="access.showingStaff" />
        </>
      ) : null}

      {adding ? (
        <AddPersonDialog
          startRole={adding === "any" ? undefined : adding}
          sections={sections}
          onClose={closeAdd}
          onCreated={() => {
            setFlash(null);
            list.reload();
          }}
        />
      ) : null}
      {managing ? (
        <ManageAccessDialog
          person={managing}
          sections={sections}
          now={now}
          onClose={() => setManaging(null)}
          onChanged={(text) => {
            setManaging(null);
            setFlash({ tone: "ok", text });
            list.reload();
          }}
          onToggle={(p) => void toggle(p)}
          onNewPassword={(p) => void newPassword(p)}
        />
      ) : null}
    </section>
  );
}

// --- Teaching ---------------------------------------------------------------------------------------

/** The teaching staff, for oversight: what each teaches, where, who added them, their account and last sign-in. */
function TeachingPanel({ onCounts }: { onCounts: (counts: PeoplePage["counts"]) => void }) {
  const { api } = useSession();
  const { term } = useConfig();
  const list = usePeople("teaching", onCounts);
  const [programmes, setProgrammes] = useState<ProgrammeOption[]>([]);
  const now = useMemo(() => new Date(), [list.view]); // eslint-disable-line react-hooks/exhaustive-deps -- "x ago" is worked out when a page arrives
  const sections = list.view.status === "ready" ? list.view.sections : [];

  useEffect(() => {
    let active = true;
    void loadProgrammeOptions(api).then((options) => {
      if (active) setProgrammes(options);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const addedBy = (person: Person) => {
    if (!person.addedBy) return null;
    if (person.addedBy.support) return { name: t("content.support"), role: null };
    return { name: person.addedBy.name ?? "", role: person.addedBy.role ? term(`role.${person.addedBy.role}`) : null };
  };

  return (
    <section className={styles.panel} aria-labelledby="teaching-staff-title">
      <div className={styles.panelHead}>
        <div>
          <h2 id="teaching-staff-title" className={styles.panelTitle}>
            {t("access.teaching.title")}
          </h2>
          <p className={styles.muted}>{t("access.teaching.intro", roleWords(term))}</p>
        </div>
        <div className={styles.panelTools}>
          <SearchBox label="access.searchTeachers" value={list.typed} onChange={list.setTyped} />
        </div>
      </div>
      <div className={styles.filters}>
        <FilterSelect
          label="access.filter.section"
          value={list.filters.section}
          onChange={(v) => list.filterBy({ section: v })}
          options={[{ value: "", label: t("access.allSections") }, ...sections.map((s) => ({ value: s.key, label: s.name }))]}
        />
        {programmes.length > 0 ? (
          <FilterSelect
            label="access.filter.programme"
            value={list.filters.programme}
            onChange={(v) => list.filterBy({ programme: v })}
            options={[{ value: "", label: t("access.allProgrammes") }, ...programmes.map((p) => ({ value: p.id, label: p.name }))]}
          />
        ) : null}
        <FilterSelect
          label="content.filterState"
          value={list.filters.status}
          onChange={(v) => list.filterBy({ status: v as Filters["status"] })}
          options={[{ value: "", label: t("content.filterAll") }, { value: "active", label: t("access.active") }, { value: "off", label: t("access.inactive") }]}
        />
      </div>

      <ListState view={list.view} filtered={list.filtered} empty="access.teaching.empty" emptyBody="access.teaching.emptyBody" words={roleWords(term)} onRetry={list.reload} onClear={list.clear} />

      {list.view.status === "ready" && list.view.people.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("access.col.name")}</th>
                <th scope="col">{t("access.col.subjects")}</th>
                <th scope="col">{t("access.col.where")}</th>
                <th scope="col">{t("access.col.addedBy")}</th>
                <th scope="col">{t("content.col.status")}</th>
                <th scope="col">{t("access.col.lastSignIn")}</th>
                <th scope="col">
                  <span className="sr-only">{t("content.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.view.people.map((person) => {
                const by = addedBy(person);
                return (
                  <tr key={person.id}>
                    <td className={styles.nameCell}>
                      <div className={styles.nameWrap}>
                        <span className={styles.avatar} aria-hidden>
                          {initials(person.fullName)}
                        </span>
                        <span>
                          <span className={styles.personName}>{person.fullName}</span>
                          <span className={styles.muted}>{person.email}</span>
                        </span>
                      </div>
                    </td>
                    <td data-label={t("access.col.subjects")}>{person.subjects.length > 0 ? person.subjects.join(", ") : <span className={styles.muted}>{t("access.noSubjects")}</span>}</td>
                    <td data-label={t("access.col.where")}>
                      <span className={styles.cellMain}>{person.homeSection?.name ?? "—"}</span>
                      {person.programmes.length > 0 ? <span className={styles.muted}>{person.programmes.join(", ")}</span> : null}
                    </td>
                    <td data-label={t("access.col.addedBy")}>
                      {by ? (
                        <>
                          <span className={styles.cellMain}>{by.name}</span>
                          {by.role ? <span className={styles.muted}>{by.role}</span> : null}
                        </>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td data-label={t("content.col.status")}>
                      <span className={styles.statusPill} data-active={person.active}>
                        <span className={styles.dot} aria-hidden />
                        {t(person.active ? "access.active" : "access.inactive")}
                      </span>
                    </td>
                    <td data-label={t("access.col.lastSignIn")}>
                      <span className={styles.muted}>{lastSignIn(person.lastSignInAt, now)}</span>
                    </td>
                    <td className={styles.actionsCell}>
                      {/* Oversight only: the Principal looks at a teacher's subjects and classes; their Co-ordinator manages them. */}
                      <Link href="/portal/setup/teaching" className={styles.viewLink} aria-label={t("access.viewTeachingOf", { name: person.fullName })}>
                        {t("access.viewTeaching")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={list.view.page} total={list.view.total} pageSize={list.view.pageSize} onPage={list.setPage} noun="access.showingTeachers" />
        </>
      ) : null}
    </section>
  );
}
