"use client";

import { ArrowRight, BellRing, CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, FileCheck2, FilePen, Plus, Search, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { sendForApproval } from "@/approvals/client";
import { REASON_MESSAGE as APPROVAL_REASON_MESSAGE } from "@/approvals/model";
import { RequestsPanel } from "@/approvals/RequestsPanel";
import { relativeTime } from "@/dashboard/admin-model";
import { t, type MessageKey } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Button, Notice, RowMenu, Skeleton, buttonClass, type MenuAction } from "@/ui";

import { useAddressQuery } from "./address";
import { archiveItem, loadContent, setPublished, type ContentPage, type ToggleResult } from "./client";
import { ContentDialog, type DialogTarget } from "./ContentDialog";
import { KindTile } from "./KindIcon";
import {
  GROUPS,
  GROUP_LABEL,
  KINDS,
  KIND_LABEL,
  STATE_LABEL,
  STATE_NOTE,
  formatBsDate,
  formatTime,
  holidayLine,
  parseFlash,
  parseNewKind,
  type ContentSummary,
  type FlashKind,
  type Group,
  type Kind,
} from "./model";
import { outcomeOfToggle, type ToggleOutcome } from "./outcome";
import { KindChip, UrgentChip } from "./PublicEntry";
import { plainText } from "./text-format";
import styles from "./website.module.css";

/** Rows on one page. The server pages the list, so a school with years of posts still loads one page at a time. */
const PAGE_SIZE = 10;

type View = { status: "loading" } | ({ status: "ready" } & ContentPage) | { status: "failed" | "forbidden" };
type Flash = { tone: "ok" | "bad"; text: string; undo?: ToggleOutcome["undo"] };

/** What a form that just saved tells the list, and whether it is good news. */
const FLASH_FROM_FORM: Record<FlashKind, { tone: "ok" | "bad"; message: MessageKey }> = {
  created: { tone: "ok", message: "content.done.created" },
  updated: { tone: "ok", message: "content.done.updated" },
  published: { tone: "ok", message: "content.done.formPublished" },
  scheduled: { tone: "ok", message: "content.done.formScheduled" },
  saved_unpublished: { tone: "bad", message: "content.done.savedNotPublished" },
};

/**
 * The Principal's publishing control centre for the public website (D-098), after the PM's reference design:
 * what is on the website at a glance, the public website itself, and every item, filtered by type and status and
 * searched on the server, a page at a time. New content and edits open in a pop-up beside a live preview.
 *
 * Publish and Take down act at once, with no "are you sure" (D-048): they are common and reversible, so the
 * message afterwards says what happened and offers an Undo, which stays until the person does something else.
 */
export function ContentList() {
  const { api, me } = useSession();
  const canPublish = (me?.roles ?? []).some((r) => r.role === "admin" || r.role === "super_admin");
  const [kind, setKind] = useState<Kind | "">("");
  const [group, setGroup] = useState<Group | "">("");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>({ status: "loading" });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [addressSeen, setAddressSeen] = useState(false);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const search = useAddressQuery();
  const [version, setVersion] = useState(0);
  const now = useMemo(() => new Date(), [view]); // eslint-disable-line react-hooks/exhaustive-deps -- "x ago" is worked out when a page arrives

  // Loads the page asked for. Only the newest request may change the screen: an answer that arrives after the
  // filters changed (or after a reload was asked for) is dropped, so a slow answer never overwrites a newer one.
  useEffect(() => {
    let active = true;
    void loadContent(api, { ...(kind && { kind }), ...(group && { group }), ...(q && { q }), page, pageSize: PAGE_SIZE }).then((result) => {
      if (!active) return;
      if (!result.ok) return setView({ status: result.reason });
      // A page past the end (the last item on it was archived elsewhere) steps back to the last page there is.
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (page > lastPage) return setPage(lastPage);
      const { ok, ...data } = result;
      if (ok) setView({ status: "ready", ...data });
    });
    return () => {
      active = false;
    };
  }, [api, kind, group, q, page, version]);

  /** Loads the same page again, after something on it changed. */
  const reload = useCallback(() => setVersion((n) => n + 1), []);

  // The search is sent a moment after typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== q) {
        setQ(typed.trim());
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [typed, q]);

  // From the address: what a form that just saved did (`?done=`), or a new item to open (`?new=post`, the dashboard).
  const done = search === null || addressSeen ? null : parseFlash(search);
  const askedNew = search === null || addressSeen ? null : parseNewKind(search);
  const fromForm = done ? FLASH_FROM_FORM[done] : null;
  const shownFlash: Flash | null = flash ?? (fromForm ? { tone: fromForm.tone, text: t(fromForm.message) } : null);
  const shownDialog: DialogTarget | null = dialog ?? (askedNew ? { mode: "new", kind: askedNew } : null);

  function change(next: () => void) {
    setAddressSeen(true);
    setFlash(null);
    next();
  }

  function filterBy(next: () => void) {
    change(() => {
      next();
      setPage(1);
      setView({ status: "loading" });
    });
  }

  function clearFilters() {
    filterBy(() => {
      setKind("");
      setGroup("");
      setTyped("");
      setQ("");
    });
  }

  async function act(item: ContentSummary, run: () => Promise<ToggleResult>, message: (result: ToggleResult) => Flash) {
    if (busy) return;
    setAddressSeen(true);
    setBusy(item.id);
    const result = await run();
    setBusy(null);
    setFlash(message(result));
    if (result.ok || (result.reason !== "forbidden" && result.reason !== "failed")) reload();
  }

  /** Puts an item on the website or takes it off, at once, and says what happened, with an Undo. */
  const toggle = (item: ContentSummary, publish: boolean, isUndo = false) =>
    act(
      item,
      () => setPublished(api, item.id, publish),
      (result) => {
        const outcome = outcomeOfToggle(result, { id: item.id, title: item.title, publish, isUndo });
        return { tone: outcome.tone, text: t(outcome.message, { title: item.title }), ...(outcome.undo && { undo: outcome.undo }) };
      },
    );

  const archive = (item: ContentSummary) =>
    act(
      item,
      () => archiveItem(api, item.id),
      (result) =>
        result.ok
          ? { tone: "ok", text: t("content.done.archived", { title: item.title }) }
          : { tone: "bad", text: t(result.reason === "conflict" ? "content.alreadyArchived" : result.reason === "gone" ? "content.gone" : result.reason === "forbidden" ? "content.forbidden" : "content.actionFailed") },
    );

  const moveToDrafts = (item: ContentSummary) =>
    act(
      item,
      () => setPublished(api, item.id, false),
      (result) => (result.ok ? { tone: "ok", text: t("content.done.movedToDrafts", { title: item.title }) } : { tone: "bad", text: t(outcomeOfToggle(result, { id: item.id, title: item.title, publish: false }).message) }),
    );

  /** A Co-ordinator sends their own draft for approval, instead of publishing it directly (D-061). */
  async function send(item: ContentSummary) {
    if (busy) return;
    setAddressSeen(true);
    setBusy(item.id);
    const result = await sendForApproval(api, item.id);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t("content.done.sentForApproval", { title: item.title }) } : { tone: "bad", text: t(APPROVAL_REASON_MESSAGE[result.reason]) });
    if (result.ok) reload();
  }

  function saved(outcome: FlashKind) {
    setDialog(null);
    setAddressSeen(true);
    const known = FLASH_FROM_FORM[outcome];
    setFlash({ tone: known.tone, text: t(known.message) });
    reload();
  }

  /** What each row offers, besides the action on the row itself. */
  function actionsFor(item: ContentSummary): RowActions {
    const editable = canPublish || item.status === "draft" || item.status === "waiting"; // a Co-ordinator edits until it goes live (D-061)
    const edit = { key: "edit", label: t("content.edit"), onSelect: () => change(() => setDialog({ mode: "edit", id: item.id })) };
    const more: MenuAction[] = [];
    if (item.state === "showing" && editable) more.push(edit);
    if (canPublish) {
      if (item.status === "draft") more.push({ key: "publish", label: t("content.publish"), onSelect: () => void toggle(item, true) });
      if (item.status === "live") more.push({ key: "takeDown", label: t("content.takeDown"), onSelect: () => void toggle(item, false) });
      if (item.status === "archived") more.push({ key: "drafts", label: t("content.moveToDrafts"), onSelect: () => void moveToDrafts(item) });
      if (item.status === "draft" || item.status === "live") more.push({ key: "archive", label: t("content.archive"), onSelect: () => void archive(item) });
    } else if (item.status === "draft") {
      more.push({ key: "send", label: t("content.sendForApproval"), onSelect: () => void send(item) });
    }
    // One extra action is drawn on the row itself, since a menu of one entry is not shown (D-030).
    return { primary: item.state === "showing" ? "view" : editable ? "edit" : null, more };
  }

  const filtered = kind !== "" || group !== "" || q !== "";
  const ready = view.status === "ready" ? view : null;

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <div className={styles.topMain}>
          <div className={styles.header}>
            <div className={styles.headerText}>
              <h1 className={styles.title}>{t("content.title")}</h1>
              <p className={styles.intro}>{t("content.intro")}</p>
            </div>
            <Button className={styles.newButton} onClick={() => change(() => setDialog({ mode: "new", kind: "post" }))}>
              <Plus aria-hidden />
              {t("content.new")}
            </Button>
          </div>
          <Summary counts={ready?.counts ?? null} />
        </div>
        <SiteCard site={ready?.site ?? null} loading={view.status === "loading" && !ready} />
      </div>

      {shownFlash ? (
        <Notice tone={shownFlash.tone}>
          <div className={styles.flash}>
            <span>{shownFlash.text}</span>
            {shownFlash.undo ? (
              <Button
                variant="quiet"
                disabled={busy !== null}
                onClick={() => {
                  const undo = shownFlash.undo!;
                  void toggle({ id: undo.id, title: undo.title } as ContentSummary, undo.publish, true);
                }}
              >
                {t(shownFlash.undo.publish ? "content.undoTakeDown" : "content.undoPublish")}
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}

      <section className={styles.listCard} aria-labelledby="content-list-title">
        <h2 id="content-list-title" className="sr-only">
          {t("content.title")}
        </h2>
        <div className={styles.filterBar}>
          <div role="group" aria-label={t("content.filterKind")} className={styles.segmented}>
            <SegmentButton on={kind === ""} onClick={() => filterBy(() => setKind(""))} label={t("content.filterAll")} />
            {KINDS.map((k) => (
              <SegmentButton key={k} on={kind === k} onClick={() => filterBy(() => setKind(k))} label={t(KIND_LABEL[k])} />
            ))}
          </div>
          <div role="group" aria-label={t("content.filterState")} className={styles.segmented}>
            <SegmentButton on={group === ""} onClick={() => filterBy(() => setGroup(""))} label={t("content.filterAll")} />
            {GROUPS.map((g) => (
              <SegmentButton key={g} on={group === g} onClick={() => filterBy(() => setGroup(g))} label={t(GROUP_LABEL[g])} />
            ))}
          </div>
          <label className={styles.searchBox}>
            <Search aria-hidden />
            <span className="sr-only">{t("content.searchLabel")}</span>
            <input
              type="search"
              value={typed}
              placeholder={t("content.search")}
              maxLength={100}
              onChange={(event) => change(() => setTyped(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") filterBy(() => setQ(typed.trim()));
              }}
            />
          </label>
        </div>

        {view.status === "loading" ? <RowsLoading /> : null}
        {view.status === "forbidden" ? <Notice tone="bad">{t("content.forbidden")}</Notice> : null}
        {view.status === "failed" ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>{t("content.loadFailed")}</p>
            <Button variant="secondary" onClick={() => change(() => { setView({ status: "loading" }); reload(); })}>
              {t("content.retry")}
            </Button>
          </div>
        ) : null}

        {ready && ready.items.length === 0 ? (
          filtered ? (
            <div className={styles.state}>
              <p className={styles.stateTitle}>{t("content.emptyFiltered")}</p>
              <Button variant="secondary" onClick={clearFilters}>
                {t("content.clearFilters")}
              </Button>
            </div>
          ) : (
            <div className={styles.state}>
              <p className={styles.stateTitle}>{t("content.empty")}</p>
              <p className={styles.muted}>{t("content.emptyBody")}</p>
            </div>
          )
        ) : null}

        {ready && ready.items.length > 0 ? (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("content.col.title")}</th>
                  <th scope="col">{t("content.col.type")}</th>
                  <th scope="col">{t("content.col.status")}</th>
                  <th scope="col">{t("content.col.date")}</th>
                  <th scope="col">{t("content.col.author")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("content.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ready.items.map((item) => (
                  <Row key={item.id} item={item} now={now} busy={busy} actions={actionsFor(item)} onEdit={() => change(() => setDialog({ mode: "edit", id: item.id }))} />
                ))}
              </tbody>
            </table>
            <Pager page={ready.page} total={ready.total} pageSize={ready.pageSize} onPage={(next) => change(() => setPage(next))} />
          </>
        ) : null}
      </section>

      {!canPublish ? <RequestsPanel /> : null}

      {shownDialog && ready ? (
        <ContentDialog
          key={shownDialog.mode === "edit" ? shownDialog.id : `new-${shownDialog.kind}`}
          target={shownDialog}
          todayBs={ready.todayBs}
          nowTime={ready.nowTime}
          onClose={() => change(() => setDialog(null))}
          onSaved={saved}
        />
      ) : null}
    </div>
  );
}

function SegmentButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className={styles.segment} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

const SUMMARY: { key: "published" | "drafts" | "scheduled" | "urgent"; label: MessageKey; note: MessageKey; icon: LucideIcon; tone: string }[] = [
  { key: "published", label: "content.summary.published", note: "content.stateNote.showing", icon: FileCheck2, tone: "ok" },
  { key: "drafts", label: "content.summary.drafts", note: "content.stateNote.hidden", icon: FilePen, tone: "accent" },
  { key: "scheduled", label: "content.summary.scheduled", note: "content.stateNote.scheduled", icon: Clock, tone: "warn" },
  { key: "urgent", label: "content.summary.urgent", note: "content.summary.urgentNote", icon: BellRing, tone: "bad" },
];

/** The four figures (D-098): over everything, whatever the filters; worked out on the server. */
function Summary({ counts }: { counts: ContentPage["counts"] | null }) {
  return (
    <ul className={styles.summary} aria-label={t("content.summary.label")}>
      {SUMMARY.map(({ key, label, note, icon: Icon, tone }) => (
        <li key={key} className={styles.summaryCard}>
          <span className={styles.summaryTile} data-tone={tone} aria-hidden>
            <Icon />
          </span>
          <span className={styles.summaryBody}>
            <span className={styles.summaryLabel}>{t(label)}</span>
            {counts ? <span className={styles.summaryValue}>{counts[key]}</span> : <Skeleton width="2.5rem" height="2rem" />}
            <span className={styles.summaryNote}>
              <span className={styles.dot} data-tone={tone} aria-hidden />
              {t(note)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const lastUpdated = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

/** The public website: its address, whether this deployment is the real one, and when anything was last published. */
function SiteCard({ site, loading }: { site: ContentPage["site"] | null; loading: boolean }) {
  const host = site?.address ? site.address.replace(/^https?:\/\//, "") : null;
  return (
    <section className={styles.siteCard} aria-labelledby="site-card-title">
      <h2 id="site-card-title" className={styles.cardTitle}>
        {t("content.site.title")}
      </h2>
      {loading || !site ? (
        <div className={styles.siteLoading} aria-hidden>
          <Skeleton width="40%" />
          <Skeleton width="70%" />
          <Skeleton width="55%" />
        </div>
      ) : (
        <>
          <div className={styles.siteState}>
            <span className={styles.siteDot} data-live={site.live} aria-hidden />
            <div>
              <p className={styles.siteStatus}>{t(site.live ? "content.site.live" : "content.site.test")}</p>
              {site.address && host ? (
                <a href={site.address} className={styles.siteLink} target="_blank" rel="noreferrer">
                  {host}
                  <ExternalLink aria-hidden />
                </a>
              ) : null}
            </div>
          </div>
          <div className={styles.siteFoot}>
            <p className={styles.siteFact}>
              <CalendarDays aria-hidden />
              <span>
                <span className={styles.muted}>{t("content.site.lastUpdated")}</span>
                <span>{site.lastPublishedAt ? lastUpdated(site.lastPublishedAt) : t("content.site.never")}</span>
              </span>
            </p>
            <a href={site.address ?? "/"} className={buttonClass({ variant: "secondary" })} target="_blank" rel="noreferrer">
              {t("content.site.view")}
              <ArrowRight aria-hidden className={styles.inlineIcon} />
            </a>
          </div>
        </>
      )}
    </section>
  );
}

/** What a row offers: View (on the website now) or Edit on the row itself, and the rest in its menu. */
interface RowActions {
  primary: "view" | "edit" | null;
  more: MenuAction[];
}

function Row({ item, now, busy, actions, onEdit }: { item: ContentSummary; now: Date; busy: string | null; actions: RowActions; onEdit: () => void }) {
  const excerpt = plainText(item.excerpt);
  const holiday = item.kind === "holiday" ? holidayLine(item.holidayFromBs, item.holidayToBs) : null;
  const author = item.authorName ?? t("content.support");
  return (
    <tr className={styles.row} data-busy={busy === item.id ? true : undefined}>
      <td className={styles.titleCell}>
        <div className={styles.titleWrap}>
          <KindTile kind={item.kind} />
          <div className={styles.titleText}>
            <p className={styles.rowTitle}>{item.title}</p>
            {holiday ? <p className={styles.holidayLine}>{holiday}</p> : null}
            {excerpt ? <p className={styles.excerpt}>{excerpt}</p> : null}
          </div>
        </div>
      </td>
      <td data-label={t("content.col.type")}>
        <div className={styles.chips}>
          <KindChip kind={item.kind} />
          {item.urgent ? <UrgentChip /> : null}
        </div>
      </td>
      <td data-label={t("content.col.status")}>
        <span className={styles.statusPill} data-state={item.state}>
          {t(STATE_LABEL[item.state])}
        </span>
        <span className={styles.statusNote}>
          <span className={styles.dot} data-state={item.state} aria-hidden />
          {t(STATE_NOTE[item.state])}
        </span>
      </td>
      <td data-label={t("content.col.date")} className={styles.dateCell}>
        <span className={styles.cellMain}>{formatBsDate(item.publishOnBs)}</span>
        <span className={styles.cellSub}>{formatTime(item.publishTime)}</span>
      </td>
      <td data-label={t("content.col.author")}>
        <div className={styles.author}>
          <span className={styles.avatar} aria-hidden>
            {initialsOf(author)}
          </span>
          <span>
            <span className={styles.cellMain}>{author}</span>
            <span className={styles.cellSub}>{relativeTime(item.updatedAt, now)}</span>
          </span>
        </div>
      </td>
      <td className={styles.actionsCell}>
        {actions.primary === "view" ? (
          <a href="/notices" className={`${buttonClass({ variant: "secondary" })} ${styles.rowButton}`} target="_blank" rel="noreferrer" aria-label={t("content.viewItem", { title: item.title })}>
            {t("content.view")}
          </a>
        ) : actions.primary === "edit" ? (
          <Button variant="secondary" className={styles.rowButton} disabled={busy !== null} aria-label={t("content.editItem", { title: item.title })} onClick={onEdit}>
            {t("content.edit")}
          </Button>
        ) : null}
        {actions.more.length === 1 ? (
          <Button variant="quiet" disabled={busy !== null} onClick={actions.more[0]!.onSelect}>
            {actions.more[0]!.label}
          </Button>
        ) : (
          <RowMenu label={t("content.more", { title: item.title })} actions={actions.more} disabled={busy !== null} />
        )}
      </td>
    </tr>
  );
}

/** Up to two initials for the author's circle. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length === 0 ? "" : ((words[0]![0] ?? "") + (words.length > 1 ? (words[words.length - 1]![0] ?? "") : "")).toUpperCase();
}

function RowsLoading() {
  return (
    <div role="status" aria-busy="true" className={styles.rowsLoading}>
      <span className="sr-only">{t("content.loading")}</span>
      {[0, 1, 2, 3, 4].map((n) => (
        <div key={n} className={styles.rowSkeleton} aria-hidden>
          <Skeleton width="2.75rem" height="2.75rem" />
          <div className={styles.rowSkeletonText}>
            <Skeleton width="55%" height="1.1rem" />
            <Skeleton width="80%" />
          </div>
          <Skeleton width="5rem" height="1.75rem" />
          <Skeleton width="6rem" height="1.75rem" />
        </div>
      ))}
    </div>
  );
}

/** "Showing 1–10 of 12 items", and the pages: the first, the last, and two either side of this one. */
function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const shown = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <div className={styles.pager}>
      <p className={styles.muted}>{t("content.showingRange", { from, to, total })}</p>
      {pages > 1 ? (
        <nav aria-label={t("content.pages")}>
          <ul className={styles.pages}>
            <li>
              <button type="button" className={styles.pageButton} disabled={page <= 1} aria-label={t("content.prevPage")} onClick={() => onPage(page - 1)}>
                <ChevronLeft aria-hidden />
              </button>
            </li>
            {shown.map((n, index) => (
              <li key={n}>
                {index > 0 && n - shown[index - 1]! > 1 ? <span className={styles.gap} aria-hidden /> : null}
                <button type="button" className={styles.pageButton} aria-current={n === page ? "page" : undefined} aria-label={t("content.pageNumber", { page: n })} onClick={() => onPage(n)}>
                  {n}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className={styles.pageButton} disabled={page >= pages} aria-label={t("content.nextPage")} onClick={() => onPage(page + 1)}>
                <ChevronRight aria-hidden />
              </button>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
