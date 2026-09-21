"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { Badge, Button, Notice, Select, Skeleton, buttonClass } from "@/ui";

import { useAddressQuery } from "./address";
import { loadContent, setPublished } from "./client";
import { KINDS, KIND_LABEL, STATES, STATE_LABEL, formatBsDate, parseFlash, type ContentSummary, type Kind, type State } from "./model";
import styles from "./content.module.css";

type View = { status: "loading" } | { status: "ready"; items: ContentSummary[] } | { status: "failed" | "forbidden" };
type Flash = { tone: "ok" | "bad"; text: string };

const FLASH_MESSAGE = { created: "content.done.created", updated: "content.done.updated" } as const;

/** The Admin's list of website content: filter it, add to it, and put items on the website or take them off. */
export function ContentList() {
  const { api } = useSession();
  const [kind, setKind] = useState<Kind | "">("");
  const [state, setState] = useState<State | "">("");
  const [view, setView] = useState<View>({ status: "loading" });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [addressFlashSeen, setAddressFlashSeen] = useState(false);
  const search = useAddressQuery();
  const [asking, setAsking] = useState<{ id: string; publish: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useRef(0);
  const returnFocusTo = useRef<string | null>(null);

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

  // Keep the keyboard where the person is: asking moves it to the confirming button, and answering or
  // cancelling moves it back to the button that was pressed (which is otherwise replaced and lost).
  useEffect(() => {
    if (asking) {
      document.getElementById("content-confirm")?.focus();
    } else if (returnFocusTo.current) {
      document.getElementById(returnFocusTo.current)?.focus();
      returnFocusTo.current = null;
    }
  }, [asking]);

  // A form that just saved sends its outcome in the address. It is shown until the person does
  // something else on this page; anything that happens after that replaces or dismisses it.
  const done = search === null ? null : parseFlash(search);
  const shownFlash: Flash | null = flash ?? (done && !addressFlashSeen ? { tone: "ok", text: t(FLASH_MESSAGE[done]) } : null);

  function changeFilter(next: () => void) {
    setAddressFlashSeen(true);
    setFlash(null);
    next();
    setView({ status: "loading" });
    setAsking(null);
  }

  async function confirm(item: ContentSummary, publish: boolean) {
    if (busy) return;
    setAddressFlashSeen(true);
    setBusy(item.id);
    const result = await setPublished(api, item.id, publish);
    setBusy(null);
    setAsking(null);

    if (result.ok) setFlash({ tone: "ok", text: t(publish ? "content.done.published" : "content.done.takenDown") });
    else if (result.reason === "conflict") setFlash({ tone: "bad", text: t(publish ? "content.alreadyLive" : "content.notLive") });
    else if (result.reason === "gone") setFlash({ tone: "bad", text: t("content.gone") });
    else if (result.reason === "forbidden") setFlash({ tone: "bad", text: t("content.forbidden") });
    else setFlash({ tone: "bad", text: t("content.actionFailed") });

    if (result.ok || result.reason === "conflict" || result.reason === "gone") await reload();
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

      {shownFlash ? <Notice tone={shownFlash.tone}>{shownFlash.text}</Notice> : null}

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
            const asked = asking?.id === item.id;
            return (
              <li key={item.id} className={styles.item}>
                <h2 className={styles.itemTitle}>{item.title}</h2>
                <div className={styles.badges}>
                  <Badge>{t(KIND_LABEL[item.kind])}</Badge>
                  <Badge tone={item.state === "showing" ? "ok" : "neutral"}>{t(STATE_LABEL[item.state])}</Badge>
                  {item.urgent ? <Badge>{t("content.urgent")}</Badge> : null}
                </div>
                <p className={styles.muted}>{item.hideAfterBs ? t("content.showsFromUntil", { from, until: formatBsDate(item.hideAfterBs) }) : t("content.showsFrom", { from })}</p>

                {asked ? (
                  <div className={styles.confirm}>
                    <p id="content-confirm-text" role="alert" className={styles.confirmText}>
                      {t(asking.publish ? "content.publishAsk" : "content.takeDownAsk", { title: item.title })}
                    </p>
                    <div className={styles.actions}>
                      <Button id="content-confirm" variant="secondary" aria-describedby="content-confirm-text" loading={busy === item.id} loadingLabel={t("content.working")} onClick={() => void confirm(item, asking.publish)}>
                        {t(asking.publish ? "content.confirmPublish" : "content.confirmTakeDown")}
                      </Button>
                      <Button variant="quiet" disabled={busy === item.id} onClick={() => setAsking(null)}>
                        {t("content.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <Link href={`/portal/content/edit?id=${item.id}`} className={buttonClass({ variant: "secondary" })} aria-label={t("content.editItem", { title: item.title })}>
                      {t("content.edit")}
                    </Link>
                    <Button
                      id={`content-action-${item.id}`}
                      variant="quiet"
                      aria-label={t(publish ? "content.publishItem" : "content.takeDownItem", { title: item.title })}
                      onClick={() => {
                        returnFocusTo.current = `content-action-${item.id}`;
                        setAsking({ id: item.id, publish });
                      }}
                    >
                      {t(publish ? "content.publish" : "content.takeDown")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
