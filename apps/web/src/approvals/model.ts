import type { components } from "@/api/schema";
import { t, type MessageKey } from "@/i18n/messages";

export type ApprovalSummary = components["schemas"]["ApprovalSummary"];
export type MyApproval = components["schemas"]["MyApproval"];

/** Only `website_content` has words yet (D-061): the other four kinds are not wired until Phase 6. */
export const KIND_LABEL: Partial<Record<ApprovalSummary["kind"], MessageKey>> = {
  website_content: "content.title",
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
