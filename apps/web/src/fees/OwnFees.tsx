"use client";

import { useCallback, useState } from "react";

import { t } from "@/i18n/messages";
import { EmptyLine, Panel, ReadFailure, ReadHeader, TableSkeleton, readStyles } from "@/read/ReadView";
import { useSession } from "@/session/SessionProvider";
import { useLoad } from "@/setup/useLoad";

import { AccountView } from "./AccountView";
import { gateFailure, loadOwnAccount, type Sent } from "./client";
import type { Account } from "./model";

export function sentMessage(sent: Sent): string | null {
  if (sent.ok) return null;
  if (sent.reason === "invalid") return sent.message;
  if (sent.reason === "closed") return t("fees.closed");
  if (sent.reason === "inUse") return t("fees.structure.inUse");
  if (sent.reason === "movesPending") return t("fees.structures.movesPending");
  if (sent.reason === "refused") return t("fees.refused");
  return t("fees.failed");
}

/** The student's own fees (source 6.1; redesigned in D-107): figures, what is due next, the history and receipts. */
export function OwnFees() {
  const { api } = useSession();
  const [none, setNone] = useState(false);
  const loadNow = useCallback(async () => {
    const result = await loadOwnAccount(api);
    setNone(!result.ok && result.reason === "not_found");
    return result.ok ? result : gateFailure(result.reason);
  }, [api]);
  const { view, reload } = useLoad<Account>(loadNow);
  const account = view.status === "ready" ? view.data : null;
  return (
    <div className={readStyles.page}>
      <ReadHeader
        title={t("fees.own.title")}
        subtitle={account ? [account.sid, account.className, account.yearLabel].join(" · ") : undefined}
      />
      {view.status === "loading" ? <TableSkeleton rows={6} tiles={4} /> : null}
      {view.status === "failed" && none ? (
        <Panel>
          <EmptyLine>{t("fees.own.none")}</EmptyLine>
        </Panel>
      ) : null}
      {(view.status === "failed" && !none) || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {account ? <AccountView account={account} /> : null}
    </div>
  );
}
