import type { components } from "@/api/schema";
import { formatNpr } from "@/fees/money";
import { t, type MessageKey } from "@/i18n/messages";

export type ApprovalSummary = components["schemas"]["ApprovalSummary"];
export type MyApproval = components["schemas"]["MyApproval"];
export type ApprovalReview = components["schemas"]["ApprovalReview"];
/** The generated schema folds the review's "no detail" null into the type; a detail itself is never null. */
export type ApprovalDetail = NonNullable<components["schemas"]["ApprovalDetail"]>;
export type ApprovalKind = ApprovalSummary["kind"];

/** The five kinds, in the order the filters show them (CLAUDE.md section 6: there are exactly five). */
export const KINDS: readonly ApprovalKind[] = ["website_content", "fee_structure", "discount", "reversal", "refund"];

/** Words for every kind of request (D-061; the four fee kinds since Phase 6, named here since D-084). */
export const KIND_LABEL: Record<ApprovalKind, MessageKey> = {
  website_content: "approvals.kind.websiteContent",
  fee_structure: "approvals.kind.feeStructure",
  discount: "approvals.kind.discount",
  reversal: "approvals.kind.reversal",
  refund: "approvals.kind.refund",
};
/** The shorter names on the filter buttons (D-102). */
export const KIND_FILTER_LABEL: Record<ApprovalKind, MessageKey> = {
  website_content: "approvals.filter.website",
  fee_structure: "approvals.filter.feeStructure",
  discount: "approvals.filter.discount",
  reversal: "approvals.filter.reversal",
  refund: "approvals.filter.refund",
};
export const kindLabel = (kind: ApprovalKind): string => t(KIND_LABEL[kind]);

export type FailReason = "forbidden" | "not_found" | "stale" | "conflict" | "already_decided" | "own_request" | "rejected" | "failed";

export const REASON_MESSAGE: Record<FailReason, MessageKey> = {
  forbidden: "approvals.inbox.forbidden",
  not_found: "content.gone",
  stale: "approvals.error.stale",
  conflict: "approvals.error.conflict",
  already_decided: "approvals.error.conflict",
  own_request: "approvals.error.ownRequest",
  rejected: "approvals.error.rejected",
  failed: "approvals.error.failed",
};

// --- Money and dates -----------------------------------------------------------------------------------------

/** "NPR 12,50,000", or "NPR 4,450.50" when there are paisa: Nepali grouping, never a float (CLAUDE.md section 6). */
export function npr(paisa: number): string {
  const text = formatNpr(paisa);
  return `NPR ${text.endsWith(".00") ? text.slice(0, -3) : text}`;
}

const FREQUENCY: Record<string, MessageKey> = {
  monthly: "approvals.fee.perMonth",
  yearly: "approvals.fee.perYear",
  one_time: "approvals.fee.once",
  whole_course: "approvals.fee.forCourse",
};
/** "NPR 3,500 / month", "NPR 15,000 once". */
export const feeAmount = (amountPaisa: number, frequency: string): string => t(FREQUENCY[frequency] ?? "approvals.fee.once", { amount: npr(amountPaisa) });

const DISCOUNT_REASON: Record<string, MessageKey> = {
  scholarship: "approvals.discount.scholarship",
  sibling: "approvals.discount.sibling",
  staff_child: "approvals.discount.staffChild",
  other: "approvals.discount.other",
};
export const discountReason = (code: string | null | undefined): string | null => (code ? t(DISCOUNT_REASON[code] ?? "approvals.discount.other") : null);

const PAYMENT_METHOD: Record<string, MessageKey> = {
  cash: "approvals.method.cash",
  voucher: "approvals.method.voucher",
  online: "approvals.method.online",
};
export const paymentMethod = (source: string | null | undefined): string | null => (source && PAYMENT_METHOD[source] ? t(PAYMENT_METHOD[source]!) : null);

const CONTENT_KIND: Record<string, MessageKey> = {
  post: "content.kind.post",
  notice: "content.kind.notice",
  holiday: "content.kind.holiday",
  event: "content.kind.event",
  vacancy: "content.kind.vacancy",
  information: "content.kind.information",
  routine: "content.kind.routine",
};
export const contentKindLabel = (kind: string | undefined): string => t(CONTENT_KIND[kind ?? ""] ?? "content.kind.post");

// --- The card: what a request is about, from the snapshot taken when it was sent ------------------------------

interface FeeSnapshot {
  programme?: string;
  level?: string;
  year?: string;
  items?: { name: string; amountPaisa: number; frequency: string }[];
  yearlyTotalPaisa?: number;
}
interface AdjustmentSnapshot {
  student?: string;
  sid?: string;
  amountPaisa?: number;
  percent?: number | null;
  reason?: string | null;
  note?: string | null;
}
interface ContentSnapshot {
  title?: string;
  kind?: string;
}

const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/**
 * A card's words (D-102): a subject line (what it is about) and up to two short summary lines, from the snapshot taken
 * when the request was sent. A request whose snapshot lacks something falls back to the server's own one-line summary.
 */
export function cardLines(request: ApprovalSummary): { subject: string; lines: string[] } {
  const snap = object(request.snapshot);
  switch (request.kind) {
    case "fee_structure": {
      const s = snap as FeeSnapshot;
      if (!s.programme || !s.items) return { subject: request.summary, lines: [] };
      const items = s.items.map((i) => `${i.name} ${feeAmount(i.amountPaisa, i.frequency).replace(/^NPR /, "")}`).join(" · ");
      return {
        subject: [s.programme, s.level, s.year].filter(Boolean).join(" · "),
        lines: [items, ...(s.yearlyTotalPaisa !== undefined ? [t("approvals.card.yearlyTotal", { amount: npr(s.yearlyTotalPaisa) })] : [])],
      };
    }
    case "website_content": {
      const s = snap as ContentSnapshot;
      if (!s.title) return { subject: request.summary, lines: [] };
      return {
        subject: t("approvals.card.contentTitle", { kind: contentKindLabel(s.kind), title: s.title }),
        lines: [t("approvals.card.contentWillPublish", { kind: contentKindLabel(s.kind).toLowerCase() })],
      };
    }
    default: {
      const s = snap as AdjustmentSnapshot;
      if (!s.student || s.amountPaisa === undefined) return { subject: request.summary, lines: [] };
      const amount = npr(s.amountPaisa);
      if (request.kind === "discount") {
        const reason = discountReason(s.reason);
        const parts = [s.percent ? t("approvals.card.percentOf", { amount, percent: s.percent }) : amount, ...(reason ? [t("approvals.card.reason", { reason })] : [])];
        return { subject: s.student, lines: [parts.join(" · ")] };
      }
      if (request.kind === "reversal") return { subject: s.student, lines: [[amount, ...(s.note ? [t("approvals.card.reason", { reason: s.note })] : [])].join(" · ")] };
      return { subject: s.student, lines: [[amount, t("approvals.card.studentCredit")].join(" · ")] };
    }
  }
}

// --- The list: counts, filter and sort ----------------------------------------------------------------------

export type Sort = "newest" | "oldest";

export function countByKind(requests: readonly ApprovalSummary[]): Record<ApprovalKind, number> {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<ApprovalKind, number>;
  for (const r of requests) counts[r.kind] += 1;
  return counts;
}

export function visibleRequests(requests: readonly ApprovalSummary[], kind: ApprovalKind | null, sort: Sort): ApprovalSummary[] {
  const shown = kind ? requests.filter((r) => r.kind === kind) : [...requests];
  return shown.sort((a, b) => (sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
}

/** "RP" for Rajendra Prasad Shah: first and last initials, for the requester's round avatar. */
export const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return `${words[0]![0]}${words.length > 1 ? words.at(-1)![0] : ""}`.toUpperCase();
};

/** What approving does, said before and after, in the kind's own words (D-102). */
export function effectLines(detail: ApprovalDetail | null, kind: ApprovalKind): { confirm: string; done: string } {
  switch (kind) {
    case "fee_structure": {
      const d = detail?.kind === "fee_structure" ? detail : null;
      const what = d ? `${d.programme}, ${d.level}, ${d.year}` : "";
      return { confirm: t("approvals.effect.feeStructure"), done: d ? t("approvals.done.feeStructure", { what }) : t("approvals.done.generic") };
    }
    case "website_content":
      return { confirm: t("approvals.effect.content"), done: t("approvals.done.content") };
    case "discount":
      return { confirm: t("approvals.effect.discount"), done: t("approvals.done.discount") };
    case "reversal":
      return { confirm: t("approvals.effect.reversal"), done: t("approvals.done.reversal") };
    case "refund":
      return { confirm: t("approvals.effect.refund"), done: t("approvals.done.refund") };
  }
}

/** Two short lines naming the request, for the confirmation: "Fee structure" / "+2 Science · Grade 11 · 2083". */
export function confirmSubject(request: ApprovalSummary, detail: ApprovalDetail | null): { kind: string; subject: string; amountLabel: string | null; amount: string | null } {
  const kind = kindLabel(request.kind);
  if (!detail) return { kind, subject: cardLines(request).subject, amountLabel: null, amount: null };
  switch (detail.kind) {
    case "fee_structure":
      return { kind, subject: `${detail.programme} · ${detail.level} · ${detail.year}`, amountLabel: t("approvals.detail.yearlyTotal"), amount: npr(detail.yearlyTotalPaisa) };
    case "website_content":
      return { kind, subject: `${contentKindLabel(detail.contentKind)}: ${detail.title}`, amountLabel: null, amount: null };
    case "discount":
      return { kind, subject: detail.student, amountLabel: t("approvals.detail.discount"), amount: npr(detail.amountPaisa) };
    case "reversal":
      return { kind, subject: detail.student, amountLabel: t("approvals.detail.originalPayment"), amount: npr(detail.amountPaisa) };
    case "refund":
      return { kind, subject: detail.student, amountLabel: t("approvals.detail.refundAmount"), amount: npr(detail.amountPaisa) };
  }
}
