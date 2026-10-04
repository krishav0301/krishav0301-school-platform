import type { components } from "@/api/schema";
import type { MessageKey } from "@/i18n/messages";

export type Teaching = components["schemas"]["Teaching"];
/** One class of the year-wide read (D-108): its subjects and Class Teacher, without the list of teachers to pick from. */
export type ClassTeaching = components["schemas"]["YearTeaching"]["classes"][number];

export type TeachingFailReason = "forbidden" | "rejected" | "conflict" | "failed";

export const REASON_MESSAGE: Record<TeachingFailReason, MessageKey> = {
  forbidden: "people.error.forbidden",
  rejected: "people.error.rejected",
  conflict: "people.teaching.error.conflict",
  failed: "people.error.failed",
};
