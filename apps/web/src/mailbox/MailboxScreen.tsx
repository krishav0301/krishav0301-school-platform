"use client";

import { Fragment, useCallback } from "react";

import type { ApiClient } from "@/api/client";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Notice } from "@/ui";

import styles from "./mailbox.module.css";

export interface MailboxMessage {
  id: number;
  at: string;
  to: string;
  subject: string;
  body: string;
}

type Loaded = { ok: true; data: { messages: MailboxMessage[] } } | { ok: false; reason: "forbidden" | "not_found" | "failed" };

async function loadMailbox(api: ApiClient): Promise<Loaded> {
  try {
    const { data, response } = await api.GET("/api/dev/mailbox");
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

const when = (instant: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instant));

/** A message's text as written, with its web addresses made into links a tester can follow. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <p className={styles.body}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part}>
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/** The kept emails, newest first. */
export function MailboxList({ messages }: { messages: readonly MailboxMessage[] }) {
  if (messages.length === 0) return <p className={setupStyles.empty}>{t("mailbox.empty")}</p>;
  return (
    <ul className={setupStyles.list}>
      {messages.map((m) => (
        <li key={m.id} className={setupStyles.item}>
          <h2 className={setupStyles.itemTitle}>{m.subject}</h2>
          <p className={setupStyles.muted}>{t("mailbox.meta", { to: m.to, when: when(m.at) })}</p>
          <Body text={m.body} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The test mailbox (D-086): on staging, email is kept instead of sent, so an Admin reads here what the site would have
 * sent (an applicant's verification link, a password reset) and passes it to the tester. Not in the menu: it does not
 * exist in production.
 */
export function MailboxScreen() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const result = await loadMailbox(api);
    if (result.ok || result.reason !== "not_found") return result.ok ? result : { ok: false as const, reason: result.reason === "forbidden" ? ("forbidden" as const) : ("failed" as const) };
    return { ok: true as const, data: null };
  }, [api]);
  const { view, reload } = useLoad<{ messages: MailboxMessage[] } | null>(loadNow);
  return (
    <>
      <h1 className={setupStyles.title}>{t("mailbox.title")}</h1>
      <p className={setupStyles.muted}>{t("mailbox.intro")}</p>
      <Gate view={view} onRetry={() => void reload()}>
        {(data) => (data === null ? <Notice tone="bad">{t("mailbox.unavailable")}</Notice> : <MailboxList messages={data.messages} />)}
      </Gate>
    </>
  );
}
