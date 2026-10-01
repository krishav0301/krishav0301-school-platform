/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately poke at loosely-typed and malformed data */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { InvalidPackError, applyPack, loadConfig, loadSiteContent, packOperations, parsePack, renderSql, type Pack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const clone = <T>(x: T): T => structuredClone(x);
const count = async (db: D1Database, sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;

// ---------------------------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------------------------
describe("pack format", () => {
  it("accepts both real packs", () => {
    expect(parsePack(royalJson).school.name).toBe("Royal Softech College");
    expect(parsePack(sampleJson).school.name).toBe("Sample Basic School");
  });

  it("fills in defaults", () => {
    const minimal = clone(royalJson) as Record<string, any>;
    delete minimal.school.currency;
    delete minimal.school.timezone;
    delete minimal.modules;
    delete minimal.terminology;
    const pack = parsePack(minimal);
    expect(pack.school).toMatchObject({ currency: "NPR", timezone: "Asia/Kathmandu" });
    expect(pack.modules).toEqual({});
    expect(pack.terminology).toEqual({});
  });

  const cases: [string, (p: any) => void, RegExp][] = [
    ["an unknown top-level field", (p) => (p.customCode = "x"), /customCode|unrecognized/i],
    ["a wrong pack version", (p) => (p.packVersion = 2), /packVersion/],
    ["no sections", (p) => (p.sections = []), /sections/],
    ["a bad section key", (p) => (p.sections[0].key = "Plus 2!"), /sections\.0\.key/],
    ["two sections with the same key", (p) => (p.sections[1].key = p.sections[0].key), /unique/],
    ["a module that does not exist", (p) => (p.modules.hovercraft = true), /hovercraft: not a module/],
    ["switching off a mandatory module", (p) => (p.modules.fees = false), /fees: cannot be switched off/],
    ["switching off the audit log", (p) => (p.modules.audit = false), /audit: cannot be switched off/],
    ["renaming something that cannot be renamed", (p) => (p.terminology["role.super_admin"] = "Boss"), /not a term/],
    ["an empty school name", (p) => (p.school.name = ""), /school\.name/],
    ["an unreadable theme", (p) => (p.theme.light.text = "#e0e0e0"), /theme\.light: Body text on the page has contrast/],
    ["a font from outside", (p) => (p.theme.font = "https://x.example/f.woff2"), /theme\.font/],
  ];
  it.each(cases)("refuses %s", (_label, mutate, message) => {
    const bad = clone(royalJson) as any;
    mutate(bad);
    expect(() => parsePack(bad)).toThrow(InvalidPackError);
    expect(() => parsePack(bad)).toThrow(message);
  });

  it("lists every problem at once, so a mistake is not found one run at a time", () => {
    const bad = clone(royalJson) as any;
    bad.modules.fees = false;
    bad.modules.hovercraft = true;
    bad.theme.light.text = "#e0e0e0";
    try {
      parsePack(bad);
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidPackError).problems.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Applying a pack, and the SQL form of the same operations
// ---------------------------------------------------------------------------------------------
describe("operations", () => {
  it("never delete anything", () => {
    for (const op of packOperations(parsePack(royalJson))) expect(op.sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });

  it("keep values apart from the SQL text", () => {
    const pack = parsePack({ ...clone(royalJson), school: { ...royalJson.school, name: "Robert'); DROP TABLE users;--" } });
    for (const op of packOperations(pack)) expect(op.sql).not.toContain("Robert");
  });

  it("render to SQL with quotes doubled and spacing inside values left alone", () => {
    const sql = renderSql([{ sql: "INSERT INTO t (a, b, c) VALUES (?, ?, ?)", params: ["it's  a  test", 7, null] }]);
    expect(sql).toBe("INSERT INTO t (a, b, c) VALUES ('it''s  a  test', 7, NULL);");
  });

  it.each([
    ["a line break", "two\nlines"],
    ["a carriage return", "a\rb"],
    ["a NUL character", "a\x00b"],
  ])("refuse to render %s", (_label, value) => {
    expect(() => renderSql([{ sql: "SELECT ?", params: [value] }])).toThrow();
  });

  it("refuse a mismatch between placeholders and values", () => {
    expect(() => renderSql([{ sql: "SELECT ?, ?", params: [1] }])).toThrow(/placeholders/);
    expect(() => renderSql([{ sql: "SELECT ?", params: [1, 2] }])).toThrow(/values/);
  });

  it("a hostile school name is stored as plain text and harms nothing, whichever way it is applied", async () => {
    const hostile = "Robert'); DROP TABLE users;--";
    const pack = parsePack({ ...clone(sampleJson), school: { ...sampleJson.school, name: hostile } });

    // Bound parameters, through D1.
    await applyPack(env.SCRATCH_DB, pack);
    expect((await loadConfig(env.SCRATCH_DB))!.school.name).toBe(hostile);
    expect(await count(env.SCRATCH_DB, "SELECT COUNT(*) AS n FROM users")).toBeGreaterThanOrEqual(0); // table still exists

    // Rendered SQL text, through exec (what the provisioning script does).
    const hostile2 = "Second'); DROP TABLE users;--";
    await env.SCRATCH_DB.exec(renderSql(packOperations(parsePack({ ...clone(sampleJson), school: { ...sampleJson.school, name: hostile2 } }))));
    expect((await loadConfig(env.SCRATCH_DB))!.school.name).toBe(hostile2);
    expect(await count(env.SCRATCH_DB, "SELECT COUNT(*) AS n FROM users")).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------------------------
// One build, many schools: every check runs against BOTH packs (D-009).
// ---------------------------------------------------------------------------------------------
describe.each([
  { label: "Royal Softech", json: royalJson, db: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, db: () => env.SCRATCH_DB },
])("$label", ({ json, db: getDb }) => {
  const pack: Pack = parsePack(json);

  it("is unprovisioned until a pack is applied", async () => {
    // (The hostile-name test above wrote to SCRATCH_DB; reset the school row for a clean start.)
    if (getDb() === env.SCRATCH_DB) await env.SCRATCH_DB.exec("DELETE FROM school");
    expect(await loadConfig(getDb())).toBeNull();
  });

  it("applies, and the configuration reads back exactly as written", async () => {
    await applyPack(getDb(), pack);
    const config = (await loadConfig(getDb()))!;

    expect(config.school).toMatchObject({ name: pack.school.name, shortName: pack.school.shortName, currency: "NPR", region: "nepal", template: pack.school.template });
    expect(config.sections.map((s) => s.key)).toEqual(expect.arrayContaining(pack.sections.map((s) => s.key)));
    expect(config.theme).toEqual(pack.theme);
  });

  it("applying it a second and third time changes nothing", async () => {
    const snapshot = async () =>
      JSON.stringify([
        await loadConfig(getDb()),
        await count(getDb(), "SELECT COUNT(*) AS n FROM themes"),
        await count(getDb(), "SELECT COUNT(*) AS n FROM sections"),
        await count(getDb(), "SELECT COUNT(*) AS n FROM module_switches"),
        await count(getDb(), "SELECT COUNT(*) AS n FROM terminology"),
        await getDb().prepare("SELECT content_json, updated_at FROM site_content").first(),
      ]);
    const before = await snapshot();
    await applyPack(getDb(), pack);
    await applyPack(getDb(), pack);
    expect(await snapshot()).toBe(before);
    expect(await count(getDb(), "SELECT COUNT(*) AS n FROM themes WHERE is_active = 1")).toBe(1);
  });

  it("mandatory modules are always on; optional ones follow the pack", async () => {
    const { modules } = (await loadConfig(getDb()))!;
    for (const key of ["fees", "results", "audit", "approvals", "accounts"]) expect(modules[key], key).toBe(true);
    for (const [key, on] of Object.entries(pack.modules)) expect(modules[key], key).toBe(on);
    for (const key of ["attendance", "teacher_attendance", "homework", "notes", "top20"]) {
      expect(modules[key], key).toBe(pack.modules[key] ?? true);
    }
  });

  it("wording is the pack's override, else the built-in default", async () => {
    const { terms } = (await loadConfig(getDb()))!;
    expect(terms["role.coordinator"]).toBe(pack.terminology["role.coordinator"] ?? "Co-ordinator");
    expect(terms["role.student"]).toBe(pack.terminology["role.student"] ?? "Student");
    expect(terms["term.terminal"]).toBe(pack.terminology["term.terminal"] ?? "Terminal");
    expect(terms["role.accountant"]).toBe("Accountant"); // not renamed by either pack
  });
});

describe("the two schools really are different (so the second-school test means something)", () => {
  const royal = parsePack(royalJson);
  const sample = parsePack(sampleJson);

  it("differ in name, sections, wording, modules, font, shape and colours", () => {
    expect(royal.school.name).not.toBe(sample.school.name);
    expect(royal.sections.map((s) => s.key)).not.toEqual(sample.sections.map((s) => s.key));
    expect(royal.terminology).not.toEqual(sample.terminology);
    expect(royal.modules).not.toEqual(sample.modules);
    expect(royal.theme.font).not.toBe(sample.theme.font);
    expect(royal.theme.shape).not.toEqual(sample.theme.shape);
    expect(royal.theme.light.primary).not.toBe(sample.theme.light.primary);
    // Both are always light now: the PM chose one light look for the portal (D-088).
    expect((royal.theme as { dark?: unknown }).dark).toBeUndefined();
    expect((sample.theme as { dark?: unknown }).dark).toBeUndefined();
    expect(royal.theme.headingFont).toBe("source-serif"); // and Royal's headings are serif, the sample school's are not
    expect((sample.theme as { headingFont?: string }).headingFont).toBeUndefined();
  });
});

describe("applying a different pack over an existing school", () => {
  it("swaps the active theme, keeps the old one, and never deletes a section", async () => {
    // env.DB holds Royal Softech from the tests above. Now apply the sample school over it.
    const themesBefore = await count(env.DB, "SELECT COUNT(*) AS n FROM themes");
    await applyPack(env.DB, parsePack(sampleJson));

    const config = (await loadConfig(env.DB))!;
    expect(config.theme!.name).toBe(sampleJson.theme.name);
    expect(await count(env.DB, "SELECT COUNT(*) AS n FROM themes")).toBe(themesBefore + 1); // old kept
    expect(await count(env.DB, "SELECT COUNT(*) AS n FROM themes WHERE is_active = 1")).toBe(1);
    expect(config.sections.map((s) => s.key).sort()).toEqual(["bachelors", "plus2", "school"]); // nothing deleted

    // And back again: the earlier theme is found and re-activated, not duplicated.
    await applyPack(env.DB, parsePack(royalJson));
    expect((await loadConfig(env.DB))!.theme!.name).toBe(royalJson.theme.name);
    expect(await count(env.DB, "SELECT COUNT(*) AS n FROM themes")).toBe(themesBefore + 1);
    expect(await count(env.DB, "SELECT COUNT(*) AS n FROM themes WHERE is_active = 1")).toBe(1);
  });

  it("the database allows only one active theme, whatever the code does", async () => {
    await expect(
      env.DB.prepare("INSERT INTO themes (name, tokens_json, is_active) VALUES ('second active', '{}', 1)").run(),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// The site block: the words of the six fixed public pages (Phase 2, slice 3)
// ---------------------------------------------------------------------------------------------
describe("the site block", () => {
  const cases: [string, (p: any) => void, RegExp][] = [
    ["no site block", (p) => delete p.site, /site: /],
    ["an unknown field in the site block", (p) => (p.site.blog = {}), /blog|unrecognized/i],
    ["a programme in a section the pack does not have", (p) => (p.site.programmes[0].section = "nursery"), /site\.programmes\.0\.section: .*nursery/],
    ["two programmes with the same key", (p) => (p.site.programmes[1].key = p.site.programmes[0].key), /site\.programmes: keys must be unique/],
    ["a programme key that is not a slug", (p) => (p.site.programmes[0].key = "BBS Degree!"), /site\.programmes\.0\.key/],
    ["no admission steps", (p) => (p.site.admission.steps = []), /site\.admission\.steps/],
    ["no phone number", (p) => (p.site.contact.phones = []), /site\.contact\.phones/],
    ["an over-long headline", (p) => (p.site.home.headline = "x".repeat(121)), /site\.home\.headline/],
    ["a blank summary", (p) => (p.site.home.summary = "   "), /site\.home\.summary/],
    ["a bad email address", (p) => (p.site.contact.email = "not an email"), /site\.contact\.email/],
  ];
  it.each(cases)("refuses %s", (_label, mutate, message) => {
    const bad = clone(royalJson) as any;
    mutate(bad);
    expect(() => parsePack(bad)).toThrow(InvalidPackError);
    expect(() => parsePack(bad)).toThrow(message);
  });

  it("carries small placeholder content for Royal (the college's real words are added at the end, D-054) and the sample school's own, sharing no wording", () => {
    const royal = parsePack(royalJson).site;
    const sample = parsePack(sampleJson).site;
    expect(royal.programmes.length).toBeGreaterThan(0);
    expect(sample.programmes.length).toBeGreaterThan(0);
    const words = JSON.stringify(sample);
    for (const royalWord of ["Royal", "Lahan", "Siraha", "NEB", "Purbanchal", "Tribhuvan"]) expect(words, royalWord).not.toContain(royalWord);
  });

  it("fills in an empty options list", () => {
    // A programme written without `options` reads back with an empty list, whatever the pack's content is.
    const bare = clone(royalJson) as any;
    delete bare.site.programmes[0].options;
    expect(parsePack(bare).site.programmes[0]!.options).toEqual([]);
  });

  it("is stored by applying the pack and reads back exactly as written, for both schools", async () => {
    for (const [json, db] of [[royalJson, env.DB], [sampleJson, env.SCRATCH_DB]] as const) {
      const pack = parsePack(json);
      await applyPack(db, pack);
      expect(await loadSiteContent(db), pack.school.name).toEqual(pack.site);
    }
  });

  it("re-applying the same pack leaves the row, and its timestamp, untouched; changed text updates both", async () => {
    const pack = parsePack(royalJson);
    await applyPack(env.DB, pack);
    await env.DB.prepare("UPDATE site_content SET updated_at = '2000-01-01T00:00:00Z'").run();

    await applyPack(env.DB, pack);
    const same = await env.DB.prepare("SELECT content_json, updated_at FROM site_content").first<{ content_json: string; updated_at: string }>();
    expect(same!.updated_at).toBe("2000-01-01T00:00:00Z");
    expect(JSON.parse(same!.content_json)).toEqual(pack.site);

    const edited = parsePack({ ...clone(royalJson), site: { ...clone(royalJson).site, home: { headline: "A new headline", summary: "A new summary." } } });
    await applyPack(env.DB, edited);
    const changed = await env.DB.prepare("SELECT updated_at FROM site_content").first<{ updated_at: string }>();
    expect(changed!.updated_at).not.toBe("2000-01-01T00:00:00Z");
    expect((await loadSiteContent(env.DB))!.home.headline).toBe("A new headline");
    expect(await count(env.DB, "SELECT COUNT(*) AS n FROM site_content")).toBe(1);
    await applyPack(env.DB, pack);
  });

  it("stores text with line breaks and quotes safely, through bound parameters and through rendered SQL", async () => {
    const base = clone(sampleJson) as any;
    base.site.home = { headline: "Line one\nLine two", summary: "It's a \"test\"; DROP TABLE users;--" };
    const pack = parsePack(base);
    await applyPack(env.SCRATCH_DB, pack);
    expect((await loadSiteContent(env.SCRATCH_DB))!.home).toEqual(pack.site.home);

    base.site.home.headline = "Second\nheadline";
    const sql = renderSql(packOperations(parsePack(base)));
    expect(sql).not.toContain("Second\nheadline"); // the line break is a JSON escape, so it is still one SQL line per statement
    await env.SCRATCH_DB.exec(sql);
    expect((await loadSiteContent(env.SCRATCH_DB))!.home.headline).toBe("Second\nheadline");
    expect(await count(env.SCRATCH_DB, "SELECT COUNT(*) AS n FROM users")).toBeGreaterThanOrEqual(0);
  });
});
