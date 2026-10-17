"use client";

import { useCallback, useState, type FormEvent } from "react";

import { useConfig } from "@/config/ConfigProvider";
import { formatBsDate } from "@/content/model";
import { t, type MessageKey } from "@/i18n/messages";
import { StatusWord, readStyles } from "@/read/ReadView";
import { Facts } from "@/read/SidePanel";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";
import { Button, Field, Notice, Skeleton } from "@/ui";

import styles from "./cards.module.css";
import { linkCard, loadCard, retireCard, type CardChange, type CardOwner, type CardView } from "./client";

const PROBLEM: Record<"in_use" | "changed" | "not_allowed" | "failed", MessageKey> = {
  in_use: "cards.inUse",
  changed: "cards.changed",
  not_allowed: "cards.notAllowed",
  failed: "cards.failed",
};

/** Pure: the card in use and the ones retired before it. */
export function CardFacts({ card }: { card: CardView }) {
  const current = card.current;
  return (
    <>
      <Facts
        rows={
          current
            ? [
                { name: t("cards.number"), value: <span className={styles.number}>{current.cardNumber}</span> },
                { name: t("cards.linkedOn"), value: current.issuedOnBs ? formatBsDate(current.issuedOnBs) : "—" },
                { name: t("cards.title"), value: <StatusWord tone={current.usable ? "ok" : "neutral"}>{t(current.usable ? "cards.active" : "cards.inactive")}</StatusWord> },
              ]
            : [{ name: t("cards.title"), value: t("cards.none") }]
        }
      />
      {current && !current.usable ? <p className={styles.note}>{t("cards.inactiveNote")}</p> : null}
      {card.history.length > 0 ? (
        <>
          <p className={styles.note}>{t("cards.history")}</p>
          <ul className={styles.history}>
            {card.history.map((old) => (
              <li key={`${old.cardNumber}-${old.retiredAt}`}>{t("cards.historyRow", { number: old.cardNumber, date: old.retiredOnBs ? formatBsDate(old.retiredOnBs) : "—", reason: old.reason })}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/**
 * A person's ID card on their record (D-174): the number the reader types, when it was linked, and the cards retired
 * before it. Whoever may manage it can link, replace or retire it; the server decides again on every change. Shown only
 * where the school uses cards, and left out for anyone the server will not show it to.
 */
export function CardPanel({ owner, id, canManage, titled = false }: { owner: CardOwner; id: string; canManage: boolean; /** Put a heading above the card (a record page); a side panel brings its own. */ titled?: boolean }) {
  const { moduleEnabled } = useConfig();
  if (!moduleEnabled("card_attendance")) return null;
  return <CardSection owner={owner} id={id} canManage={canManage} titled={titled} />;
}

function CardSection({ owner, id, canManage, titled }: { owner: CardOwner; id: string; canManage: boolean; titled: boolean }) {
  const { api } = useSession();
  const load = useCallback(async () => {
    const result = await loadCard(api, owner, id);
    return result.ok ? result : { ok: false as const, reason: result.reason === "hidden" ? ("forbidden" as const) : ("failed" as const) };
  }, [api, owner, id]);
  const { view, reload } = useLoad<CardView>(load);
  const [mode, setMode] = useState<"link" | "retire" | null>(null);
  const [done, setDone] = useState<MessageKey | null>(null);

  if (view.status === "loading") return <Skeleton width="60%" height="3rem" />;
  if (view.status === "forbidden") return null;
  if (view.status === "failed") return <Notice tone="bad">{t("cards.loadFailed")}</Notice>;

  const card = view.data;
  const replacing = card.current !== null;
  async function finished(message: MessageKey) {
    setMode(null);
    setDone(message);
    await reload();
  }

  const body = (
    <div className={styles.panel}>
      {done ? <Notice tone="ok">{t(done)}</Notice> : null}
      <CardFacts card={card} />
      {canManage && mode === null ? (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              setDone(null);
              setMode("link");
            }}
          >
            {t(replacing ? "cards.replace" : "cards.link")}
          </Button>
          {replacing ? (
            <Button
              variant="quiet"
              onClick={() => {
                setDone(null);
                setMode("retire");
              }}
            >
              {t("cards.retire")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode === "link" ? <LinkForm owner={owner} id={id} replacing={replacing} onCancel={() => setMode(null)} onDone={() => void finished(replacing ? "cards.replaced" : "cards.linked")} /> : null}
      {mode === "retire" ? <RetireForm owner={owner} id={id} onCancel={() => setMode(null)} onDone={() => void finished("cards.retired")} /> : null}
    </div>
  );
  if (!titled) return body;
  return (
    <section className={readStyles.page} aria-labelledby="record-card">
      <h2 id="record-card" className={readStyles.panelTitle}>
        {t("cards.title")}
      </h2>
      {body}
    </section>
  );
}

function usePost() {
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function run(send: () => Promise<CardChange>, onDone: () => void) {
    if (saving) return;
    setProblem(null);
    setSaving(true);
    const result = await send();
    setSaving(false);
    if (result.ok) return onDone();
    setProblem(result.reason === "invalid" ? result.message : t(PROBLEM[result.reason]));
  }
  return { problem, saving, run };
}

/** The reader types the number into the box and presses Enter, which sends the form. */
function LinkForm({ owner, id, replacing, onCancel, onDone }: { owner: CardOwner; id: string; replacing: boolean; onCancel: () => void; onDone: () => void }) {
  const { api } = useSession();
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");
  const { problem, saving, run } = usePost();
  const ready = number.trim().length >= 4 && (!replacing || reason.trim().length >= 3);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    void run(() => linkCard(api, owner, id, number.trim(), replacing ? reason.trim() : undefined), onDone);
  }
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("cards.number")} hint={t("cards.tapHint")} value={number} onChange={(event) => setNumber(event.target.value)} maxLength={32} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      {replacing ? <Field label={t("cards.replaceReason")} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} autoComplete="off" /> : null}
      <div className={styles.actions}>
        <Button type="submit" loading={saving} loadingLabel={t("cards.saving")} disabled={!ready}>
          {t("cards.save")}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={saving}>
          {t("cards.cancel")}
        </Button>
      </div>
    </form>
  );
}

function RetireForm({ owner, id, onCancel, onDone }: { owner: CardOwner; id: string; onCancel: () => void; onDone: () => void }) {
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const { problem, saving, run } = usePost();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) return;
    void run(() => retireCard(api, owner, id, reason.trim()), onDone);
  }
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      <Field label={t("cards.retireReason")} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} autoFocus autoComplete="off" />
      <div className={styles.actions}>
        <Button type="submit" loading={saving} loadingLabel={t("cards.saving")} disabled={reason.trim().length < 3}>
          {t("cards.confirmRetire")}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={saving}>
          {t("cards.cancel")}
        </Button>
      </div>
    </form>
  );
}
