/* eslint-disable @typescript-eslint/no-explicit-any -- the test deliberately edits loosely-typed pack data */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ProgrammesPage from "@/app/programmes/page";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SessionContext } from "@/session/SessionProvider";
import { AdmissionView } from "@/site/AdmissionView";
import { ContactView } from "@/site/ContactView";
import { FacilitiesView } from "@/site/FacilitiesView";
import { PrivacyView } from "@/site/PrivacyView";
import { ProgrammesView } from "@/site/ProgrammesView";
import { ScholarshipsView } from "@/site/ScholarshipsView";
import { SiteFrameView } from "@/site/SiteFrame";
import { fakeSession } from "./session";
import { siteFrom } from "./site-fixture";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/programmes", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** What React writes for text: it escapes an apostrophe as &#x27;. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe.each([
  { label: "Royal Softech", json: royalJson },
  { label: "Sample Basic School", json: sampleJson },
])("$label's pages", ({ json }) => {
  const pack = { sections: json.sections };
  const site = siteFrom(json);

  it("Programmes: every programme is a card with its anchor, grouped under its section", () => {
    const html = renderToStaticMarkup(<ProgrammesView site={site} sections={pack.sections} />);
    for (const p of site.programmes) {
      expect(html, p.key).toContain(`id="${p.key}"`);
      expect(html).toContain(esc(p.name));
      expect(html).toContain(esc(p.affiliation));
    }
    for (const s of pack.sections) expect(html).toContain(`>${esc(s.name)}</h2>`);
    // "Options" appears only for a programme that has some.
    expect(count(html, />Options</g)).toBe(site.programmes.filter((p) => p.options.length > 0).length);
  });

  it("Admission: the steps are an ordered list numbered in words, with one prominent way on", () => {
    const html = renderToStaticMarkup(<AdmissionView site={site} />);
    expect(count(html, /<li/g)).toBe(site.admission.steps.length);
    site.admission.steps.forEach((step, index) => {
      expect(html).toContain(`Step ${index + 1}`);
      expect(html).toContain(esc(step.title));
    });
    expect(html).toContain("<ol");
    expect(count(html, /class="button primary/g)).toBe(1);
    expect(html).toMatch(/<a[^>]*href="\/contact"[^>]*>Contact the college<\/a>/);
  });

  it("Scholarships: an item for each, with its words", () => {
    const html = renderToStaticMarkup(<ScholarshipsView site={site} />);
    for (const item of site.scholarships.items) expect(html).toContain(esc(item.title));
    expect(count(html, /class="button primary/g)).toBe(0);
  });

  it("Facilities: every facility by name, and its note when it has one", () => {
    const html = renderToStaticMarkup(<FacilitiesView site={site} />);
    for (const item of site.facilities.items) {
      expect(html).toContain(esc(item.name));
      if (item.body) expect(html).toContain(esc(item.body));
    }
  });

  it("Contact: the address, every phone as a call link, and an email link only when there is one", () => {
    const html = renderToStaticMarkup(<ContactView site={site} />);
    expect(html).toContain(esc(site.contact.address));
    for (const phone of site.contact.phones) expect(html).toContain(`href="tel:${phone.startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}"`);
    expect(count(html, /href="mailto:/g)).toBe(site.contact.email ? 1 : 0);
  });

  it("Privacy: names the school and gives a way to reach it, the same as Contact", () => {
    const html = renderToStaticMarkup(<PrivacyView schoolName={json.school.name} site={site} />);
    expect(count(html, new RegExp(esc(json.school.name), "g"))).toBeGreaterThanOrEqual(3); // the intro and more than one section name it
    for (const phone of site.contact.phones) expect(html).toContain(`href="tel:${phone.startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}"`);
    expect(count(html, /href="mailto:/g)).toBe(site.contact.email ? 1 : 0);
    // Every section has a heading and a body: nothing is left blank.
    expect(count(html, /<h2/g)).toBeGreaterThanOrEqual(7);
  });

  it("carries no colour of its own: nothing but theme variables can colour it", () => {
    const html = [
      renderToStaticMarkup(<ProgrammesView site={site} sections={pack.sections} />),
      renderToStaticMarkup(<AdmissionView site={site} />),
      renderToStaticMarkup(<ContactView site={site} />),
      renderToStaticMarkup(<PrivacyView schoolName={json.school.name} site={site} />),
    ].join("");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});

describe("text from the pack is shown as text, never run", () => {
  const script = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
  const bad = structuredClone(royalJson) as any;
  bad.site.programmes[0].name = script;
  bad.site.admission.steps[0].body = script;
  bad.site.scholarships.items[0].title = script;
  bad.site.facilities.items[0].name = script;
  bad.site.contact.address = script;
  const pack = { site: siteFrom(bad), sections: bad.sections };

  it("on every page", () => {
    const html = [
      renderToStaticMarkup(<ProgrammesView site={pack.site} sections={pack.sections} />),
      renderToStaticMarkup(<AdmissionView site={pack.site} />),
      renderToStaticMarkup(<ScholarshipsView site={pack.site} />),
      renderToStaticMarkup(<FacilitiesView site={pack.site} />),
      renderToStaticMarkup(<ContactView site={pack.site} />),
    ].join("");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the frame around a page's words", () => {
  const site = siteFrom(royalJson);
  const frame = (view: Parameters<typeof SiteFrameView>[0]["view"]) =>
    renderToStaticMarkup(
      <SiteFrameView title="Programmes" view={view} onRetry={() => {}}>
        {() => <p>the words</p>}
      </SiteFrameView>,
    );

  it("always has the page's one heading", () => {
    for (const view of [{ status: "loading" }, { status: "failed" }, { status: "notReady" }, { status: "ready", site }] as const) {
      expect(count(frame(view), /<h1/g)).toBe(1);
    }
  });

  it("shows the shape of the page while it loads, as a labelled status, and no words yet", () => {
    const html = frame({ status: "loading" });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading…");
    expect(html).not.toContain("the words");
  });

  it("says plainly that the page cannot load, with a way to try again", () => {
    const html = frame({ status: "failed" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load this page.");
    expect(html).toContain("Try again");
  });

  it("says calmly that the page is not ready yet, and is not an alarm", () => {
    const html = frame({ status: "notReady" });
    expect(html).toContain("This page isn&#x27;t ready yet");
    expect(html).not.toContain('role="alert"');
  });

  it("shows the words once they are ready", () => {
    const html = frame({ status: "ready", site });
    expect(html).toContain("the words");
    expect(html).not.toContain('role="status"');
  });
});

describe("a page as the visitor first sees it", () => {
  const config: PublicConfig = {
    school: { name: "Royal Softech College", shortName: "Royal Softech", currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
    sections: royalJson.sections,
    modules: {},
    terms: { "role.student": "Student", "role.teacher": "Teacher", "role.coordinator": "Co-ordinator", "role.accountant": "Accountant", "role.admin": "Admin", "term.terminal": "Terminal", "term.programme": "Programme", "term.level": "Level", "term.section": "Section" },
    theme: royalJson.theme as PublicConfig["theme"],
  };

  it("starts on its heading and a loading placeholder, with no sign-in needed and nothing alarming", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <SessionContext.Provider value={fakeSession()}>
          <ProgrammesPage />
        </SessionContext.Provider>
      </ConfigContext.Provider>,
    );
    expect(html).toMatch(/<h1[^>]*>Programmes<\/h1>/);
    expect(html).toContain("Loading…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="alert"');
  });
});
