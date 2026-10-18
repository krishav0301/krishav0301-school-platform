import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { chooseHome } from "@/site/scroll/choose-home";
import { PrivacyView } from "@/site/PrivacyView";
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

describe("a page every school has, such as the privacy notice", () => {
  const frame = (site: typeof scrollSite) =>
    renderToStaticMarkup(
      <SiteFrameView title="Privacy" view={{ status: "ready", site } as SiteView} onRetry={() => {}}>
        {() => <p>PAGE-WORDS</p>}
      </SiteFrameView>,
    );

  it("is readable for a scroll school and for every other school (the old classic-only pages are gone, D-177)", () => {
    for (const site of [scrollSite, classicSite]) {
      const html = frame(site);
      expect(html).toContain("PAGE-WORDS");
      expect(html).not.toContain("This Page Is Not Available");
    }
  });
});

describe("the privacy notice for a school that takes applications without an email (review I1)", () => {
  const collected = (collectsEmail: boolean) => renderToStaticMarkup(<PrivacyView schoolName="Some School" site={scrollSite} collectsEmail={collectsEmail} />);

  it("does not say an email is collected when none is asked for", () => {
    expect(collected(false)).not.toMatch(/email/i);
  });

  it("still says so for every other school", () => {
    expect(collected(true)).toMatch(/email/i);
  });
});
