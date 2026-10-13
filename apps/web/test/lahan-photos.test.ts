import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

  it("has its tab icon, a small square picture of the crest that the Worker serves as /favicon.ico (PM, 2026-10-13)", () => {
    const icon = join(folder, "favicon.png");
    expect(existsSync(icon)).toBe(true);
    expect(statSync(icon).size).toBeLessThan(30 * 1024);
    const bytes = readFileSync(icon);
    expect(bytes.subarray(1, 4).toString("ascii"), "a PNG picture").toBe("PNG");
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], "square").toEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(16)]);
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(64);
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

  it("has every photo the class cards name, each small enough for a card", () => {
    for (const card of lahanJson.site.scroll.cards) {
      const file = join(folder, card.image.file);
      expect(existsSync(file), card.title).toBe(true);
      expect(statSync(file).size, card.title).toBeLessThan(155 * 1024);
    }
  });

  it("has no picture in the folder that the pack does not use (nothing is shipped for nothing)", () => {
    const named = new Set(["crest.webp", "favicon.png", ...lahanJson.site.scroll.hero.images.map((i) => i.file), ...lahanJson.site.scroll.gallery.map((i) => i.file), ...lahanJson.site.scroll.cards.map((c) => c.image.file)]);
    expect(readdirSync(folder).filter((f) => !named.has(f))).toEqual([]);
  });
});
