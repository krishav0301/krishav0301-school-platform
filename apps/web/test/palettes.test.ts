import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkContrast } from "../../api/src/core/theme"; // the server's own readability rules
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { t } from "@/i18n/messages";
import { SessionContext } from "@/session/SessionProvider";
import { AppearanceCard } from "@/settings/SettingsScreen";
import { InvalidThemeError, paletteToCss } from "@/theme/css";
import { PALETTES, SCHOOL_PALETTE } from "@/theme/palettes";
import { choosePalette, PALETTE_BOOT_SCRIPT, paletteCss, readPalette } from "@/theme/personal";
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
      createElement(SessionContext.Provider, { value: fakeSession({ status: "signedIn", me: { id: "user-1", name: "Asha", roles: [{ role: "student", scope: "own" }] } }) }, createElement(AppearanceCard)),
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

describe("A palette belongs to the account, not the browser", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal("document", { getElementById: () => ({ textContent: "" }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("what one account chooses is not what another account sees on the same computer", () => {
    choosePalette("user-a", "sage");
    expect(readPalette("user-a")).toBe("sage");
    expect(readPalette("user-b")).toBe(SCHOOL_PALETTE);
  });

  it("choosing the school's own colours clears only that account's choice", () => {
    choosePalette("user-a", "sage");
    choosePalette("user-b", "terracotta");
    choosePalette("user-a", SCHOOL_PALETTE);
    expect(readPalette("user-a")).toBe(SCHOOL_PALETTE);
    expect(readPalette("user-b")).toBe("terracotta");
  });
});
