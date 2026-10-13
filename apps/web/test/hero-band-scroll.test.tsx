import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { HeroBand } from "@/ui";
import royalJson from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

const here = vi.hoisted(() => ({ path: "/privacy" }));
vi.mock("next/navigation", () => ({ usePathname: () => here.path, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config = (layout: "classic" | "scroll"): PublicConfig => ({
  school: { name: "Some School", shortName: "Some", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null, publicLayout: layout },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: {},
  theme: royalJson.theme as PublicConfig["theme"],
});
const band = (path: string, layout: "classic" | "scroll", art?: "W11" | "P2" | null) => {
  here.path = path;
  return renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config(layout))}>
      <HeroBand art={art}>x</HeroBand>
    </ConfigContext.Provider>,
  );
};

describe("the page band on a school's public pages", () => {
  it("draws no picture for a school with the one-page layout (its shared pages are just words, PM 2026-10-13)", () => {
    for (const path of ["/privacy", "/notices", "/reset-password", "/sign-in"]) expect(band(path, "scroll"), path).not.toMatch(/W\d+|artSide|illustrations/);
  });

  it("still draws its picture for every other school", () => {
    expect(band("/privacy", "classic")).toMatch(/W11/);
  });

  it("keeps the portal's pictures for a school with the one-page layout: only its public pages lose them", () => {
    expect(band("/portal/people", "scroll")).toMatch(/P13/);
  });

  it("obeys a band that is asked for a picture by name", () => {
    expect(band("/privacy", "scroll", "P2")).toMatch(/P2/);
  });
});
