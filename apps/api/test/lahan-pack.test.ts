import { describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import { contrastRatio } from "../src/core/theme/contrast";
import royalJson from "../../../packs/royal-softech/pack.json";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

/**
 * The first real school (the PM, 2026-10-11): Lahan Manakamana Secondary English Boarding School runs only the result system.
 * Its file turns off what it does not use and the Admin's second step, and carries nothing of another school.
 */
describe("the Lahan Manakamana school file", () => {
  const pack = parsePack(lahanJson);

  it("is the school, with the Principal's word and no section made for it (the Principal makes them)", () => {
    expect(pack.school.name).toBe("Lahan Manakamana Secondary English Boarding School");
    expect(pack.sections).toEqual([]);
    expect(pack.terminology).toEqual({ "role.admin": "Principal" });
  });

  it("turns off fees, attendance, teacher attendance, homework, notes, the daily log, Top 20 and electives, and leaves results to the core", () => {
    for (const key of ["fees", "attendance", "teacher_attendance", "homework", "notes", "top20", "activity_log", "electives"]) expect(pack.modules[key], key).toBe(false);
    expect(Object.keys(pack.modules).sort()).toEqual(["activity_log", "attendance", "electives", "fees", "homework", "notes", "teacher_attendance", "top20"]);
  });

  it("lets the Principal sign in with an ID and a password only", () => {
    expect(pack.school.adminTwoFactor).toBe(false);
  });

  it("lets a student keep the 4-digit password given at admission and sign in with their email and it (D-145)", () => {
    expect(pack.school.studentKeepsPin).toBe(true);
    expect(parsePack(royalJson).school.studentKeepsPin).toBe(false); // every other school is as it was
  });

  it("gives each subject its own pass marks, and no other school does", () => {
    expect(pack.school.passMarksPerSubject).toBe(true);
    expect(parsePack(royalJson).school.passMarksPerSubject).toBe(false);
  });

  it("says nothing of Royal Softech anywhere (D-008: one school's name or data never appears in another's)", () => {
    expect(JSON.stringify(lahanJson)).not.toMatch(/royal|softech/i);
  });

  it("is a scroll site that takes applications without an email link, and the sample school still needs one (D-167, D-168)", () => {
    expect(pack.site.layout).toBe("scroll");
    expect(pack.school.publicApplyNeedsLink).toBe(false);
    expect(parsePack(sampleJson).school.publicApplyNeedsLink).toBe(true);
    expect(parsePack(royalJson).school.publicApplyNeedsLink).toBe(false); // Royal turned it off too (D-183)
    expect(parsePack(royalJson).site.layout).not.toBe("scroll");
  });

  it("says what the school stands for at the top of Our School, in the PM's chosen words (2026-10-13), and does not repeat the first card", () => {
    const intro = pack.site.scroll!.cardsIntro!;
    expect(intro).toBe("Every child is a light waiting to shine. Lahan Manakamana nurtures curiosity, kindness and discipline, so that each student grows in knowledge and character and steps into the world ready to lead and to care for others.");
    expect(intro).not.toMatch(/every stage|Kindergarten to Class 10/i);
  });

  it("shows six cards under Our School, each with words and a photo, with no \"to confirm\" notes (PM, 2026-10-13)", () => {
    const cards = pack.site.scroll!.cards;
    expect(cards.map((c) => c.title)).toEqual(["Kindergarten to Class 10", "Learning With Technology", "Sports and Teamwork", "Art and Creativity", "Celebrating Together", "Awards and Achievements"]);
    for (const card of cards) {
      expect(card.text.length, card.title).toBeGreaterThan(20);
      expect(card.image?.file, card.title).toMatch(/.webp$/);
      expect(JSON.stringify(card), card.title).not.toMatch(/to confirm/i);
    }
  });

  it("wears the school's own colours, as seen on its page: yellow, with blue for what you can act on (PM, 2026-10-13)", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    const light = pack.theme.light;
    const [pr, pg, pb] = rgb(light.primary);
    expect(pb, "the brand colour (buttons, links, headings) is blue").toBeGreaterThan(Math.max(pr, pg) + 40);
    const [yr, yg, yb] = rgb(light.accentSoft);
    expect(Math.min(yr, yg) - yb, "the school band's colour is yellow").toBeGreaterThan(80);
    const [br, bg, bb] = rgb(light.background);
    expect(Math.min(br, bg) - bb, "the page itself leans yellow").toBeGreaterThan(8);
    // The yellow band carries the page's dark text (the theme's own rules do not check this pair).
    expect(contrastRatio(light.text, light.accentSoft)).toBeGreaterThanOrEqual(4.5);
  });

  it("opens its school band with a line about the leaders of tomorrow, in the PM's words (2026-10-13)", () => {
    expect(pack.site.scroll!.quote).toBe("From Darkness to Light\nRaising the Leaders of Tomorrow");
    expect(pack.site.scroll!.intro).toContain("Welcome to Lahan Manakamana Secondary English Boarding School");
  });

  it("has no map link (PM, 2026-10-13): the address is shown as words only", () => {
    expect(JSON.stringify(pack)).not.toMatch(/mapQuery|google\.com\/maps/);
  });

  it("says its motto and the year it was founded, both as printed on its own crest, and names itself as the crest does", () => {
    expect(pack.site.scroll!.hero.tagline).toBe("Darkness to Light");
    expect(pack.site.scroll!.about.story).toContain("2058");
    expect(pack.site.scroll!.intro).toContain("Lahan Manakamana Secondary English Boarding School");
  });


});
