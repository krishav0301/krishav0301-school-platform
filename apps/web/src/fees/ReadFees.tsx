"use client";

import { t } from "@/i18n/messages";
import { StatusWord } from "@/read/ReadView";

import { formatNprShort } from "./money";

/** "NPR 12,50,000", the paisa shown only when there are some (D-104). */
export const nprShort = (paisa: number): string => t("fees.npr", { amount: formatNprShort(paisa) });

/** What a student's balance says in words (admin FUT F-10: nothing charged is not paid up). */
export function balanceState(row: { chargedPaisa: number; paidPaisa: number; duePaisa: number; overduePaisa?: number; balancePaisa?: number }): "nothing" | "credit" | "clear" | "overdue" | "due" {
  if (row.chargedPaisa === 0 && row.paidPaisa === 0) return "nothing";
  if ((row.balancePaisa ?? 0) < 0) return "credit";
  if (row.duePaisa === 0) return "clear";
  return (row.overduePaisa ?? 0) > 0 ? "overdue" : "due";
}

/** The balance as a status word: Nothing charged yet, Paid up, Credit NPR …, Due NPR …, Overdue NPR …. */
export function BalanceWord({ row, amounts = true }: { row: { chargedPaisa: number; paidPaisa: number; duePaisa: number; overduePaisa?: number; balancePaisa?: number }; amounts?: boolean }) {
  const state = balanceState(row);
  // Beside columns that already give the amounts, the word alone (D-104).
  if (!amounts && (state === "overdue" || state === "due")) return <StatusWord tone={state === "overdue" ? "bad" : "warn"}>{t(state === "overdue" ? "fees.summary.overdue" : "fees.balance.dueWord")}</StatusWord>;
  if (state === "nothing") return <StatusWord>{t("fees.dues.nothingCharged")}</StatusWord>;
  if (state === "clear") return <StatusWord tone="ok">{t("fees.dues.clear")}</StatusWord>;
  if (state === "credit") return <StatusWord tone="ok">{t("fees.balance.credit", { amount: formatNprShort(-(row.balancePaisa ?? 0)) })}</StatusWord>;
  if (state === "overdue") return <StatusWord tone="bad">{t("fees.balance.overdue", { amount: formatNprShort(row.duePaisa) })}</StatusWord>;
  return <StatusWord tone="warn">{t("fees.balance.due", { amount: formatNprShort(row.duePaisa) })}</StatusWord>;
}
