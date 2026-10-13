import { existsSync, statSync } from "node:fs";
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

  // Skipped until the school's photos are added (the PM must approve the download list first, D-167).
  it.skip("has every photo the pack names, each small enough", () => {
    for (const image of lahanJson.site.scroll.hero.images) {
      const file = join(folder, image.file);
      expect(existsSync(file), image.file).toBe(true);
      expect(statSync(file).size, image.file).toBeLessThan(150 * 1024);
    }
  });
});
