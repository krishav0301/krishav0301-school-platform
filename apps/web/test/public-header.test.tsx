import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext, type Me } from "@/session/SessionProvider";
import { PublicShell } from "@/shell/PublicShell";
import { fakeSession } from "./session";
import royalJson from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/notices", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: "Royal Softech College", shortName: "Royal Softech", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Admin", "term.terminal": "Terminal", "term.programme": "Programme", "term.level": "Level", "term.section": "Section" },
  theme: royalJson.theme as PublicConfig["theme"],
};
const me: Me = { id: "user-1", name: "Sita Sharma", roles: [{ role: "coordinator", scope: "institution" }] };

function shell(options: { signedIn?: boolean; showSignIn?: boolean; layout?: "classic" | "scroll"; unknownSchool?: boolean } = {}) {
  const used: PublicConfig = options.layout ? { ...config, school: { ...config.school, publicLayout: options.layout } } : config;
  return renderToStaticMarkup(
    <ConfigContext.Provider value={options.unknownSchool ? makeConfigValue("loading", null) : makeConfigValue("ready", used)}>
      <SessionContext.Provider value={options.signedIn ? fakeSession({ status: "signedIn", me }) : fakeSession()}>
        <PublicShell showSignIn={options.showSignIn}>
          <h1>x</h1>
        </PublicShell>
      </SessionContext.Provider>
    </ConfigContext.Provider>,
  );
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const header = (html: string) => /<header[\s\S]*?<\/header>/.exec(html)![0];
const footer = (html: string) => /<footer[\s\S]*?<\/footer>/.exec(html)![0];
const OLD_PAGES = ["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"];

describe("the public header (PM, 2026-10-18, D-177: no menu of pages)", () => {
  const html = header(shell());

  it("is the school's name, as a link to the front page, and Sign in, quietly", () => {
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Royal Softech<\/a>/);
    expect(count(html, /class="button primary/g)).toBe(0);
    expect(html).toMatch(/<a[^>]*class="button quiet"[^>]*href="\/sign-in"|<a[^>]*href="\/sign-in"[^>]*class="button quiet"/);
  });

  it("has no Menu button and no list of pages", () => {
    expect(html).not.toContain(">Menu<");
    expect(html).not.toContain("<nav");
    for (const href of OLD_PAGES) expect(html, href).not.toContain(`href="${href}"`);
  });

  it("offers the dashboard instead of Sign in to someone signed in, and no Sign in where the form is already on the page", () => {
    expect(header(shell({ signedIn: true }))).toContain('href="/portal"');
    expect(header(shell({ showSignIn: false }))).not.toContain('href="/sign-in"');
  });
});

describe("the footer", () => {
  it("names the school and links to the privacy notice, and nothing else", () => {
    const html = footer(shell());
    expect([...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/privacy"]);
    expect(html).toContain("Royal Softech College");
    expect(html).toContain(">Privacy</a>");
    expect(html).not.toContain("<nav");
  });

  it("does not offer Sign in (the header does)", () => {
    expect(footer(shell())).not.toContain("/sign-in");
  });
});

describe("the whole shell", () => {
  it("keeps the skip link first, one main landmark and no navigation", () => {
    const html = shell();
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<header"));
    expect(count(html, /<main id="main"/g)).toBe(1);
    expect(count(html, /<nav/g)).toBe(0);
  });

  it("is the same for a school with the one-page layout, and before the school is known", () => {
    for (const html of [shell({ layout: "scroll" }), shell({ unknownSchool: true })]) {
      for (const href of OLD_PAGES) expect(html, href).not.toContain(`href="${href}"`);
      expect(html).not.toContain(">Menu<");
    }
    expect(header(shell({ layout: "scroll" }))).toContain('href="/sign-in"');
  });

  it("carries no colour of its own", () => {
    const html = shell();
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:\s*(?!var\()/);
  });
});
