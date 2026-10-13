import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Batches } from "@/site/scroll/Batches";
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

  it("puts the school's crest large at the top centre of the page, before its name, and small in the bar once you scroll (PM, 2026-10-13)", () => {
    const hero = /<section id="top"[\s\S]*?<\/section>/.exec(html)![0];
    expect(hero).toMatch(/<img[^>]*class="heroCrest"[^>]*src="\/site\/lahan\/crest\.webp"|<img[^>]*src="\/site\/lahan\/crest\.webp"[^>]*class="heroCrest"/);
    expect(hero.indexOf('class="heroCrest"')).toBeLessThan(hero.indexOf("<h1"));
    expect(/<header[\s\S]*?<\/header>/.exec(html)![0]).toContain("/site/lahan/crest.webp");
    expect(count(html, /class="heroCrest"/g)).toBe(1);
  });

  it("shows the school's motto under its name", () => {
    expect(html).toContain("Darkness to Light");
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

  it("shows the school's gallery in the strip when it has one, and the hero photos otherwise", () => {
    const withGallery = { ...site, scroll: { ...site.scroll, gallery: [{ file: "g-one.webp", alt: "A gallery photo" }, { file: "g-two.webp", alt: "Another gallery photo" }] } };
    const page = renderToStaticMarkup(<ScrollHomeView schoolName="X" site={withGallery} signedIn={false} slots={slots} />);
    const strip = /<div[^>]*role="region"[\s\S]*?<\/div>/.exec(page)![0];
    expect(strip).toContain("g-one.webp");
    expect(strip).toContain("g-two.webp");
    for (const image of site.scroll.hero.images) expect(strip, image.file).not.toContain(image.file);
    const withoutGallery = { ...site, scroll: { ...site.scroll, gallery: undefined } };
    const plainStrip = /<div[^>]*role="region"[\s\S]*?<\/div>/.exec(renderToStaticMarkup(<ScrollHomeView schoolName="X" site={withoutGallery} signedIn={false} slots={slots} />))![0];
    for (const image of site.scroll.hero.images) expect(plainStrip, image.file).toContain(image.file);
  });

  it("sizes each strip photo itself, so a large picture file cannot make its card as wide as the file", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "src", "site", "scroll", "scroll.module.css"), "utf8");
    const photo = /\.stripPhoto\s*\{[^}]*\}/.exec(css)![0];
    expect(photo).toMatch(/width:\s*min\(78vw,\s*22rem\)/);
    expect(photo).toMatch(/min-width:\s*0/);
    expect(photo).toMatch(/flex:\s*0 0 auto/);
  });

  it("offers a way to pause the photos when there is more than one, and not when there is only one", () => {
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Pause photos<\/button>/);
    const single = renderToStaticMarkup(<ScrollHomeView schoolName="X" site={{ ...site, scroll: { ...site.scroll, hero: { images: [site.scroll.hero.images[0]!] } } }} signedIn={false} slots={slots} />);
    expect(single).not.toContain("Pause photos");
  });

  it("puts the school band in the theme's yellow with the page's dark text, and keeps blue for what you can act on", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "src", "site", "scroll", "scroll.module.css"), "utf8");
    const band = css.match(/\.band\s*\{[^}]*\}/)![0];
    expect(band).toContain("background: var(--color-accent-soft)");
    expect(band).toContain("color: var(--color-text)");
    expect(css.match(/\.sectionTitle\s*\{[^}]*\}/)![0]).toContain("color: var(--color-primary)");
  });

  it("shades the photo enough that white text stays readable over a light one", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "src", "site", "scroll", "scroll.module.css"), "utf8");
    const stops = [...css.match(/\.heroShade\s*\{[^}]*\}/)![0].matchAll(/var\(--color-text\) (\d+)%/g)].map((m) => Number(m[1]));
    expect(stops.length).toBeGreaterThanOrEqual(3);
    for (const stop of stops) expect(stop, "every part of the shade is at least 58%").toBeGreaterThanOrEqual(58);
  });

  it("shows the school's quote large in the band, with the welcome line smaller beneath it", () => {
    const band = /<section[^>]*aria-labelledby="school-heading"[\s\S]*?<\/section>/.exec(html)![0];
    const lines = site.scroll.quote!.split("\n");
    expect(lines).toEqual(["From Darkness to Light", "Raising the Leaders of Tomorrow"]);
    for (const line of lines) expect(band, line).toMatch(new RegExp(`<span[^>]*class="bandQuoteLine"[^>]*>${line}</span>`));
    expect(band.indexOf(lines[1]!)).toBeLessThan(band.indexOf(esc(site.scroll.intro)));
    expect(band).toMatch(/<p[^>]*class="bandQuote"/);
    const plain = renderToStaticMarkup(<ScrollHomeView schoolName="X" site={{ ...site, scroll: { ...site.scroll, quote: undefined } }} signedIn={false} slots={slots} />);
    expect(plain).not.toContain("bandQuote");
    expect(plain).toContain(esc(site.scroll.intro));
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

describe("the classes block", () => {
  const batches = site.scroll.batches;
  const block = renderToStaticMarkup(<Batches batches={batches} />);

  it("lists one card per class group, in order, with its note", () => {
    for (const b of batches) expect(block).toContain(esc(b.title));
    expect(block).toContain("To confirm with the school");
    expect(block.indexOf(esc(batches[0]!.title))).toBeLessThan(block.indexOf(esc(batches.at(-1)!.title)));
    expect(count(block, /<li[^>]*class="batchCard/g)).toBe(batches.length);
  });

  it("has an h2 that names the list, and the cards are an ordered list", () => {
    expect(block).toMatch(/<h2[^>]*id="batches-title"/);
    expect(block).toMatch(/<section[^>]*aria-labelledby="batches-title"/);
    expect(block).toMatch(/<ol[^>]*class="batchList/);
  });

  it("shows nothing at all when the school lists no classes", () => {
    expect(renderToStaticMarkup(<Batches batches={[]} />)).toBe("");
  });
});
