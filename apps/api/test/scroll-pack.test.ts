import { describe, expect, it } from "vitest";

import { InvalidPackError, parsePack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import { classicOf } from "./programme-fixtures";

const scroll = {
  photosFolder: "demo",
  hero: { images: [{ file: "hero-1.webp", alt: "The school building" }] },
  intro: "A short intro.",
  cards: [{ title: "Kindergarten to Class 10", text: "A school for every stage.", image: { file: "card-1.webp", alt: "A card photo" } }, { title: "Learning With Technology", text: "Students use the lab." }],
  about: { story: "Our story.", facebook: "https://www.facebook.com/profile.php?id=100090093189751" },
};
const classic = classicOf(royalJson) as typeof royalJson;
const withSite = (patch: Record<string, unknown>) => ({ ...classic, site: { ...classic.site, ...patch } });

describe("the scroll layout in a pack", () => {
  it("a pack with no layout is a classic site, as before", () => {
    const pack = parsePack(classic);
    expect(pack.site.layout).toBe("classic");
    expect(pack.site.scroll).toBeUndefined();
    // The link is on unless a pack turns it off: take Royal's own off-switch away and the default shows.
    expect(parsePack({ ...classic, school: { ...classic.school, publicApplyNeedsLink: undefined } }).school.publicApplyNeedsLink).toBe(true);
  });

  it("accepts the scroll layout with its words", () => {
    const pack = parsePack(withSite({ layout: "scroll", scroll }));
    expect(pack.site.layout).toBe("scroll");
    expect(pack.site.scroll?.cards).toHaveLength(2);
  });

  it("refuses an unknown layout, and a scroll layout with no scroll words", () => {
    expect(() => parsePack(withSite({ layout: "carousel" }))).toThrow(InvalidPackError);
    expect(() => parsePack(withSite({ layout: "scroll" }))).toThrow(/site\.scroll/);
  });

  it("refuses a hero file that is a path, not a plain .webp name", () => {
    for (const file of ["../x.webp", "a/b.webp", "hero.png", "HERO.webp"]) {
      expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, hero: { images: [{ file, alt: "x" }] } } })), file).toThrow(InvalidPackError);
    }
  });

  it("refuses a link that is not on facebook.com, and duplicate card titles", () => {
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, about: { facebook: "https://evil.example/facebook.com" } } }))).toThrow(InvalidPackError);
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cards: [{ title: "A", text: "x" }, { title: "A", text: "y" }] } }))).toThrow(/cards/);
  });

  it("needs a plain folder name for the photos, and refuses a path or a missing one", () => {
    const { photosFolder: _unused, ...withoutFolder } = scroll;
    expect(() => parsePack(withSite({ layout: "scroll", scroll: withoutFolder }))).toThrow(InvalidPackError);
    for (const photosFolder of ["../x", "a/b", "Demo", "", "x".repeat(60)]) {
      expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, photosFolder } })), photosFolder).toThrow(InvalidPackError);
    }
  });

  it("needs words on every card, lets a card go without a photo, and keeps a card's photo to a plain file name", () => {
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cards: [{ title: "No words" }] } }))).toThrow(InvalidPackError);
    expect(parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cards: [{ title: "Plain", text: "No photo yet." }] } })).site.scroll?.cards[0]?.image).toBeUndefined();
    for (const file of ["../x.webp", "a/b.webp", "card.png"]) {
      expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cards: [{ title: "Bad", text: "Photo path.", image: { file, alt: "x" } }] } })), file).toThrow(InvalidPackError);
    }
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cards: [] } }))).toThrow(InvalidPackError);
  });

  it("takes an optional gallery of its own for the photo strip, up to twelve", () => {
    const gallery = [{ file: "g-1.webp", alt: "A first photo" }, { file: "g-2.webp", alt: "A second photo" }];
    expect(parsePack(withSite({ layout: "scroll", scroll: { ...scroll, gallery } })).site.scroll?.gallery).toHaveLength(2);
    expect(parsePack(withSite({ layout: "scroll", scroll })).site.scroll?.gallery).toBeUndefined();
    const thirteen = Array.from({ length: 13 }, (_, n) => ({ file: `g-${n}.webp`, alt: "A photo" }));
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, gallery: thirteen } }))).toThrow(InvalidPackError);
  });

  it("takes an optional quote for the school band, and refuses an empty or very long one", () => {
    expect(parsePack(withSite({ layout: "scroll", scroll: { ...scroll, quote: "Learning today, leading tomorrow." } })).site.scroll?.quote).toBe("Learning today, leading tomorrow.");
    expect(parsePack(withSite({ layout: "scroll", scroll })).site.scroll?.quote).toBeUndefined();
    for (const quote of ["", "   ", "x".repeat(201)]) expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, quote } })), quote.length + " characters").toThrow(InvalidPackError);
  });

  it("refuses the same picture file named twice, across the hero and the gallery", () => {
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, gallery: [{ file: "hero-1.webp", alt: "Again" }] } }))).toThrow(/more than once/);
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, gallery: [{ file: "g.webp", alt: "A" }, { file: "g.webp", alt: "B" }] } }))).toThrow(/more than once/);
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, hero: { images: [{ file: "h.webp", alt: "A" }, { file: "h.webp", alt: "B" }] } } }))).toThrow(/more than once/);
  });

  it("refuses a card's photo that is already used in the hero, the gallery or another card, so no picture shows twice (PM, 2026-10-13)", () => {
    const withCards = (cards: unknown[], gallery?: unknown[]) => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cards, ...(gallery ? { gallery } : {}) } }));
    const card = (title: string, file: string) => ({ title, text: "Some words about it.", image: { file, alt: "A photo" } });
    expect(() => withCards([card("One", "hero-1.webp")])).toThrow(/more than once/);
    expect(() => withCards([card("One", "g-1.webp")], [{ file: "g-1.webp", alt: "A photo" }])).toThrow(/more than once/);
    expect(() => withCards([card("One", "same.webp"), card("Two", "same.webp")])).toThrow(/more than once/);
    expect(withCards([card("One", "c-1.webp"), card("Two", "c-2.webp")], [{ file: "g-1.webp", alt: "A photo" }]).site.scroll?.cards).toHaveLength(2);
  });

  it("takes an optional paragraph for the top of the cards section, and refuses an empty or very long one", () => {
    expect(parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cardsIntro: "What the school stands for." } })).site.scroll?.cardsIntro).toBe("What the school stands for.");
    expect(parsePack(withSite({ layout: "scroll", scroll })).site.scroll?.cardsIntro).toBeUndefined();
    for (const cardsIntro of ["", "   ", "x".repeat(401)]) expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, cardsIntro } })), cardsIntro.length + " characters").toThrow(InvalidPackError);
  });

  it("has no map link: the about block takes only a story and the Facebook page (PM, 2026-10-13)", () => {
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, about: { ...scroll.about, mapQuery: "Lahan, Siraha" } } }))).toThrow(InvalidPackError);
  });

  it("refuses scroll words on a classic site", () => {
    expect(() => parsePack(withSite({ scroll }))).toThrow(/site\.scroll/);
  });
});
