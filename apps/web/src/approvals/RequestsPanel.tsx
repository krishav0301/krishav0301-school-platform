"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import setupStyles from "@/setup/setup.module.css";
import { Gate, useLoad } from "@/setup/useLoad";
import { Badge, Button, Notice } from "@/ui";

import { loadMine, withdraw } from "./client";
import { kindLabel, REASON_MESSAGE, type MyApproval } from "./model";

type Flash = { tone: "ok" | "bad"; text: string };

/**
 * A Co-ordinator's own approval requests: a pending one can be withdrawn (the request's own id, not the
 * content item's, since withdrawing is an approvals concern); a declined one shows why. Approved and
 * withdrawn requests fade from view once their content item's own status already says so.
 */
export function RequestsView({ requests, busy, onWithdraw }: { requests: readonly MyApproval[]; busy: string | null; onWithdraw: (request: MyApproval) => void }) {
  const shown = requests.filter((r) => r.status === "pending" || r.status === "declined");
  if (shown.length === 0) return <p className={setupStyles.empty}>{t("approvals.mine.empty")}</p>;
  return (
    <ul className={setupStyles.list}>
      {shown.map((request) => (
        <li key={request.id} className={setupStyles.item}>
          <h3 className={setupStyles.itemTitle}>{request.summary}</h3>
          <div className={setupStyles.badges}>
            <Badge>{kindLabel(request.kind)}</Badge>
            {request.status === "pending" ? <Badge tone="neutral">{t("approvals.mine.pending")}</Badge> : null}
          </div>
          {request.status === "declined" ? <p className={setupStyles.muted}>{t("approvals.mine.declinedWhy", { reason: request.decisionReason ?? "" })}</p> : null}
          {request.status === "pending" ? (
            <div className={setupStyles.actions}>
              <Button
                variant="quiet"
                loading={busy === request.id}
                loadingLabel={t("setup.working")}
                disabled={busy !== null && busy !== request.id}
                aria-label={t("content.withdrawItem", { title: request.summary })}
                onClick={() => onWithdraw(request)}
              >
                {t("content.withdraw")}
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function RequestsPanel() {
  const { api } = useSession();
  const loadNow = useCallback(() => loadMine(api), [api]);
  const { view, reload } = useLoad(loadNow);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function doWithdraw(request: MyApproval) {
    if (busy) return;
    setBusy(request.id);
    setFlash(null);
    const result = await withdraw(api, request.id);
    setBusy(null);
    setFlash(result.ok ? { tone: "ok", text: t("content.done.withdrawn", { title: request.summary }) } : { tone: "bad", text: t(REASON_MESSAGE[result.reason]) });
    await reload();
  }

  return (
    <>
      <h2 className={setupStyles.subhead}>{t("approvals.mine.title")}</h2>
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <Gate view={view} onRetry={() => void reload()}>
        {(requests) => <RequestsView requests={requests} busy={busy} onWithdraw={(r) => void doWithdraw(r)} />}
      </Gate>
    </>
  );
}
