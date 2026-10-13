import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { NoticeBoard } from "@/content/NoticeBoard";
import royalJson from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/notices", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config = (layout?: "classic" | "scroll"): PublicConfig => ({
  school: { name: "Some School", shortName: "Some", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null, ...(layout ? { publicLayout: layout } : {}) },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royalJson.theme as PublicConfig["theme"],
});
const page = (layout?: "classic" | "scroll") =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(layout))}>
      <NoticeBoard />
    </ConfigContext.Provider>,
  );

describe("the notices page", () => {
  it("is only the heading and the notices for a school with the one-page layout: no picture band (PM, 2026-10-13)", () => {
    const html = page("scroll");
    expect(html).toContain("Notices and updates");
    expect(html).not.toMatch(/W7|Stay up to date/);
  });

  it("keeps its picture band for every other school", () => {
    expect(page("classic")).toMatch(/W7|Stay up to date/);
    expect(page()).toMatch(/W7|Stay up to date/);
  });
});
