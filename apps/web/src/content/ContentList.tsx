"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { sendForApproval } from "@/approvals/client";
import { REASON_MESSAGE as APPROVAL_REASON_MESSAGE } from "@/approvals/model";
import { RequestsPanel } from "@/approvals/RequestsPanel";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Notice, Select, Skeleton, buttonClass } from "@/ui";

import { useAddressQuery } from "./address";
import { loadContent, setPublished } from "./client";
import { KINDS, KIND_LABEL, STATES, STATE_LABEL, formatBsDate, holidayLine, parseFlash, type ContentSummary, type FlashKind, type Kind, type State } from "./model";
import { outcomeOfToggle, type ToggleOutcome } from "./outcome";
import styles from "./content.module.css";

type View = { status: "loading" } | { status: "ready"; items: ContentSummary[] } | { status: "failed" | "forbidden" };
type Flash = { tone: "ok" | "bad"; text: string; undo?: ToggleOutcome["undo"] };

/** What a form that just saved tells the list (in the address), and whether it is good news. */
const FLASH_FROM_FORM: Record<FlashKind, { tone: "ok" | "bad"; message: "content.done.created" | "content.done.updated" | "content.done.formPublished" | "content.done.savedNotPublished" }> = {
  created: { tone: "ok", message: "content.done.created" },
  updated: { tone: "ok", message: "content.done.updated" },
  published: { tone: "ok", message: "content.done.formPublished" },
  saved_unpublished: { tone: "bad", message: "content.done.savedNotPublished" },
};

/**
 * The Admin's list of website content: filter it, add to it, and put items on the website or take them off.
 * Publish and Take down act at once, with no "are you sure" (D-048): they are common and fully reversible, so
 * the message afterwards says what happened and offers an Undo, which stays until the person does something else.
 */
export function ContentList() {
  const { api, me } = useSession();
  const canPublish = (me?.roles ?? []).some((r) => r.role === "admin" || r.role === "super_admin");
  const [kind, setKind] = useState<Kind | "">("");
  const [state, setState] = useState<State | "">("");
  const [view, setView] = useState<View>({ status: "loading" });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [addressFlashSeen, setAddressFlashSeen] = useState(false);
  const search = useAddressQuery();
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useRef(0);

  // Only the newest request may change the screen, so a slow answer never overwrites a newer one.
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const result = await loadContent(api, { ...(kind && { kind }), ...(state && { state }) });
    if (mine !== latest.current) return;
    setView(result.ok ? { status: "ready", items: result.items } : { status: result.reason });
  }, [api, kind, state]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A form that just saved sends its outcome in the address. It is shown until the person does
  // something else on this page; anything that happens after that replaces or dismisses it.
  const done = search === null ? null : parseFlash(search);
  const fromForm = done && !addressFlashSeen ? FLASH_FROM_FORM[done] : null;
  const shownFlash: Flash | null = flash ?? (fromForm ? { tone: fromForm.tone, text: t(fromForm.message) } : null);

  function changeFilter(next: () => void) {
    setAddressFlashSeen(true);
    setFlash(null);
    next();
    setView({ status: "loading" });
  }

  /** Puts an item on the website or takes it off, at once, and says what happened. */
  async function toggle(id: string, title: string, publish: boolean, isUndo = false) {
    if (busy) return;
    setAddressFlashSeen(true);
    setBusy(id);
    const result = await setPublished(api, id, publish);
    setBusy(null);

    const outcome = outcomeOfToggle(result, { id, title, publish, isUndo });
    setFlash({ tone: outcome.tone, text: t(outcome.message, { title }), undo: outcome.undo });
    if (outcome.refresh) await reload();
  }

  /** A Co-ordinator sends their own draft for approval, instead of publishing it directly (D-061). */
  async function send(id: string, title: string) {
    if (busy) return;
    setAddressFlashSeen(true);
    setBusy(id);
    const result = await sendForApproval(api, id);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t("content.done.sentForApproval", { title }) } : { tone: "bad", text: t(APPROVAL_REASON_MESSAGE[result.reason]) });
    if (result.ok) await reload();
  }

  const filtered = kind !== "" || state !== "";

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t("content.title")}</h1>
          <p className={styles.muted}>{t("content.intro")}</p>
        </div>
        <Link href="/portal/content/edit" className={buttonClass()}>
          {t("content.new")}
        </Link>
      </div>

      {shownFlash ? (
        <Notice tone={shownFlash.tone}>
          <div className={styles.flash}>
            <span>{shownFlash.text}</span>
            {shownFlash.undo ? (
              <Button variant="quiet" disabled={busy !== null} onClick={() => void toggle(shownFlash.undo!.id, shownFlash.undo!.title, shownFlash.undo!.publish, true)}>
                {t(shownFlash.undo.publish ? "content.undoTakeDown" : "content.undoPublish")}
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}

      <div className={styles.filters}>
        <Select
          label={t("content.filterKind")}
          value={kind}
          onChange={(event) => changeFilter(() => setKind(event.target.value as Kind | ""))}
          options={[{ value: "", label: t("content.filterAll") }, ...KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))]}
        />
        <Select
          label={t("content.filterState")}
          value={state}
          onChange={(event) => changeFilter(() => setState(event.target.value as State | ""))}
          options={[{ value: "", label: t("content.filterAll") }, ...STATES.map((s) => ({ value: s, label: t(STATE_LABEL[s]) }))]}
        />
      </div>

      {view.status === "loading" ? (
        <div role="status" aria-busy="true" className={styles.list}>
          <span className="sr-only">{t("content.loading")}</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className={styles.item} aria-hidden>
              <Skeleton width="60%" height="1.25rem" />
              <Skeleton width="35%" />
              <Skeleton width="50%" />
            </div>
          ))}
        </div>
      ) : null}

      {view.status === "forbidden" ? <Notice tone="bad">{t("content.forbidden")}</Notice> : null}

      {view.status === "failed" ? (
        <Notice tone="bad">
          <p>{t("content.loadFailed")}</p>
          <Button variant="secondary" onClick={() => void reload()}>
            {t("content.retry")}
          </Button>
        </Notice>
      ) : null}

      {view.status === "ready" && view.items.length === 0 ? <p className={styles.empty}>{t(filtered ? "content.emptyFiltered" : "content.empty")}</p> : null}

      {view.status === "ready" && view.items.length > 0 ? (
        <ul className={styles.list}>
          {view.items.map((item) => {
            const from = formatBsDate(item.publishOnBs);
            const publish = item.status !== "live";
            const canEdit = canPublish || item.status !== "live"; // a Co-ordinator may edit up to it going live (D-061)
            return (
              <li key={item.id} className={styles.item}>
                <h2 className={styles.itemTitle}>{item.title}</h2>
                <div className={styles.badges}>
                  <Badge>{t(KIND_LABEL[item.kind])}</Badge>
                  <Badge tone={item.state === "showing" ? "ok" : "neutral"}>{t(STATE_LABEL[item.state])}</Badge>
                  {item.urgent ? <Badge>{t("content.urgent")}</Badge> : null}
                </div>
                {item.kind === "holiday" && item.holidayFromBs ? <p className={styles.holiday}>{holidayLine(item.holidayFromBs, item.holidayToBs)}</p> : null}
                <p className={styles.muted}>{item.hideAfterBs ? t("content.showsFromUntil", { from, until: formatBsDate(item.hideAfterBs) }) : t("content.showsFrom", { from })}</p>

                <div className={styles.actions}>
                  {canEdit ? (
                    <Link href={`/portal/content/edit?id=${item.id}`} className={buttonClass({ variant: "secondary" })} aria-label={t("content.editItem", { title: item.title })}>
                      {t("content.edit")}
                    </Link>
                  ) : null}
                  {canPublish ? (
                    <Button
                      variant="quiet"
                      loading={busy === item.id}
                      loadingLabel={t("content.working")}
                      disabled={busy !== null && busy !== item.id}
                      aria-label={t(publish ? "content.publishItem" : "content.takeDownItem", { title: item.title })}
                      onClick={() => void toggle(item.id, item.title, publish)}
                    >
                      {t(publish ? "content.publish" : "content.takeDown")}
                    </Button>
                  ) : item.status === "draft" ? (
                    <Button
                      variant="quiet"
                      loading={busy === item.id}
                      loadingLabel={t("content.working")}
                      disabled={busy !== null && busy !== item.id}
                      aria-label={t("content.sendForApprovalItem", { title: item.title })}
                      onClick={() => void send(item.id, item.title)}
                    >
                      {t("content.sendForApproval")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!canPublish ? <RequestsPanel /> : null}
    </>
  );
}
