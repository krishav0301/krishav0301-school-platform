import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import lahanJson from "../../../packs/lahan-manakamana/pack.json";

/** The files the Lahan pack names are really in the web app's public folder (the API's test environment cannot read files). */
const folder = join(import.meta.dirname, "..", "public", "site", lahanJson.site.scroll.photosFolder);

describe("Lahan's picture files", () => {
  it("has the school's crest, small enough for a public page", () => {
    const crest = join(folder, "crest.webp");
    expect(existsSync(crest)).toBe(true);
    expect(statSync(crest).size).toBeLessThan(80 * 1024);
  });

  it("has every hero photo the pack names, each small enough for a full-screen picture", () => {
    for (const image of lahanJson.site.scroll.hero.images) {
      const file = join(folder, image.file);
      expect(existsSync(file), image.file).toBe(true);
      expect(statSync(file).size, image.file).toBeLessThan(155 * 1024);
    }
  });

  it("has every gallery photo the pack names, each small enough for the strip", () => {
    for (const image of lahanJson.site.scroll.gallery) {
      const file = join(folder, image.file);
      expect(existsSync(file), image.file).toBe(true);
      expect(statSync(file).size, image.file).toBeLessThan(100 * 1024);
    }
  });

  it("has no picture in the folder that the pack does not use (nothing is shipped for nothing)", () => {
    const named = new Set(["crest.webp", ...lahanJson.site.scroll.hero.images.map((i) => i.file), ...lahanJson.site.scroll.gallery.map((i) => i.file)]);
    expect(readdirSync(folder).filter((f) => !named.has(f))).toEqual([]);
  });
});
