import { describe, expect, it } from "vitest";

import { SITE_LINKS } from "@/shell/site-links";
import { applyRedirectFor } from "@/site/scroll/choose-home";
import { siteLinksFor } from "@/shell/site-links";

describe("which page links a school's shared pages offer", () => {
  it("none before the school is known, none for the one-page layout, all for the classic layout", () => {
    expect(siteLinksFor(null)).toEqual([]);
    expect(siteLinksFor({ school: { publicLayout: "scroll" } })).toEqual([]);
    expect(siteLinksFor({ school: { publicLayout: "classic" } })).toEqual(SITE_LINKS);
    expect(siteLinksFor({ school: {} })).toEqual(SITE_LINKS);
  });
});

describe("the old apply page", () => {
  it("sends a visitor of a school with the one-page layout to the form on the front page, and leaves every other school alone", () => {
    expect(applyRedirectFor({ status: "ready", site: { layout: "scroll", scroll: {} } as never })).toBe("/#admission");
    expect(applyRedirectFor({ status: "ready", site: { layout: "classic" } as never })).toBeNull();
    expect(applyRedirectFor({ status: "loading" })).toBeNull();
    expect(applyRedirectFor({ status: "failed" })).toBeNull();
  });
});
