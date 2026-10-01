import type { components } from "@/api/schema";
import { t, type MessageKey } from "@/i18n/messages";

export type ApprovalSummary = components["schemas"]["ApprovalSummary"];
export type MyApproval = components["schemas"]["MyApproval"];

/** Words for every kind of request (D-061; the four fee kinds since Phase 6, named here since D-084). */
export const KIND_LABEL: Partial<Record<ApprovalSummary["kind"], MessageKey>> = {
  website_content: "approvals.kind.websiteContent",
  fee_structure: "approvals.kind.feeStructure",
  discount: "approvals.kind.discount",
  reversal: "approvals.kind.reversal",
  refund: "approvals.kind.refund",
};
export const kindLabel = (kind: ApprovalSummary["kind"]): string => {
  const key = KIND_LABEL[kind];
  return key ? t(key) : kind;
};

export type FailReason = "forbidden" | "not_found" | "stale" | "conflict" | "rejected" | "failed";

export const REASON_MESSAGE: Record<FailReason, MessageKey> = {
  forbidden: "approvals.inbox.forbidden",
  not_found: "content.gone",
  stale: "approvals.error.stale",
  conflict: "approvals.error.conflict",
  rejected: "approvals.error.rejected",
  failed: "approvals.error.failed",
};
