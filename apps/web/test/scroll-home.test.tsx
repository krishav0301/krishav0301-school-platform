import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ScrollHomeView, type ScrollSite } from "@/site/scroll/ScrollHome";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import { siteFrom } from "./site-fixture";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const site = siteFrom(lahanJson as never) as ScrollSite;
const slots = { batches: <p>BATCHES-SLOT</p>, notices: <p>NOTICES-SLOT</p>, admission: <p>ADMISSION-SLOT</p>, about: <p>ABOUT-SLOT</p> };
const render = (signedIn = false) => renderToStaticMarkup(<ScrollHomeView schoolName={lahanJson.school.name} site={site} signedIn={signedIn} slots={slots} />);
const html = render();

describe("the scroll page's shell", () => {
  it("has one h1, the school's name, with the address above it", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toContain(`>${esc(lahanJson.school.name)}</h1>`);
    expect(html.indexOf(esc(site.contact.address))).toBeLessThan(html.indexOf("<h1"));
  });

  it("has exactly one prominent button, Sign in, and an outlined Apply that goes to the admission form", () => {
    expect(count(html, /class="button primary/g)).toBe(1);
    expect(html).toMatch(/<a[^>]*href="\/sign-in"[^>]*class="button primary[^"]*"[^>]*>Sign in<\/a>|<a[^>]*class="button primary[^"]*"[^>]*href="\/sign-in"[^>]*>Sign in<\/a>/);
    expect(html).toMatch(/<a[^>]*class="button secondary[^"]*"[^>]*href="#admission"[^>]*>Apply<\/a>|<a[^>]*href="#admission"[^>]*class="button secondary[^"]*"[^>]*>Apply<\/a>/);
  });

  it("puts Sign in in the top bar for everyone, and Portal there for a signed-in person", () => {
    const bar = (page: string) => /<header[\s\S]*?<\/header>/.exec(page)![0];
    expect(bar(html)).toMatch(/href="\/sign-in"[^>]*>Sign in</);
    expect(bar(render(true))).toMatch(/href="\/portal"[^>]*>Portal</);
    expect(bar(render(true))).not.toContain("/sign-in");
  });

  it("has a menu with Notices, Admission and About, and every target exists on the page", () => {
    for (const id of ["notices", "admission", "about"]) {
      expect(html, id).toContain(`href="#${id}"`);
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="main"');
  });

  it("puts each block where the slot says, in the order of the design", () => {
    const order = ["BATCHES-SLOT", "NOTICES-SLOT", "ADMISSION-SLOT", "ABOUT-SLOT"].map((s) => html.indexOf(s));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("loads the first hero photo at once and the others lazily, each with its own words", () => {
    const images = site.scroll.hero.images;
    for (const image of images) expect(html).toContain(`src="/site/lahan/${image.file}"`);
    const first = new RegExp(`<img[^>]*src="/site/lahan/${images[0]!.file}"[^>]*>`).exec(html)![0];
    expect(first).toContain('loading="eager"');
    expect(first).toContain(`alt="${esc(images[0]!.alt)}"`);
    for (const image of images.slice(1)) expect(new RegExp(`<img[^>]*src="/site/lahan/${image.file}"[^>]*loading="lazy"`).test(html), image.file).toBe(true);
  });

  it("shows the school's intro in the band, and a photo strip you can scroll by keyboard", () => {
    expect(html).toContain(esc(site.scroll.intro));
    expect(html).toMatch(/<div[^>]*role="region"[^>]*tabindex="0"|<div[^>]*tabindex="0"[^>]*role="region"/);
  });

  it("shows no figures: nothing here is a count or a claim the school has not made", () => {
    expect(html).not.toMatch(/\d+\s*\+|\bYears of\b|\bAlumni\b/);
  });

  it("links to the privacy notice in the footer", () => {
    expect(html).toContain('href="/privacy"');
  });
});
