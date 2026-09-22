import type { components } from "@/api/schema";
import type { MessageKey } from "@/i18n/messages";

export type Teaching = components["schemas"]["Teaching"];

export type TeachingFailReason = "forbidden" | "rejected" | "conflict" | "failed";

export const REASON_MESSAGE: Record<TeachingFailReason, MessageKey> = {
  forbidden: "people.error.forbidden",
  rejected: "people.error.rejected",
  conflict: "people.teaching.error.conflict",
  failed: "people.error.failed",
};
