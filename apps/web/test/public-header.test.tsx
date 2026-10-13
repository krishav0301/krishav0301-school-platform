import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext, type Me } from "@/session/SessionProvider";
import { PublicHeaderView } from "@/shell/PublicHeader";
import { PublicShell } from "@/shell/PublicShell";
import { fakeSession } from "./session";
import royalJson from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

const here = vi.hoisted(() => ({ path: "/programmes" }));
vi.mock("next/navigation", () => ({ usePathname: () => here.path, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: "Royal Softech College", shortName: "Royal Softech", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: {},
  terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Admin", "term.terminal": "Terminal", "term.programme": "Programme", "term.level": "Level", "term.section": "Section" },
  theme: royalJson.theme as PublicConfig["theme"],
};
const me: Me = { id: "user-1", name: "Sita Sharma", roles: [{ role: "coordinator", scope: "institution" }] };

function shell(path: string, options: { signedIn?: boolean; showSignIn?: boolean; layout?: "classic" | "scroll"; unknownSchool?: boolean } = {}) {
  here.path = path;
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
const LABELS = ["Programmes", "Admission", "Scholarships", "Facilities", "Contact", "Notices and updates"];
const HREFS = ["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"];

describe("the public header", () => {
  const html = header(shell("/programmes"));

  it("links to every public page, in reading order, in a labelled navigation", () => {
    expect(html).toMatch(/<nav[^>]*aria-label="Site pages"/);
    const links = [...html.matchAll(/<a[^>]*class="siteLink"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(links).toEqual(LABELS);
    const hrefs = [...html.matchAll(/<a[^>]*class="siteLink"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="siteLink"/g)].map((m) => m[1] ?? m[2]);
    expect(hrefs).toEqual(HREFS);
  });

  it("marks the current page, and only that one", () => {
    expect(count(html, /aria-current="page"/g)).toBe(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Programmes<\/a>/);
    expect(count(header(shell("/")), /aria-current="page"/g)).toBe(0);
    expect(header(shell("/notices/"))).toMatch(/<a[^>]*aria-current="page"[^>]*>Notices and updates<\/a>/);
  });

  it("puts the school's name, then Menu, then Sign in, then the page links, so what is read is what is tabbed to", () => {
    const at = (text: string) => html.indexOf(text);
    expect(at("Royal Softech")).toBeGreaterThan(-1);
    expect(at("Royal Softech")).toBeLessThan(at(">Menu<"));
    expect(at(">Menu<")).toBeLessThan(at(">Sign in<"));
    expect(at(">Sign in<")).toBeLessThan(at('aria-label="Site pages"'));
  });

  it("has no prominent button: Menu and Sign in are quiet", () => {
    expect(count(html, /class="button primary/g)).toBe(0);
    expect(html).toMatch(/<a[^>]*class="button quiet"[^>]*href="\/sign-in"|<a[^>]*href="\/sign-in"[^>]*class="button quiet"/);
  });

  it("offers the dashboard instead of Sign in to someone signed in, and no Sign in where the form is already on the page", () => {
    expect(header(shell("/programmes", { signedIn: true }))).toContain('href="/portal"');
    expect(header(shell("/sign-in", { showSignIn: false }))).not.toContain('href="/sign-in"');
  });
});

describe("the Menu button and its list", () => {
  const props = { brand: "Royal Softech", signedIn: false, showSignIn: true, pathname: "/programmes", panelId: "site-pages", buttonRef: { current: null }, onToggle: () => {}, onNavigate: () => {} };

  it("starts closed: the button says so and points at the list, which is marked closed", () => {
    const html = renderToStaticMarkup(<PublicHeaderView {...props} open={false} />);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="site-pages"|<button[^>]*aria-controls="site-pages"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/<nav[^>]*id="site-pages"[^>]*data-open="false"|<nav[^>]*data-open="false"[^>]*id="site-pages"/);
  });

  it("when open, says so on both", () => {
    const html = renderToStaticMarkup(<PublicHeaderView {...props} open />);
    expect(html).toMatch(/<button[^>]*aria-expanded="true"/);
    expect(html).toMatch(/<nav[^>]*data-open="true"/);
  });

  it("is a real button, not a link, with the word Menu", () => {
    const html = renderToStaticMarkup(<PublicHeaderView {...props} open={false} />);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Menu<\/button>/);
  });
});

describe("the footer", () => {
  it("repeats the page links in its own labelled navigation, so they are reachable without the Menu, and names the school", () => {
    const html = footer(shell("/programmes"));
    expect(html).toMatch(/<nav[^>]*aria-label="Footer"/);
    // Privacy is a legal page, not one of the Worker's crawler-filled pages, so it is added separately from SITE_LINKS/HREFS.
    expect([...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual([...HREFS, "/privacy"]);
    for (const label of LABELS) expect(html).toContain(`>${label}</a>`);
    expect(html).toContain(">Privacy</a>");
    expect(html).toContain("Royal Softech College");
  });

  it("does not offer Sign in (the header does)", () => {
    expect(footer(shell("/programmes"))).not.toContain("/sign-in");
  });
});

describe("the whole shell", () => {
  it("keeps the skip link first, one main landmark and two labelled navigations", () => {
    const html = shell("/programmes");
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<header"));
    expect(count(html, /<main id="main"/g)).toBe(1);
    expect(count(html, /<nav/g)).toBe(2);
  });

  it("carries no colour of its own", () => {
    const html = shell("/programmes");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:\s*(?!var\()/);
  });
});

describe("for a school with the one-page layout (PM, 2026-10-13)", () => {
  const html = shell("/notices", { layout: "scroll" });

  it("has no menu of pages at all: not in the header, not in the footer, and no Menu button", () => {
    for (const label of LABELS) expect(html, label).not.toContain(`>${label}</a>`);
    for (const href of HREFS) expect(html, href).not.toContain(`href="${href}"`);
    expect(html).not.toContain(">Menu<");
    expect(html).not.toMatch(/aria-label="Site pages"/);
    expect(html).not.toMatch(/aria-label="Footer"/);
  });

  it("is only the school's name (a link to the front page), Sign in, the page, and a footer with the privacy notice", () => {
    expect(header(html)).toMatch(/<a[^>]*href="\/"[^>]*>Royal Softech<\/a>/);
    expect(header(html)).toContain('href="/sign-in"');
    expect([...footer(html).matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/privacy"]);
    expect(footer(html)).toContain("Royal Softech College");
  });

  it("is the same on the privacy page", () => {
    const privacy = shell("/privacy", { layout: "scroll" });
    for (const href of HREFS) expect(privacy, href).not.toContain(`href="${href}"`);
  });
});

describe("before the school is known", () => {
  it("shows no menu of pages either, so a school with the one-page layout never flashes the old one", () => {
    const html = shell("/notices", { unknownSchool: true });
    for (const href of HREFS) expect(html, href).not.toContain(`href="${href}"`);
    expect(html).not.toContain(">Menu<");
  });
});
