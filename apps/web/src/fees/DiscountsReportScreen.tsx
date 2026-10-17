"use client";

import Link from "next/link";
import { useCallback } from "react";

import { formatBsDate } from "@/content/model";
import { t } from "@/i18n/messages";
import { useSession } from "@/session/SessionProvider";
import { EmptyLine, Panel, ReadFailure, ReadHeader, ReadTable, StatusWord, TableSkeleton, readStyles } from "@/read/ReadView";
import { useLoad } from "@/setup/useLoad";

import { gateFailure, loadDiscountReport } from "./client";
import { REASON_LABEL, type DiscountReport } from "./model";
import { nprShort } from "./ReadFees";

const STATUS: Record<DiscountReport["discounts"][number]["status"], { key: "fees.report.statusActive" | "fees.report.statusRemoved" | "fees.report.statusChanged"; tone?: "ok" | "bad" }> = {
  active: { key: "fees.report.statusActive", tone: "ok" },
  removed: { key: "fees.report.statusRemoved", tone: "bad" },
  replaced: { key: "fees.report.statusChanged" },
};

/** Every discount given, with who gave it and when, so the Principal sees them in one place. Pure. */
export function DiscountsTable({ discounts }: { discounts: DiscountReport["discounts"] }) {
  if (discounts.length === 0) return <EmptyLine>{t("fees.report.empty")}</EmptyLine>;
  return (
    <ReadTable
      caption={t("fees.report.title")}
      rows={discounts}
      rowKey={(d) => d.id}
      columns={[
        { key: "student", label: t("fees.col.student"), primary: true, cell: (d) => `${d.studentName} · ${d.sid}` },
        { key: "class", label: t("attendance.col.class"), hidePhone: true, cell: (d) => d.className },
        { key: "amount", label: t("fees.col.amount"), align: "end", cell: (d) => nprShort(d.amountPaisa) },
        { key: "reason", label: t("fees.discount.reason"), cell: (d) => [t(REASON_LABEL[d.reason]), d.note].filter(Boolean).join(" · ") },
        { key: "given", label: t("fees.report.given"), hidePhone: true, cell: (d) => [d.givenOnBs ? formatBsDate(d.givenOnBs) : null, d.givenBy].filter(Boolean).join(" · ") },
        { key: "status", label: t("attendance.class.status"), cell: (d) => <StatusWord tone={STATUS[d.status].tone}>{t(STATUS[d.status].key)}</StatusWord> },
      ]}
    />
  );
}

/** The Principal's Discounts report: what the active discounts add up to, and the whole list. */
export function DiscountsReportScreen() {
  const { api } = useSession();
  const loadNow = useCallback(async () => {
    const report = await loadDiscountReport(api);
    return report.ok ? report : gateFailure(report.reason);
  }, [api]);
  const { view, reload } = useLoad<DiscountReport>(loadNow);
  return (
    <div className={readStyles.page}>
      <ReadHeader title={t("fees.report.title")} subtitle={view.status === "ready" ? t("fees.report.subtitle", { count: view.data.activeCount, amount: nprShort(view.data.activePaisa) }) : t("fees.report.intro")} />
      {view.status === "loading" ? <TableSkeleton rows={5} /> : null}
      {view.status === "failed" || view.status === "forbidden" ? <ReadFailure status={view.status} onRetry={() => void reload()} /> : null}
      {view.status === "ready" ? (
        <Panel title={t("fees.report.list")} labelledBy="discounts-report">
          <DiscountsTable discounts={view.data.discounts} />
        </Panel>
      ) : null}
      <p className={readStyles.rowMeta}>
        <Link href="/portal/fees">{t("fees.report.back")}</Link>
      </p>
    </div>
  );
}
