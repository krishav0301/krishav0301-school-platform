import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { chooseHome } from "@/site/scroll/choose-home";
import { SiteFrameView, type SiteView } from "@/site/SiteFrame";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import royalJson from "../../../packs/royal-softech/pack.json";
import { siteFrom } from "./site-fixture";

vi.mock("next/navigation", () => ({ usePathname: () => "/programmes", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const scrollSite = siteFrom(lahanJson as never);
const classicSite = siteFrom(royalJson as never);

describe("which front page a school gets", () => {
  it("is the scroll page for a school that chose it, once its words have loaded", () => {
    expect(chooseHome({ status: "ready", site: scrollSite })).toBe("scroll");
  });

  it("is the classic page for a school that did not", () => {
    expect(chooseHome({ status: "ready", site: classicSite })).toBe("classic");
  });

  it("waits while the words load, and falls back to classic if the scroll words are somehow missing", () => {
    expect(chooseHome({ status: "loading" })).toBe("loading");
    expect(chooseHome({ status: "failed" })).toBe("loading");
    expect(chooseHome({ status: "ready", site: { ...scrollSite, scroll: undefined } })).toBe("classic");
  });
});

describe("the classic pages on a scroll school", () => {
  const frame = (site: typeof scrollSite) =>
    renderToStaticMarkup(
      <SiteFrameView title="Programmes" view={{ status: "ready", site } as SiteView} onRetry={() => {}}>
        {() => <p>CLASSIC-WORDS</p>}
      </SiteFrameView>,
    );

  it("say the page is not available, and lead home, instead of showing placeholder words", () => {
    const html = frame(scrollSite);
    expect(html).not.toContain("CLASSIC-WORDS");
    expect(html).toContain("This page is not available");
    expect(html).toMatch(/<a[^>]*href="\/"/);
  });

  it("are unchanged for a classic school", () => {
    expect(frame(classicSite)).toContain("CLASSIC-WORDS");
    expect(frame(classicSite)).not.toContain("This page is not available");
  });
});
