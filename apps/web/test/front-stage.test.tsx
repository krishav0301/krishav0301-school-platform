import { describe, expect, it } from "vitest";

import { frontStage } from "@/site/front-stage";

const ready = { status: "ready", site: { layout: "scroll", scroll: {} } } as never;
const loading = { status: "loading" } as const;

describe("which front page to draw while things load (PM, 2026-10-13: nothing else may flash)", () => {
  it("draws nothing before the school is known", () => {
    expect(frontStage("loading", undefined, loading)).toBe("waiting");
  });

  it("gives a school the Worker says is not a one-page school its sign-in front at once, even before its settings load", () => {
    expect(frontStage("loading", undefined, loading, "classic")).toBe("signin");
  });

  it("keeps the empty page for a school the Worker says is scroll, and when nothing says (a static file with no Worker)", () => {
    expect(frontStage("loading", undefined, loading, "scroll")).toBe("waiting");
    expect(frontStage("loading", undefined, loading, undefined)).toBe("waiting");
  });

  it("keeps waiting, not the sign-in front, while a one-page school's words load", () => {
    expect(frontStage("ready", "scroll", loading)).toBe("waiting");
  });

  it("draws the one-page layout once its words are here", () => {
    expect(frontStage("ready", "scroll", ready)).toBe("scroll");
  });

  it("gives every other school the sign-in front at once, with no words to wait for (PM, 2026-10-18, D-177)", () => {
    expect(frontStage("ready", "classic", loading)).toBe("signin");
    expect(frontStage("ready", undefined, loading)).toBe("signin");
    expect(frontStage("ready", "classic", { status: "failed" })).toBe("signin");
    expect(frontStage("ready", "classic", { status: "notReady" })).toBe("signin");
  });

  it("says so inside the usual frame when the school is not set up or cannot be reached", () => {
    expect(frontStage("unprovisioned", undefined, loading)).toBe("message");
    expect(frontStage("unreachable", undefined, loading)).toBe("message");
  });

  it("lets a one-page school whose words failed to load show a retry button, never the sign-in front", () => {
    expect(frontStage("ready", "scroll", { status: "failed" })).toBe("retry");
    expect(frontStage("ready", "scroll", { status: "notReady" })).toBe("retry");
  });
});
