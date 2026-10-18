import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ImmersiveHomeView, type ImmersiveSite } from "@/site/immersive/ImmersiveHome";
import { areaTags, programmeCards, splitAccent } from "@/site/immersive/model";
import { applyRedirect, frontStage } from "@/site/front-stage";
import royalJson from "../../../packs/royal-softech/pack.json";
import { siteFrom } from "./site-fixture";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/**
 * The immersive public page (PM, 2026-10-18, D-178): a one-page, scroll-driven site for a school whose pack chooses it. These
 * tests check what it says and the order it says it in, from the pack's own words; how it moves is in the stylesheet and is
 * checked by eye, with the rules about reduced motion, colours and fonts checked here and by the shared guards.
 */
const site = siteFrom(royalJson as never) as ImmersiveSite;
const words = site.immersive;
/** The same page with no pictures at all: what a school gets before it has any. */
const bare = { ...site, immersive: { ...words, photosFolder: undefined, hero: { headline: words.hero.headline, tagline: words.hero.tagline }, programmes: { ...words.programmes, images: undefined } } } as ImmersiveSite;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const slots = { notices: <p>NOTICES-SLOT</p>, admission: <p>ADMISSION-SLOT</p> };
const render = (over: Partial<{ signedIn: boolean; site: ImmersiveSite }> = {}) =>
  renderToStaticMarkup(<ImmersiveHomeView schoolName="Royal Softech College" site={over.site ?? site} signedIn={over.signedIn ?? false} slots={slots} />);

describe("a heading with an accent word", () => {
  it("splits the words around the one the pack marks with asterisks", () => {
    expect(splitAccent("Explore Our *Programmes*")).toEqual({ before: "Explore Our ", accent: "Programmes", after: "" });
    expect(splitAccent("A *middle* word")).toEqual({ before: "A ", accent: "middle", after: " word" });
  });

  it("leaves a heading with no mark whole, and never shows an asterisk", () => {
    expect(splitAccent("Plain heading")).toEqual({ before: "Plain heading", accent: null, after: "" });
    expect(splitAccent("Odd * star")).toEqual({ before: "Odd  star", accent: null, after: "" });
  });
});

describe("the tags around the programmes heading", () => {
  const tags = areaTags(site);

  it("are the streams the programmes offer, or a programme's own name when it has none", () => {
    expect(tags.map((t) => t.label)).toEqual(site.programmes.flatMap((p) => p.options).slice(0, 8));
    expect(tags.length).toBeLessThanOrEqual(8);
  });

  it("each lean a different way, in the same way every time, so a rendering and its reload agree", () => {
    expect(new Set(tags.map((t) => t.angle)).size).toBe(tags.length);
    expect(areaTags(site).map((t) => t.angle)).toEqual(tags.map((t) => t.angle));
    for (const t of tags) expect(Math.abs(t.angle)).toBeLessThanOrEqual(20);
  });
});

describe("the cards", () => {
  const cards = programmeCards(site);

  it("show a true word large beside the text, not a number: a programme's length, and the word Scholarships", () => {
    expect(cards.map((c) => c.visual)).toEqual(["2 years", "4 years", "Scholarships"]);
  });

  it("are one for each programme, then one for the scholarships, in that order", () => {
    expect(cards.map((c) => c.title)).toEqual([...site.programmes.map((p) => p.name), "Scholarships"]);
    expect(cards[0]).toMatchObject({ key: site.programmes[0]!.key, facts: [site.programmes[0]!.affiliation, site.programmes[0]!.duration] });
  });
});

describe("the page", () => {
  const html = render();

  it("has the school's headline as its one heading, with its accent word marked", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Quality education, <span[^>]*>bright<\/span> future\.<\/h1>/);
    expect(html).toContain(esc(words.hero.tagline));
    expect(html).not.toContain("*");
  });

  it("does not number content that is not a sequence: no 01, 02, 03 on the cards or the reasons", () => {
    expect(html).not.toMatch(/>0[1-9]</);
  });

  it("holds its sections in order, each with its own anchor", () => {
    const ids = ["top", "areas", "facilities", "programmes", "why", "notices", "admission", "contact"];
    const at = ids.map((id) => html.indexOf(`id="${id}"`));
    for (const [i, id] of ids.entries()) expect(at[i], id).toBeGreaterThan(-1);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("puts the notices and the admission form where the page's own blocks go", () => {
    expect(html.indexOf("NOTICES-SLOT")).toBeGreaterThan(html.indexOf('id="notices"'));
    expect(html.indexOf("ADMISSION-SLOT")).toBeGreaterThan(html.indexOf('id="admission"'));
  });

  it("says what the pack says: statement, headings, intros, programmes, facilities, reasons and contact", () => {
    for (const text of [words.areas.intro, words.programmes.intro, words.why.intro!, site.facilities.intro, site.contact.address, site.contact.phones[0]!]) expect(html, text).toContain(esc(text));
    for (const programme of site.programmes) for (const text of [programme.name, programme.affiliation, programme.duration, programme.summary]) expect(html, text).toContain(esc(text));
    for (const facility of site.facilities.items) expect(html, facility.name).toContain(esc(facility.name));
    for (const item of words.why.items) for (const text of [item.title, item.text]) expect(html, text).toContain(esc(text));
    for (const item of site.scholarships.items) expect(html, item.title).toContain(esc(item.title));
  });

  it("links each tag to the programmes, and each card's strip to the admission form", () => {
    const tagLinks = html.match(/<a[^>]*href="#programmes"[^>]*data-tag/g) ?? [];
    expect(tagLinks).toHaveLength(areaTags(site).length);
    const strips = html.match(/<a[^>]*href="#admission"[^>]*data-strip/g) ?? [];
    expect(strips).toHaveLength(programmeCards(site).length);
  });

  it("offers the facilities as a sideways row that can be reached from the keyboard and moved with two buttons", () => {
    expect(html).toMatch(/<div[^>]*role="region"[^>]*aria-label="Campus facilities"[^>]*tabindex="0"|<div[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Campus facilities"/);
    expect(count(html, /data-tile/g)).toBe(site.facilities.items.length);
    expect(html).toMatch(/<button[^>]*aria-label="Previous facilities"/);
    expect(html).toMatch(/<button[^>]*aria-label="Next facilities"/);
  });

  it("has a skip link first, one main landmark, and a footer with the school, the privacy notice and a way to sign in", () => {
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<header"));
    expect(count(html, /<main id="main"/g)).toBe(1);
    const footer = /<footer[\s\S]*?<\/footer>/.exec(html)![0];
    expect(footer).toContain("Royal Softech College");
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/sign-in"');
  });
});

describe("the top bar", () => {
  const bar = (html: string) => /<header[\s\S]*?<\/header>/.exec(html)![0];

  it("has the school's name as a link to the top, Apply, and Sign in, both quiet enough that the hero's button stays the prominent one", () => {
    const html = bar(render());
    expect(html).toMatch(/<a[^>]*href="#top"[^>]*>Royal Softech College<\/a>/);
    expect(html).toMatch(/<a[^>]*href="#admission"[^>]*>Apply<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/sign-in"[^>]*>Sign in<\/a>/);
    expect(html).not.toMatch(/class="button primary/);
  });

  it("offers Portal instead of Sign in to someone signed in", () => {
    const html = bar(render({ signedIn: true }));
    expect(html).toMatch(/<a[^>]*href="\/portal"[^>]*>Portal<\/a>/);
    expect(html).not.toContain("/sign-in");
  });

  it("has a Menu button that starts closed and points at the list of sections", () => {
    const html = bar(render());
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*>Menu<\/button>|<button[^>]*aria-controls="[^"]+"[^>]*aria-expanded="false"[^>]*>Menu<\/button>/);
    for (const label of ["Programmes", "Facilities", "Why us", "Notices", "Admission", "Contact"]) expect(html, label).toContain(`>${label}</a>`);
  });
});

describe("with and without pictures", () => {
  it("draws no picture at all when the pack names none: the look is a gradient made in CSS", () => {
    expect(render({ site: bare })).not.toContain("<img");
  });

  it("draws each named picture where it belongs, with its own alt text, from the school's folder", () => {
    const withPhotos = {
      ...bare,
      immersive: {
        ...bare.immersive,
        photosFolder: "royal",
        hero: { ...bare.immersive.hero, image: { file: "hero.webp", alt: "Students in the courtyard" } },
        programmes: { ...bare.immersive.programmes, images: { [site.programmes[0]!.key]: { file: "plus-two.webp", alt: "A +2 class" } } },
        facilities: { ...words.facilities, images: [{ name: site.facilities.items[0]!.name, file: "library.webp", alt: "The library" }] },
      },
    } as ImmersiveSite;
    const html = render({ site: withPhotos });
    for (const [file, alt] of [["hero.webp", "Students in the courtyard"], ["plus-two.webp", "A +2 class"], ["library.webp", "The library"]]) {
      const a = escapeRegExp(alt!);
      expect(html, file).toMatch(new RegExp(`<img[^>]*src="/site/royal/${file}"[^>]*alt="${a}"|<img[^>]*alt="${a}"[^>]*src="/site/royal/${file}"`));
      expect(html, file).toMatch(new RegExp(`<img[^>]*src="/site/royal/${file}"[^>]*alt="${a}"|<img[^>]*alt="${a}"[^>]*src="/site/royal/${file}"`));
    }
    expect(count(html, /<img/g)).toBe(3);
    // The hero picture is first on screen, so it loads at once; the others load as they near the screen.
    expect(html).toMatch(/<img[^>]*src="\/site\/royal\/hero\.webp"[^>]*loading="eager"|<img[^>]*loading="eager"[^>]*src="\/site\/royal\/hero\.webp"/);
    expect(count(html, /<img[^>]*loading="lazy"/g)).toBe(2);
  });
});

describe("which front page an immersive school gets", () => {
  const ready = { status: "ready", site: { layout: "immersive", immersive: {} } } as never;

  it("waits, with an empty page, until the school's words are here, then draws the immersive page", () => {
    expect(frontStage("loading", undefined, { status: "loading" })).toBe("waiting");
    expect(frontStage("ready", "immersive", { status: "loading" })).toBe("waiting");
    expect(frontStage("ready", "immersive", ready)).toBe("immersive");
  });

  it("offers a retry if its words fail to load, never the sign-in front", () => {
    expect(frontStage("ready", "immersive", { status: "failed" })).toBe("retry");
    expect(frontStage("ready", "immersive", { status: "notReady" })).toBe("retry");
  });

  it("sends the apply page's visitors to the form on the front page", () => {
    expect(applyRedirect({ status: "ready", site: { layout: "immersive", immersive: {} } as never })).toBe("/#admission");
    expect(applyRedirect({ status: "ready", site: { layout: "scroll", scroll: {} } as never })).toBe("/#admission");
    expect(applyRedirect({ status: "ready", site: { layout: "classic" } as never })).toBeNull();
    expect(applyRedirect({ status: "loading" })).toBeNull();
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "src", "site", "immersive", "immersive.module.css"), "utf8");

  it("turns off every movement for a visitor who asked for less: nothing is pinned, nothing slides, nothing animates", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(reduced).toMatch(/position:\s*static|position:\s*relative/);
    expect(reduced).toMatch(/animation:\s*none/);
    expect(reduced).toMatch(/scroll-behavior:\s*auto/);
  });

  it("starts the scroll-driven motion only where the browser can do it, and only when motion is allowed", () => {
    expect(css).toMatch(/@supports \(animation-timeline: view\(\)\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
  });

  it("makes each control at least 44 px tall", () => {
    for (const control of ["pill", "tag", "strip", "galleryButton", "menuButton"]) expect(css, control).toMatch(new RegExp(`\\.${control}\\s*\\{[^}]*min-(?:height|width):\\s*var\\(--control-height\\)`));
  });
});
