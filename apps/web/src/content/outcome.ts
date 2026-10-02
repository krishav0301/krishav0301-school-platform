import type { MessageKey } from "@/i18n/messages";

import type { ToggleResult } from "./client";

/**
 * What to tell the Admin after Publish, Take down or Undo. There is no "are you sure" (D-048): both
 * actions are common and fully reversible, so the message says exactly what happened, names the item, and
 * offers to undo it. The offer stays until the person does something else; it is never on a timer.
 */
export interface ToggleOutcome {
  tone: "ok" | "bad";
  message: MessageKey;
  /** Reload the list: what the screen shows may no longer be true. */
  refresh: boolean;
  /** What to do to reverse it. `publish` is the action the undo performs. */
  undo?: { id: string; title: string; publish: boolean };
}

export function outcomeOfToggle(result: ToggleResult, action: { id: string; title: string; publish: boolean; isUndo?: boolean }): ToggleOutcome {
  const { id, title, publish, isUndo = false } = action;

  if (result.ok) {
    if (isUndo) return { tone: "ok", message: publish ? "content.undone.published" : "content.undone.draft", refresh: true };
    return {
      tone: "ok",
      message: publish ? (result.scheduled ? "content.done.scheduled" : "content.done.published") : "content.done.takenDown",
      refresh: true,
      undo: { id, title, publish: !publish },
    };
  }

  switch (result.reason) {
    case "conflict":
      return { tone: "bad", message: publish ? "content.alreadyLive" : "content.notLive", refresh: true };
    case "gone":
      return { tone: "bad", message: "content.gone", refresh: true };
    case "forbidden":
      return { tone: "bad", message: "content.forbidden", refresh: false };
    default:
      return { tone: "bad", message: "content.actionFailed", refresh: false };
  }
}
