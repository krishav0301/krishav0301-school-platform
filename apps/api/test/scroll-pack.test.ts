import { describe, expect, it } from "vitest";

import { InvalidPackError, parsePack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";

const scroll = {
  hero: { images: [{ file: "hero-1.webp", alt: "The school building" }] },
  intro: "A short intro.",
  batches: [{ title: "Kindergarten" }, { title: "Class 1 to 5", note: "to confirm" }],
  about: { story: "Our story.", facebook: "https://www.facebook.com/profile.php?id=100090093189751" },
};
const withSite = (patch: Record<string, unknown>) => ({ ...royalJson, site: { ...royalJson.site, ...patch } });

describe("the scroll layout in a pack", () => {
  it("a pack with no layout is a classic site, as before", () => {
    const pack = parsePack(royalJson);
    expect(pack.site.layout).toBe("classic");
    expect(pack.site.scroll).toBeUndefined();
    expect(pack.school.publicApplyNeedsLink).toBe(true);
  });

  it("accepts the scroll layout with its words", () => {
    const pack = parsePack(withSite({ layout: "scroll", scroll }));
    expect(pack.site.layout).toBe("scroll");
    expect(pack.site.scroll?.batches).toHaveLength(2);
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

  it("refuses a link that is not on facebook.com, and duplicate batch titles", () => {
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, about: { facebook: "https://evil.example/facebook.com" } } }))).toThrow(InvalidPackError);
    expect(() => parsePack(withSite({ layout: "scroll", scroll: { ...scroll, batches: [{ title: "A" }, { title: "A" }] } }))).toThrow(/batches/);
  });

  it("refuses scroll words on a classic site", () => {
    expect(() => parsePack(withSite({ scroll }))).toThrow(/site\.scroll/);
  });
});
