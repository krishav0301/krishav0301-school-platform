"use client";

import { useCallback, useState, type FormEvent } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Button, Notice, TextArea } from "@/ui";

import { approve, decline, loadInbox } from "./client";
import { kindLabel, REASON_MESSAGE, type ApprovalSummary } from "./model";

type Flash = { tone: "ok" | "bad"; text: string };

/** Decline needs a reason; asking for it inline (a native disclosure) avoids a second screen for a short, common task. */
function DeclineForm({ request, busy, onDecline }: { request: ApprovalSummary; busy: boolean; onDecline: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    onDecline(trimmed);
  }
  return (
    <details className={setupStyles.disclosure}>
      <summary className={setupStyles.summary}>{t("approvals.decline")}</summary>
      {/* `.form`, not `.inline`: `.inline` is a wrapping row for short side-by-side fields (Curriculum's
          credit/group inputs), and a multi-line TextArea's intrinsic width breaks out of a flex row at
          large text sizes (found at 320 px, 200%) since nothing there constrains it to the row's own width. */}
      <form onSubmit={submit} className={setupStyles.form} aria-label={t("approvals.declineItem", { summary: request.summary })}>
        <TextArea
          label={t("approvals.declineReason")}
          hint={t("approvals.declineReasonHint")}
          value={reason}
          maxLength={500}
          rows={3}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={busy || reason.trim().length === 0} loading={busy} loadingLabel={t("setup.working")}>
          {t("approvals.declineSubmit")}
        </Button>
      </form>
    </details>
  );
}

export function InboxView({
  requests,
  busy,
  onApprove,
  onDecline,
}: {
  requests: readonly ApprovalSummary[];
  busy: string | null;
  onApprove: (request: ApprovalSummary) => void;
  onDecline: (request: ApprovalSummary, reason: string) => void;
}) {
  if (requests.length === 0) return <p className={setupStyles.empty}>{t("approvals.inbox.empty")}</p>;
  return (
    <ul className={setupStyles.list}>
      {requests.map((request) => (
        <li key={request.id} className={setupStyles.item}>
          <h2 className={setupStyles.itemTitle}>{request.summary}</h2>
          <p className={setupStyles.muted}>
            {kindLabel(request.kind)} · {t("approvals.inbox.requestedBy", { name: request.requestedBy })}
          </p>
          <div className={setupStyles.actions}>
            <Button
              loading={busy === request.id}
              loadingLabel={t("setup.working")}
              disabled={busy !== null && busy !== request.id}
              aria-label={t("approvals.approveItem", { summary: request.summary })}
              onClick={() => onApprove(request)}
            >
              {t("approvals.approve")}
            </Button>
          </div>
          <DeclineForm request={request} busy={busy === request.id} onDecline={(reason) => onDecline(request, reason)} />
        </li>
      ))}
    </ul>
  );
}

export function InboxScreen() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadInbox(api), [api]);
  const { view, reload } = useLoad(loadNow);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<{ ok: true } | { ok: false; reason: keyof typeof REASON_MESSAGE }>, done: string) {
    if (busy) return;
    setBusy(id);
    setFlash(null);
    const result = await action();
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: done } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await reload();
  }

  return (
    <>
      <h1 className={setupStyles.title}>{t("approvals.inbox.title")}</h1>
      <p className={setupStyles.muted}>{t("approvals.inbox.intro")}</p>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {(requests) => (
          <InboxView
            requests={requests}
            busy={busy}
            onApprove={(request) => void run(request.id, () => approve(api, request.id), t("approvals.done.approved"))}
            onDecline={(request, reason) => void run(request.id, () => decline(api, request.id, reason), t("approvals.done.declined"))}
          />
        )}
      </Gate>
    </>
  );
}
