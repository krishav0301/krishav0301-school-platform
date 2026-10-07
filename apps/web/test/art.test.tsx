import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/i18n/messages";
import { HeroBand, Illustration } from "@/ui";
import { ART_CODES, ART_READY, OVERVIEW_ART, SLOGANS, artForPath } from "@/ui/art";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/people/teaching", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** D-126: every page's hero has a picture's place, labelled with the code of its prompt in docs/illustrations.md. */
describe("which picture a page shows", () => {
  it("the longest matching address wins, so Teaching is not taken for People", () => {
    expect(artForPath("/portal/people/teaching")).toBe("P5");
    expect(artForPath("/portal/people")).toBe("P13");
    expect(artForPath("/portal/setup/teaching")).toBe("P5");
    expect(artForPath("/portal/setup/subjects")).toBe("P14");
    expect(artForPath("/portal/fees/student/")).toBe("P10");
  });

  it("the public home and pages have their own; the overview chooses by role, so its address gives none", () => {
    expect(artForPath("/")).toBe("W1");
    expect(artForPath("/sign-in")).toBe("W9");
    expect(artForPath("/privacy")).toBe("W11");
    expect(artForPath("/portal")).toBeNull();
    expect(artForPath("/portal/more")).toBeNull();
    expect(artForPath(null)).toBeNull();
  });

  it("does not match a page whose address merely starts with the same letters", () => {
    expect(artForPath("/admissionsx")).toBeNull();
    expect(artForPath("/portal/feesx")).toBeNull();
  });

  it("each role's overview has its own picture", () => {
    expect(new Set(Object.values(OVERVIEW_ART)).size).toBe(Object.keys(OVERVIEW_ART).length);
  });

  it("every slogan is in the catalog", () => {
    for (const key of Object.values(SLOGANS)) expect(t(key!)).not.toBe(key);
  });

  it("every code has its prompt in docs/illustrations.md, and the document names no code that does not exist", () => {
    const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "illustrations.md"), "utf8");
    const listed = new Set([...doc.matchAll(/^\| \*\*([A-Z]\d+)\*\* \|/gm)].map((m) => m[1]));
    expect([...listed].sort()).toEqual([...ART_CODES].sort());
  });
});

describe("a picture's place", () => {
  it("until its picture is added it is a box showing its code, hidden from screen readers", () => {
    expect(ART_READY.has("P5")).toBe(false);
    const html = renderToStaticMarkup(<Illustration code="P5" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">P5<");
    expect(html).not.toContain("<img");
  });

  it("the hero band keeps the page's own heading and adds the address's picture and its line", () => {
    const html = renderToStaticMarkup(
      <HeroBand>
        <h1>Teaching</h1>
      </HeroBand>,
    );
    expect(html).toContain("<h1>Teaching</h1>");
    expect(html).toContain(">P5<");
    expect(html).toContain(t("art.slogan.P5"));
  });

  it("a page can choose its picture, or none", () => {
    expect(renderToStaticMarkup(<HeroBand art="P2">x</HeroBand>)).toContain(">P2<");
    const none = renderToStaticMarkup(<HeroBand art={null}>x</HeroBand>);
    expect(none).not.toContain("aria-hidden");
  });
});
