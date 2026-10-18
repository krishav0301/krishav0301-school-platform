import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { InvalidPackError, applyPack, loadConfig, parsePack } from "../src/core/config";
import { nepalDate } from "../src/core/dates";
import { createUser } from "../src/modules/accounts/service";
import { createContent, publishContent } from "../src/modules/content/service";
import { FILLED_PAGES, renderCrawlerFile, renderPublicPage } from "../src/modules/site";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";
import { testPack } from "./programme-fixtures";

/**
 * The immersive public layout (PM, 2026-10-18, D-178): a one-page site in the manner of a scrolling university page, chosen by
 * the pack like the scroll layout. These tests cover the pack's rules and the Worker's plain copy of the page; the page itself
 * is checked in the web tests.
 */

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const SHELL = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/></head><body><div id="root">Loading</div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) } as unknown as Fetcher;
const page = async (path: string) => (await renderPublicPage(new Request(`https://royal.example${path}`), { ...env, ASSETS: assets, SITE_ORIGIN: "https://royal.example" })).text();
const file = async (path: string) => (await renderCrawlerFile(new Request(`https://royal.example${path}`), { ...env, ENVIRONMENT: "production", SITE_ORIGIN: "https://royal.example" } as never)).text();
const copyOf = (html: string) => /<div id="server-copy">([\s\S]*?)<\/div><script>/.exec(html)?.[1] ?? "";
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const plain = (heading: string) => heading.replaceAll("*", "");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests deliberately edit loosely-typed pack data
const edited = (change: (pack: any) => void) => {
  const pack = structuredClone(royalJson) as never;
  change(pack);
  return pack;
};
const refuses = (pack: unknown, message: RegExp) => {
  expect(() => parsePack(pack)).toThrow(InvalidPackError);
  try {
    parsePack(pack);
  } catch (error) {
    expect((error as Error).message).toMatch(message);
  }
};

const site = royalJson.site;
const words = site.immersive;

describe("Royal Softech's pack", () => {
  it("chooses the immersive layout and carries its words", () => {
    const pack = parsePack(royalJson);
    expect(pack.site.layout).toBe("immersive");
    expect(pack.site.immersive?.hero.headline).toBe(words.hero.headline);
    expect(pack.site.immersive?.why.items.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the sample school on the plain sign-in front, with no immersive words", () => {
    const pack = parsePack(sampleJson);
    expect(pack.site.layout).toBe("classic");
    expect(pack.site.immersive).toBeUndefined();
  });
});

describe("the immersive words are checked", () => {
  it("are required for the immersive layout, and only allowed with it", () => {
    refuses(edited((p) => delete p.site.immersive), /site\.immersive: required when site\.layout is immersive/);
    refuses(edited((p) => (p.site.layout = "classic")), /site\.immersive: only an immersive layout may have immersive words/);
  });

  it("allow one accent word in a heading, written between two asterisks, and no other asterisk", () => {
    expect(() => parsePack(edited((p) => (p.site.immersive.areas.heading = "Plain heading")))).not.toThrow();
    refuses(edited((p) => (p.site.immersive.areas.heading = "Two *accent* *words*")), /accent word/);
    refuses(edited((p) => (p.site.immersive.areas.heading = "Open *accent")), /accent word/);
    refuses(edited((p) => (p.site.immersive.hero.headline = "Star * alone")), /accent word/);
  });

  it("need between two and six reasons, each with a title and a line", () => {
    refuses(edited((p) => (p.site.immersive.why.items = [p.site.immersive.why.items[0]])), /immersive\.why\.items/);
    refuses(edited((p) => (p.site.immersive.why.items = Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, text: "x" })))), /immersive\.why\.items/);
    refuses(edited((p) => (p.site.immersive.why.items[0].title = "")), /immersive\.why\.items/);
  });

  it("refuse an unknown key, so a typo cannot silently go unused", () => {
    refuses(edited((p) => (p.site.immersive.hero.heading = "typo")), /immersive\.hero/);
  });

  it("refuse a picture with no photos folder, or a file named twice, or a name that is not in the pack", () => {
    const photo = { file: "campus.webp", alt: "The campus" };
    refuses(
      edited((p) => {
        delete p.site.immersive.photosFolder;
        p.site.immersive.programmes.images = { [p.site.programmes[0].key]: photo };
      }),
      /photosFolder/,
    );
    refuses(
      edited((p) => {
        p.site.immersive.photosFolder = "royal";
        p.site.immersive.facilities.images = [{ name: p.site.facilities.items[0].name, ...photo }];
        p.site.immersive.programmes.images = { [p.site.programmes[0].key]: photo };
      }),
      /named more than once/,
    );
    refuses(
      edited((p) => {
        p.site.immersive.photosFolder = "royal";
        p.site.immersive.programmes.images = { "no-such-programme": photo };
      }),
      /programme/,
    );
    refuses(
      edited((p) => {
        p.site.immersive.photosFolder = "royal";
        p.site.immersive.facilities.images = [{ name: "No such facility", ...photo }];
      }),
      /facilit/,
    );
  });

  it("accept a picture for the scholarships card, under the key `scholarships`", () => {
    const pack = edited((p) => {
      p.site.immersive.photosFolder = "royal";
      p.site.immersive.programmes.images = { scholarships: { file: "students.webp", alt: "Students" } };
    });
    expect(parsePack(pack).site.immersive?.programmes.images).toHaveProperty("scholarships");
  });

  it("accept real pictures when the folder and the names are right", () => {
    const pack = edited((p) => {
      p.site.immersive.photosFolder = "royal";
      p.site.immersive.programmes.images = { [p.site.programmes[0].key]: { file: "plus-two.webp", alt: "Students in class" } };
      p.site.immersive.facilities.images = [{ name: p.site.facilities.items[0].name, file: "library.webp", alt: "The library" }];
    });
    expect(parsePack(pack).site.immersive?.facilities.images).toHaveLength(1);
  });
});

describe("the public configuration", () => {
  beforeAll(async () => {
    await applyPack(db, testPack(royalJson));
  });

  it("says the school's public layout is immersive", async () => {
    expect((await loadConfig(db))!.school.publicLayout).toBe("immersive");
  });
});

describe("the front page, for crawlers", () => {
  let admin = "";
  beforeAll(async () => {
    admin = (await createUser(db, key, { email: `imm-${crypto.randomUUID().slice(0, 6)}@school.example`, password: "blue-river-lamp-2083", fullName: "Immersive Admin", roles: [{ role: "admin", scope: "institution" }] })).publicId;
    await applyPack(db, testPack(royalJson));
    const created = await createContent(db, key, admin, { kind: "notice", title: "Entrance test on Friday", body: "B", contact: null, urgent: false, publishOn: nepalDate(new Date()), hideAfter: null } as never);
    if (!created.ok) throw new Error(created.reason);
    await publishContent(db, key, admin, created.publicId);
  });

  it("is stamped immersive before any script runs, so the app knows which page to draw", async () => {
    expect(/<html[^>]*data-public-layout="([a-z]+)"/.exec(await page("/"))?.[1]).toBe("immersive");
  });

  it("says the school's name, its headline and tagline without the accent marks, and the way to sign in and apply", async () => {
    const copy = copyOf(await page("/"));
    expect(copy).toContain(`<h1>${esc(plain(words.hero.headline))}</h1>`);
    expect(copy).toContain(esc(words.hero.tagline));
    expect(copy).not.toContain("*");
    expect(copy).toContain('<a href="/sign-in">Sign in</a>');
  });

  it("lists every programme with its affiliation, duration and streams, the facilities, the reasons, the notices and the contact", async () => {
    const copy = copyOf(await page("/"));
    for (const programme of site.programmes) {
      expect(copy).toContain(esc(programme.name));
      expect(copy).toContain(esc(programme.affiliation));
      expect(copy).toContain(esc(programme.duration));
      for (const option of programme.options ?? []) expect(copy).toContain(esc(option));
    }
    for (const facility of site.facilities.items) expect(copy).toContain(esc(facility.name));
    for (const item of words.why.items) {
      expect(copy).toContain(esc(item.title));
      expect(copy).toContain(esc(item.text));
    }
    expect(copy).toContain("Entrance test on Friday");
    expect(copy).toContain(esc(site.contact.address));
    expect(copy).toContain(esc(site.contact.phones[0]!));
  });

  it("describes the school as an organisation with its address and phones, and the website", async () => {
    const html = await page("/");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
    const org = blocks.find((b) => b["@type"] === "EducationalOrganization")!;
    expect(org).toMatchObject({ name: royalJson.school.name, telephone: site.contact.phones, address: { streetAddress: site.contact.address } });
    expect(blocks.find((b) => b["@type"] === "WebSite")).toMatchObject({ name: royalJson.school.name });
  });

  it("escapes what the pack says, in the copy and in structured data", async () => {
    const hostile = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    await applyPack(
      db,
      testPack(
        edited((p) => {
          p.site.immersive.hero.tagline = hostile;
          p.site.immersive.why.items[0].text = hostile;
          p.site.programmes[0].name = hostile;
        }),
      ),
    );
    const html = await page("/");
    expect(html).not.toContain('<script>alert("x")');
    expect(html).not.toContain("<img src=x");
    expect(copyOf(html)).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    for (const block of [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]) expect(() => JSON.parse(block[1]!)).not.toThrow();
    await applyPack(db, testPack(royalJson));
  });

  it("is listed in the sitemap and llms.txt with the notices, and the five old pages are not", async () => {
    expect([...FILLED_PAGES]).toEqual(["/", "/notices"]);
    const sitemap = await file("/sitemap.xml");
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual(["https://royal.example/", "https://royal.example/notices"]);
    const llms = await file("/llms.txt");
    expect(llms).toContain("(https://royal.example/): ");
    expect(llms).toContain("(https://royal.example/notices): ");
    expect(llms).not.toContain("/programmes");
  });

  it("still sends the five old pages to the front page", async () => {
    for (const path of ["/programmes", "/admission", "/scholarships", "/facilities", "/contact"]) {
      const response = await renderPublicPage(new Request(`https://royal.example${path}`), { ...env, ASSETS: assets });
      expect(response.status, path).toBe(302);
      expect(response.headers.get("Location"), path).toBe("/");
    }
  });
});
