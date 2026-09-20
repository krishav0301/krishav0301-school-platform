import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext, type Me, type SessionValue } from "@/session/SessionProvider";
import { PortalShell } from "@/shell/PortalShell";
import { PublicShell } from "@/shell/PublicShell";
import { Badge, Button, Field, Notice, Table } from "@/ui";
import DesignGallery from "@/app/design/page";
import PortalPage from "@/app/portal/page";
import SignInPage from "@/app/sign-in/page";
import royal from "../../../packs/royal-softech/pack.json";
import sample from "../../../packs/sample-basic-school/pack.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

type PackJson = typeof royal | typeof sample;

/** What `GET /api/config/public` would return for a pack (the server fills in defaults; so does this). */
function configFor(pack: PackJson): PublicConfig {
  const modules = Object.fromEntries(["accounts", "fees", "results", "attendance", "homework", "notes", "top20"].map((m) => [m, true]));
  return {
    school: { name: pack.school.name, shortName: pack.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
    sections: pack.sections,
    modules: { ...modules, ...pack.modules },
    terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Admin", ...pack.terminology },
    theme: pack.theme as PublicConfig["theme"],
  };
}

const signedIn = (me: Me): SessionValue => ({ status: "signedIn", me, signIn: async () => ({ ok: true }), signOut: async () => {} });
const signedOut: SessionValue = { status: "signedOut", me: null, signIn: async () => ({ ok: true }), signOut: async () => {} };

function page(element: React.ReactNode, pack: PackJson, session: SessionValue) {
  return renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", configFor(pack))}>
      <SessionContext.Provider value={session}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );
}

/** The structure of a page with its words removed: tags and attributes only. */
const skeleton = (html: string) => html.replace(/>[^<]+</g, "><").replace(/(?:aria-label|aria-labelledby|for|id|href)="[^"]*"/g, "");

const coordinator: Me = { name: "Sita Sharma", roles: [{ role: "coordinator", scope: "institution" }] };

describe("the portal shell", () => {
  const royalHtml = page(<PortalPage />, royal, signedIn(coordinator));
  const sampleHtml = page(<PortalPage />, sample, signedIn(coordinator));

  it("has the landmarks a screen reader needs, with the skip link first", () => {
    expect(royalHtml.indexOf('class="skip"')).toBeGreaterThan(-1);
    expect(royalHtml.indexOf('href="#main"')).toBeLessThan(royalHtml.indexOf("<header"));
    expect(royalHtml).toContain("<header");
    expect(royalHtml).toMatch(/<nav[^>]*aria-label="Main navigation"/);
    expect(royalHtml).toMatch(/<main id="main"/);
    expect(royalHtml).toContain("<footer");
    expect(royalHtml.match(/<h1/g)).toHaveLength(1);
  });

  it("marks the current page in the menu", () => {
    expect(royalHtml).toMatch(/<a[^>]*aria-current="page"[^>]*>Dashboard<\/a>/);
  });

  it("shows the school's own name and its own word for a role", () => {
    expect(royalHtml).toContain("Royal Softech");
    expect(royalHtml).toContain("Co-ordinator");
    expect(royalHtml).not.toContain("Vice Principal");

    expect(sampleHtml).toContain("Sample School");
    expect(sampleHtml).toContain("Vice Principal"); // the sample school's word for Co-ordinator
    expect(sampleHtml).not.toContain("Royal");
  });

  it("is laid out identically for every school: only words differ, never structure", () => {
    expect(skeleton(royalHtml)).toBe(skeleton(sampleHtml));
  });

  it("carries no colour of its own: nothing but theme variables can colour it", () => {
    for (const html of [royalHtml, sampleHtml]) {
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:\s*(?!var\()/);
    }
  });

  it("shows a section-scoped role with the section's name, and Super Admin as Support", () => {
    const html = page(
      <PortalPage />,
      royal,
      signedIn({ name: "Ram", roles: [{ role: "accountant", scope: "section", section: "bachelors" }, { role: "super_admin", scope: "institution" }] }),
    );
    expect(html).toContain("Bachelor&#x27;s only");
    expect(html).toContain("Support");
    expect(html).not.toContain("Super Admin");
  });

  it("someone not signed in sees only a loading state, never the portal", () => {
    const html = page(<PortalPage />, royal, signedOut);
    expect(html).not.toContain("Welcome, ");
    expect(html).not.toContain("Sign out");
    expect(html).toContain("Checking your session");
  });

  it("hides menu entries a role should not see", () => {
    const items = [
      { id: "dashboard", labelKey: "nav.dashboard", href: "/portal" },
      { id: "secret", labelKey: "shell.signOut", href: "/portal/x", roles: ["admin"] },
    ] as const;
    const html = page(<PortalShell items={items}>x</PortalShell>, royal, signedIn(coordinator));
    expect(html).toContain("Dashboard");
    expect(html).not.toContain("/portal/x");
  });
});

describe("the public shell and sign-in page", () => {
  it("offers Sign in to a visitor, and the dashboard to someone signed in", () => {
    expect(page(<PublicShell>x</PublicShell>, royal, signedOut)).toContain('href="/sign-in"');
    const html = page(<PublicShell>x</PublicShell>, royal, signedIn(coordinator));
    expect(html).toContain('href="/portal"');
    expect(html).not.toContain('href="/sign-in"');
  });

  const html = page(<SignInPage />, royal, signedOut);

  it("labels each field, so it can be found by name and by a password manager", () => {
    const email = html.match(/<input[^>]*name="email"[^>]*>/)![0];
    const password = html.match(/<input[^>]*name="password"[^>]*>/)![0];
    for (const [input, label] of [[email, "Email"], [password, "Password"]] as const) {
      const id = input.match(/\sid="([^"]+)"/)![1];
      expect(html).toMatch(new RegExp(`<label for="${id}"[^>]*>${label}</label>`));
    }
    expect(email.toLowerCase()).toContain('autocomplete="username"'); // React writes the attribute as autoComplete; HTML ignores case
    expect(email).toContain('type="email"');
    expect(password).toContain('type="password"');
    expect(password.toLowerCase()).toContain('autocomplete="current-password"');
  });

  it("has one heading and one submit button, and names the school", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain("to Royal Softech College");
  });
});

describe("components", () => {
  it("Button in its loading state is disabled and announced as busy, so it cannot be pressed twice", () => {
    const html = renderToStaticMarkup(<Button loading loadingLabel="Saving">Save</Button>);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Saving"');
  });

  it("a plain Button is type=button, so it never submits a form by accident", () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('type="button"');
  });

  it("Field wires label, hint and error to the input", () => {
    const html = renderToStaticMarkup(<Field label="Phone" hint="10 digits" error="Too short" name="p" />);
    const id = html.match(/<input[^>]*\sid="([^"]+)"/)![1];
    expect(html).toContain(`<label for="${id}"`);
    expect(html).toContain('aria-invalid="true"');
    const describedBy = html.match(/aria-describedby="([^"]+)"/)![1]!.split(" ");
    expect(describedBy).toHaveLength(2);
    for (const target of describedBy) expect(html).toContain(`id="${target}"`);
  });

  it("Field without an error is not marked invalid", () => {
    const html = renderToStaticMarkup(<Field label="Phone" name="p" />);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("an error Notice is announced at once; others politely", () => {
    expect(renderToStaticMarkup(<Notice tone="bad">x</Notice>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Notice tone="ok">x</Notice>)).toContain('role="status"');
    expect(renderToStaticMarkup(<Notice>x</Notice>)).toContain('role="status"');
  });

  it("Table is named for screen readers and can scroll by keyboard", () => {
    const html = renderToStaticMarkup(<Table caption="Payments"><tbody /></Table>);
    expect(html).toContain('aria-label="Payments"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("<caption");
  });

  it("Badge shows its meaning in words", () => {
    expect(renderToStaticMarkup(<Badge tone="bad">Overdue</Badge>)).toContain(">Overdue<");
  });

  it("the gallery draws every component and uses only theme variables for colour", () => {
    const html = renderToStaticMarkup(<DesignGallery />);
    for (const word of ["Colours", "Type", "Buttons", "Fields", "Badges and notices", "Table", "Loading"]) expect(html).toContain(word);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const [, colour] of html.matchAll(/style="[^"]*background:([^;"]+)/g)) expect(colour).toMatch(/^var\(--color-/);
  });
});

describe("the page title", () => {
  it("is neutral until the school's configuration arrives, and is the page's only title", async () => {
    const { ConfigProvider } = await import("@/config/ConfigProvider");
    const html = renderToStaticMarkup(<ConfigProvider>x</ConfigProvider>);
    expect(html).toContain("<title>School</title>");
    expect(html.match(/<title>/g)).toHaveLength(1);
  });
});
