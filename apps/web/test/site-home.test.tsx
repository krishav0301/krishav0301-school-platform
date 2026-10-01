import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HomeFrameView, HomeView } from "@/site/HomeView";
import { siteFrom } from "./site-fixture";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { TEST_SECTIONS, sectionsOf } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe.each([
  { label: "Royal Softech", json: royalJson },
  { label: "Sample Basic School", json: sampleJson },
])("$label's home page", ({ json }) => {
  const pack = { sections: sectionsOf(json) };
  const site = siteFrom(json);
  const html = renderToStaticMarkup(<HomeView site={site} sections={pack.sections} urgent={[]} />);

  it("leads with the school's headline as its one heading, and its summary", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toContain(`>${esc(site.home.headline)}</h1>`);
    expect(html).toContain(esc(site.home.summary));
  });

  it("has exactly one prominent button, How to apply, and a quiet way to the notices", () => {
    expect(count(html, /class="button primary/g)).toBe(1);
    expect(html).toMatch(/<a[^>]*class="button primary[^"]*"[^>]*href="\/admission"[^>]*>How to apply<\/a>|<a[^>]*href="\/admission"[^>]*class="button primary[^"]*"[^>]*>How to apply<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/notices"[^>]*>Notices and updates<\/a>/);
  });

  it("lets every button label wrap, so a long label cannot widen the page at 320px with enlarged text (D-030)", () => {
    const buttons = html.match(/<a[^>]*class="button[^"]*"/g) ?? [];
    expect(buttons.length).toBeGreaterThan(3);
    for (const button of buttons) expect(button).toContain("wrapLabel");
  });

  it("does not offer Sign in here: that belongs to the header and footer", () => {
    expect(html).not.toContain("/sign-in");
  });

  it("lists every programme under its section, each linking to its card on the Programmes page", () => {
    for (const p of site.programmes) expect(html).toContain(`href="/programmes#${p.key}"`);
    for (const s of pack.sections) expect(html).toContain(`>${esc(s.name)}</h3>`);
  });

  it("shows the admission steps in brief, and the address and first phone", () => {
    for (const step of site.admission.steps) expect(html).toContain(`<li>${esc(step.title)}</li>`);
    expect(html).toContain(esc(site.contact.address));
    const phone = site.contact.phones[0]!;
    expect(html).toContain(`href="tel:${phone.startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}"`);
  });

  it("links on to the full pages", () => {
    for (const href of ["/programmes", "/admission", "/contact"]) expect(html, href).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*class="button quiet|<a[^>]*class="button quiet[^"]*"[^>]*href="${href}"`));
  });

  it("carries no colour of its own", () => {
    // A link's address (`/programmes#bed-it`) is not a colour, even when its letters happen to be hex digits.
    expect(html.replace(/href="[^"]*"/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});

describe("the urgent strip", () => {
  const pack = { site: siteFrom(royalJson), sections: TEST_SECTIONS.royal };

  it("is left out when nothing is urgent", () => {
    const html = renderToStaticMarkup(<HomeView site={pack.site} sections={pack.sections} urgent={[]} />);
    expect(html).not.toContain("Urgent");
  });

  it("names each urgent notice as a link to the notice board, politely announced", () => {
    const html = renderToStaticMarkup(<HomeView site={pack.site} sections={pack.sections} urgent={[{ id: "a", title: "School closed tomorrow" }, { id: "b", title: "Exam <b>moved</b>" }]} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Urgent");
    expect(html).toMatch(/<a[^>]*href="\/notices"[^>]*>School closed tomorrow<\/a>/);
    expect(html).not.toContain("<b>moved");
    expect(count(html, /class="button primary/g)).toBe(1);
  });
});

describe("the home page before its words are ready", () => {
  const pack = { site: siteFrom(royalJson), sections: TEST_SECTIONS.royal };
  const frame = (view: Parameters<typeof HomeFrameView>[0]["view"]) =>
    renderToStaticMarkup(<HomeFrameView schoolName="Royal Softech College" sections={pack.sections} view={view} urgent={[]} onRetry={() => {}} />);

  it("keeps the school's name as the heading while loading, failed or not set up, and shows the shape of the page", () => {
    for (const view of [{ status: "loading" }, { status: "failed" }, { status: "notReady" }] as const) {
      const html = frame(view);
      expect(count(html, /<h1/g), view.status).toBe(1);
      expect(html).toContain(">Royal Softech College</h1>");
    }
    expect(frame({ status: "loading" })).toContain('aria-busy="true"');
  });

  it("has no prominent button until there is something to apply to", () => {
    for (const view of [{ status: "loading" }, { status: "failed" }, { status: "notReady" }] as const) expect(count(frame(view), /class="button primary/g)).toBe(0);
  });

  it("shows the words once ready", () => {
    expect(frame({ status: "ready", site: pack.site })).toContain(esc(pack.site.home.headline));
  });
});
