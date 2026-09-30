import type { components } from "@/api/schema";
import type { MessageKey } from "@/i18n/messages";

export type Account = components["schemas"]["FeeAccount"];
export type Receipt = components["schemas"]["Receipt"];
export type FeeStructure = components["schemas"]["FeeStructure"];
export type FeeStructureList = components["schemas"]["FeeStructureList"];
export type VoucherList = components["schemas"]["VoucherList"];
export type DuesList = components["schemas"]["DuesList"];
export type AdjustmentList = components["schemas"]["AdjustmentList"];
export type Frequency = FeeStructure["items"][number]["frequency"];
export type LedgerKind = Account["entries"][number]["kind"];

export const FREQUENCY_LABEL: Record<Frequency, MessageKey> = {
  one_time: "fees.frequency.oneTime",
  monthly: "fees.frequency.monthly",
  yearly: "fees.frequency.yearly",
  whole_course: "fees.frequency.wholeCourse",
};

export const KIND_LABEL: Record<LedgerKind, MessageKey> = {
  charge: "fees.kind.charge",
  carried_dues: "fees.kind.carried",
  discount: "fees.kind.discount",
  payment: "fees.kind.payment",
  reversal: "fees.kind.reversal",
  refund: "fees.kind.refund",
};

export const STATUS_LABEL: Record<FeeStructure["status"], MessageKey> = {
  draft: "fees.status.draft",
  waiting: "fees.status.waiting",
  live: "fees.status.live",
};

export const REASON_LABEL: Record<"scholarship" | "sibling" | "staff_child" | "other", MessageKey> = {
  scholarship: "fees.reason.scholarship",
  sibling: "fees.reason.sibling",
  staff_child: "fees.reason.staffChild",
  other: "fees.reason.other",
};

export const ADJUSTMENT_STATUS: Record<AdjustmentList["adjustments"][number]["status"], MessageKey> = {
  draft: "fees.adjustment.pending",
  pending: "fees.adjustment.pending",
  approved: "fees.adjustment.approved",
  recorded: "fees.adjustment.recorded",
  closed: "fees.adjustment.closed",
};

export const ADJUSTMENT_KIND: Record<AdjustmentList["adjustments"][number]["kind"], MessageKey> = {
  discount: "fees.kind.discount",
  reversal: "fees.kind.reversal",
  refund: "fees.kind.refund",
};

/** A random key for one payment attempt at the counter, so a retried Save records it once. */
export function newIdempotencyKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
