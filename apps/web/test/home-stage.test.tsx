import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { homeStage } from "@/site/scroll/choose-home";
import { HomeWaiting } from "@/site/scroll/HomeWaiting";

const ready = { status: "ready", site: { layout: "scroll", scroll: {} } } as never;
const loading = { status: "loading" } as const;

describe("which front page to draw while things load (PM, 2026-10-13: the old page must never flash)", () => {
  it("draws nothing of the old page before the school is known", () => {
    expect(homeStage("loading", undefined, loading)).toBe("waiting");
  });

  it("keeps waiting, not the old frame, while a one-page school's words load", () => {
    expect(homeStage("ready", "scroll", loading)).toBe("waiting");
  });

  it("draws the one-page layout once its words are here", () => {
    expect(homeStage("ready", "scroll", ready)).toBe("scroll");
  });

  it("gives a classic school its usual frame at once, with its own loading shape", () => {
    expect(homeStage("ready", "classic", loading)).toBe("classic");
    expect(homeStage("ready", undefined, loading)).toBe("classic");
  });

  it("says so inside the usual frame when the school is not set up or cannot be reached", () => {
    expect(homeStage("unprovisioned", undefined, loading)).toBe("message");
    expect(homeStage("unreachable", undefined, loading)).toBe("message");
  });

  it("lets a one-page school whose words failed to load fall back to the frame with its retry button", () => {
    expect(homeStage("ready", "scroll", { status: "failed" })).toBe("classic");
    expect(homeStage("ready", "scroll", { status: "notReady" })).toBe("classic");
  });
});

describe("the waiting screen", () => {
  const html = renderToStaticMarkup(<HomeWaiting />);

  it("is an empty full-height page that only a screen reader is told about: no header, footer, menu, band or skeleton", () => {
    expect(html).toMatch(/role="status"/);
    expect(html).toContain("Loading");
    for (const word of ["<header", "<footer", "<nav", "<h1", "skeleton"]) expect(html).not.toContain(word);
  });
});
