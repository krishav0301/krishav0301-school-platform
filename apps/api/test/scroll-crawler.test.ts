import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPack, loadConfig, parsePack } from "../src/core/config";
import { nepalDate } from "../src/core/dates";
import { createUser } from "../src/modules/accounts/service";
import { createContent, publishContent } from "../src/modules/content/service";
import { FILLED_PAGES, renderCrawlerFile, renderPublicPage } from "../src/modules/site";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import royalJson from "../../../packs/royal-softech/pack.json";
import { classicOf, testPack } from "./programme-fixtures";

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const SHELL = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/></head><body><div id="root">Loading</div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) } as unknown as Fetcher;
const page = async (path: string) => (await renderPublicPage(new Request(`https://lahan.example${path}`), { ...env, ASSETS: assets, SITE_ORIGIN: "https://lahan.example" })).text();
const file = async (path: string) => (await renderCrawlerFile(new Request(`https://lahan.example${path}`), { ...env, ENVIRONMENT: "production", SITE_ORIGIN: "https://lahan.example" } as never)).text();
const copyOf = (html: string) => /<div id="server-copy">([\s\S]*?)<\/div><script>/.exec(html)?.[1] ?? "";

let admin = "";
beforeAll(async () => {
  admin = (await createUser(db, key, { email: `scroll-${crypto.randomUUID().slice(0, 6)}@school.example`, password: "blue-river-lamp-2083", fullName: "Scroll Admin", roles: [{ role: "admin", scope: "institution" }] })).publicId;
  await applyPack(db, parsePack(lahanJson));
  const created = await createContent(db, key, admin, { kind: "notice", title: "Exam routine for the final term", body: "B", contact: null, urgent: false, publishOn: nepalDate(new Date()), hideAfter: null } as never);
  if (!created.ok) throw new Error(created.reason);
  await publishContent(db, key, admin, created.publicId);
});

describe("a scroll school's front page, for crawlers", () => {
  it("says the name, address, phone, intro, classes, live notices and the Facebook link", async () => {
    const copy = copyOf(await page("/"));
    const site = lahanJson.site;
    expect(copy).toContain(`<h1>${lahanJson.school.name}</h1>`);
    expect(copy).toContain(site.contact.address);
    expect(copy).toContain(site.contact.phones[0]);
    expect(copy).toContain(site.scroll.intro.slice(0, 40));
    for (const card of site.scroll.cards) {
      expect(copy).toContain(card.title);
      expect(copy).toContain(card.text.replace(/'/g, "&#39;"));
    }
    expect(copy).toContain("Exam routine for the final term");
    expect(copy).toContain("Every child is a light waiting to shine.");
    expect(copy).toContain("Darkness to Light");
    expect(copy).toContain("From Darkness to Light. Raising the Leaders of Tomorrow");
    expect(copy).toContain("2058");
    expect(copy).toContain('href="https://www.facebook.com/profile.php?id=100090093189751"');
  });

  it("does not list the classic pages' words (programmes, steps) for a scroll school", async () => {
    const copy = copyOf(await page("/"));
    expect(copy).not.toContain("To be added");
  });

  it("escapes what the pack says", async () => {
    const hostile = parsePack({ ...lahanJson, site: { ...lahanJson.site, scroll: { ...lahanJson.site.scroll, cards: [{ title: "<img src=x onerror=alert(1)>", text: "<script>alert(2)</script>" }] } } });
    await applyPack(db, hostile);
    const copy = copyOf(await page("/"));
    expect(copy).not.toContain("<img src=x");
    expect(copy).toContain("&lt;img src=x");
    await applyPack(db, parsePack(lahanJson));
  });
});

describe("the layout stamped on the page, so the front page knows which school it is before anything loads", () => {
  const stamp = async (path: string) => /<html[^>]*data-public-layout="([a-z]+)"/.exec(await page(path))?.[1];

  it("says scroll for a scroll school and classic for a classic one", async () => {
    expect(await stamp("/")).toBe("scroll");
    await applyPack(db, testPack(classicOf(royalJson)));
    expect(await stamp("/")).toBe("classic");
    expect(await stamp("/notices")).toBe("classic");
    await applyPack(db, parsePack(lahanJson));
  });
});

describe("the old public pages on a scroll school", () => {
  it("send the visitor to the front page instead: there is no way to reach an old page (PM, 2026-10-13)", async () => {
    for (const path of ["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/programmes/"]) {
      const response = await renderPublicPage(new Request(`https://lahan.example${path}`), { ...env, ASSETS: assets, SITE_ORIGIN: "https://lahan.example" });
      expect(response.status, path).toBe(302);
      expect(response.headers.get("Location"), path).toBe("/");
      expect(await response.text(), path).not.toContain("Loading");
    }
  });

  it("keep serving the pages a scroll school does have: the front page, the notices and the privacy notice", async () => {
    for (const path of ["/", "/notices"]) expect((await renderPublicPage(new Request(`https://lahan.example${path}`), { ...env, ASSETS: assets, SITE_ORIGIN: "https://lahan.example" })).status, path).toBe(200);
  });

  it("is told to the web app in the public configuration, so its shared pages draw no old menu", async () => {
    expect((await loadConfig(db))!.school.publicLayout).toBe("scroll");
  });

  it("the sitemap and llms.txt list only the front page and the notices", async () => {
    expect([...FILLED_PAGES]).toEqual(["/", "/notices"]);
    const sitemap = await file("/sitemap.xml");
    expect(sitemap).toContain("https://lahan.example/notices");
    expect(sitemap).not.toContain("/programmes");
    const llms = await file("/llms.txt");
    expect(llms).toContain("(https://lahan.example/notices)");
    expect(llms).not.toContain("/programmes");
  });
});

describe("a school without the one-page layout (PM, 2026-10-18, D-177): a Sign in button and nothing else", () => {
  it("is classic in the public configuration", async () => {
    await applyPack(db, testPack(classicOf(royalJson)));
    expect((await loadConfig(db))!.school.publicLayout).toBe("classic");
  });

  it("sends the five old public pages to the front page too: they are gone for every school", async () => {
    await applyPack(db, testPack(classicOf(royalJson)));
    for (const path of ["/programmes", "/admission", "/scholarships", "/facilities", "/contact"]) {
      const response = await renderPublicPage(new Request(`https://lahan.example${path}`), { ...env, ASSETS: assets, SITE_ORIGIN: "https://lahan.example" });
      expect(response.status, path).toBe(302);
      expect(response.headers.get("Location"), path).toBe("/");
    }
  });

  it("sends the old pages to the front page even before the school is set up, and writes nothing to the database to do it", async () => {
    const response = await renderPublicPage(new Request("https://lahan.example/programmes"), { ...env, DB: undefined as never, ASSETS: assets, SITE_ORIGIN: "https://lahan.example" });
    expect(response.status).toBe(302);
  });

  it("gives the front page's crawler copy only its name and a link to sign in", async () => {
    await applyPack(db, testPack(classicOf(royalJson)));
    const copy = copyOf(await page("/"));
    expect(copy).toContain(`<h1>${royalJson.school.name}</h1>`);
    expect(copy).toContain('<a href="/sign-in">Sign in</a>');
    for (const word of ["/programmes", "/admission", "/contact", "Programmes", "How to apply"]) expect(copy, word).not.toContain(word);
  });

  it("lists only the front page and the notices in the sitemap and llms.txt, and says the front page is a way to sign in", async () => {
    await applyPack(db, testPack(classicOf(royalJson)));
    const sitemap = await file("/sitemap.xml");
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual(["https://lahan.example/", "https://lahan.example/notices"]);
    const llms = await file("/llms.txt");
    expect(llms).toContain("(https://lahan.example/): The front page of");
    expect(llms).toContain("a way to sign in");
    expect(llms).not.toContain("/programmes");
  });
});
