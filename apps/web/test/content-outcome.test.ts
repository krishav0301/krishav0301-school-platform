import { describe, expect, it } from "vitest";

import { outcomeOfToggle, type ToggleOutcome } from "@/content/outcome";
import { en, t } from "@/i18n/messages";

const ok = { ok: true } as const;
const say = (o: ToggleOutcome) => t(o.message, { title: "Fee notice" });

describe("outcomeOfToggle: what to tell the Admin after Publish, Take down or Undo", () => {
  it("publishing says so with the item's name, and offers to undo it as 'Undo publish'", () => {
    const o = outcomeOfToggle(ok, { id: "a", title: "Fee notice", publish: true });
    expect(o).toMatchObject({ tone: "ok", refresh: true, undo: { id: "a", title: "Fee notice", publish: false } });
    expect(say(o)).toBe("Published: “Fee notice” shows on the website from its start day.");
    expect(t(o.undo!.publish ? "content.undoTakeDown" : "content.undoPublish")).toBe("Undo publish");
  });

  it("taking down says so, and offers to undo it as 'Undo take down'", () => {
    const o = outcomeOfToggle(ok, { id: "a", title: "Fee notice", publish: false });
    expect(o).toMatchObject({ tone: "ok", refresh: true, undo: { id: "a", title: "Fee notice", publish: true } });
    expect(say(o)).toBe("Taken down: “Fee notice” is a draft again.");
    expect(t(o.undo!.publish ? "content.undoTakeDown" : "content.undoPublish")).toBe("Undo take down");
  });

  it("an undo says what it did, shows the result, and does not offer another undo", () => {
    const back = outcomeOfToggle(ok, { id: "a", title: "Fee notice", publish: false, isUndo: true });
    expect(say(back)).toBe("Undone: “Fee notice” is a draft again.");
    expect(back.undo).toBeUndefined();
    const again = outcomeOfToggle(ok, { id: "a", title: "Fee notice", publish: true, isUndo: true });
    expect(say(again)).toBe("Undone: “Fee notice” is on the website again.");
    expect(again.undo).toBeUndefined();
  });

  it("someone else got there first (409): says so plainly, refreshes the list, offers no undo", () => {
    const published = outcomeOfToggle({ ok: false, reason: "conflict" }, { id: "a", title: "T", publish: true });
    const takenDown = outcomeOfToggle({ ok: false, reason: "conflict" }, { id: "a", title: "T", publish: false });
    expect(published).toMatchObject({ tone: "bad", refresh: true });
    expect(en[published.message]).toContain("already on the website");
    expect(en[takenDown.message]).toContain("already off the website");
    expect(published.undo).toBeUndefined();
    expect(takenDown.undo).toBeUndefined();
  });

  it("an item that is gone refreshes the list; a refusal or a network failure does not, and none offer an undo", () => {
    const gone = outcomeOfToggle({ ok: false, reason: "gone" }, { id: "a", title: "T", publish: true });
    expect(gone).toMatchObject({ tone: "bad", message: "content.gone", refresh: true });
    const forbidden = outcomeOfToggle({ ok: false, reason: "forbidden" }, { id: "a", title: "T", publish: true });
    expect(forbidden).toMatchObject({ tone: "bad", message: "content.forbidden", refresh: false });
    const failed = outcomeOfToggle({ ok: false, reason: "failed" }, { id: "a", title: "T", publish: false });
    expect(failed).toMatchObject({ tone: "bad", message: "content.actionFailed", refresh: false });
    for (const o of [gone, forbidden, failed]) expect(o.undo).toBeUndefined();
  });

  it("a failed undo is reported like any other failure, with no further undo", () => {
    const o = outcomeOfToggle({ ok: false, reason: "conflict" }, { id: "a", title: "T", publish: true, isUndo: true });
    expect(o.tone).toBe("bad");
    expect(o.undo).toBeUndefined();
  });
});

describe("no 'are you sure' is left over", () => {
  it("the catalog has no confirmation questions or Yes buttons for publishing or taking down", () => {
    for (const key of Object.keys(en)) {
      expect(key, key).not.toMatch(/^content\.(publishAsk|takeDownAsk|confirmPublish|confirmTakeDown)$/);
    }
    for (const [key, text] of Object.entries(en)) if (key.startsWith("content")) expect(text, key).not.toMatch(/^Yes\b/);
  });
});
