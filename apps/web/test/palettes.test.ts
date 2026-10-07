import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { checkContrast } from "../../api/src/core/theme"; // the server's own readability rules
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { SessionContext } from "@/session/SessionProvider";
import { AppearanceCard } from "@/settings/SettingsScreen";
import { InvalidThemeError, paletteToCss } from "@/theme/css";
import { PALETTES, SCHOOL_PALETTE } from "@/theme/palettes";
import { PALETTE_BOOT_SCRIPT, paletteCss } from "@/theme/personal";
import royal from "../../../packs/royal-softech/pack.json";
import { fakeSession } from "./session";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/settings", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** D-127: a person may lay a calm palette over the school's colours in their own portal. */
describe("the colour palettes", () => {
  it("every palette passes the same readability rules as a school's theme", () => {
    for (const p of PALETTES) expect(checkContrast({ light: p.colors } as never), p.key).toEqual([]);
  });

  it("keys are unique, none is the school's own, and each has a name in the catalog", () => {
    const keys = PALETTES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(SCHOOL_PALETTE);
    for (const p of PALETTES) expect(t(p.name)).not.toBe(p.name);
  });

  it("the warm palette the PM liked is offered", () => {
    expect(PALETTES.some((p) => p.key === "terracotta")).toBe(true);
  });

  it("a palette's CSS sets only colour variables on :root", () => {
    const css = paletteCss("sage")!;
    expect(css.startsWith(":root{")).toBe(true);
    expect(css.match(/[^{}]+(?=\{)/g)).toEqual([":root"]);
    expect(css).toContain("--color-primary:#2f6b4f;");
    expect(css).not.toMatch(/font|radius/);
  });

  it("the school's own colours, or a key that no longer exists, lay nothing over the theme", () => {
    expect(paletteCss(SCHOOL_PALETTE)).toBeNull();
    expect(paletteCss("gone")).toBeNull();
  });

  it("refuses anything but plain hex colours, so a stored palette can never inject CSS", () => {
    expect(() => paletteToCss({ ...PALETTES[0]!.colors, primary: "red;}body{display:none" })).toThrow(InvalidThemeError);
  });

  it("is filled in before first paint only on portal pages: the public site keeps the school's colours", () => {
    expect(PALETTE_BOOT_SCRIPT).toContain('indexOf("/portal")===0');
  });
});

describe("Appearance in Settings", () => {
  const config: PublicConfig = {
    school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
    sections: TEST_SECTIONS.royal,
    modules: {},
    terms: {},
    theme: royal.theme as PublicConfig["theme"],
  };
  const html = renderToStaticMarkup(
    createElement(
      ConfigContext.Provider,
      { value: makeConfigValue("ready", config) },
      createElement(SessionContext.Provider, { value: fakeSession({ status: "signedIn", me: { name: "Asha", roles: [{ role: "student", scope: "own" }] } }) }, createElement(AppearanceCard)),
    ),
  );

  it("offers the school's colours and every palette as radio buttons in one named group", () => {
    expect(html.match(/type="radio"/g)).toHaveLength(PALETTES.length + 1);
    expect(html).toContain("<fieldset");
    expect(html).toContain(t("appearance.legend"));
    for (const name of ["appearance.palette.school", ...PALETTES.map((p) => p.name)] as const) expect(html).toContain(t(name));
  });

  it("starts on the school's own colours", () => {
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="school"|<input[^>]*value="school"[^>]*checked=""/);
  });
});
