import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPack, parsePack } from "../src/core/config";
import { nepalDate } from "../src/core/dates";
import { createUser } from "../src/modules/accounts/service";
import { createContent, publishContent } from "../src/modules/content/service";
import { FILLED_PAGES, filledPagesFor, renderCrawlerFile, renderPublicPage } from "../src/modules/site";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";
import royalJson from "../../../packs/royal-softech/pack.json";
import { testPack } from "./programme-fixtures";

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
    for (const batch of site.scroll.batches) expect(copy).toContain(batch.title);
    expect(copy).toContain("Exam routine for the final term");
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
    const hostile = parsePack({ ...lahanJson, site: { ...lahanJson.site, scroll: { ...lahanJson.site.scroll, batches: [{ title: "<img src=x onerror=alert(1)>" }] } } });
    await applyPack(db, hostile);
    const copy = copyOf(await page("/"));
    expect(copy).not.toContain("<img src=x");
    expect(copy).toContain("&lt;img src=x");
    await applyPack(db, parsePack(lahanJson));
  });
});

describe("the classic pages on a scroll school", () => {
  it("are served untouched: the Worker has nothing true to put in them", async () => {
    for (const path of ["/programmes", "/admission", "/scholarships", "/facilities", "/contact"]) expect(await page(path), path).toBe(SHELL);
  });

  it("the sitemap and llms.txt list only the front page and the notices", async () => {
    expect([...filledPagesFor("scroll")]).toEqual(["/", "/notices"]);
    const sitemap = await file("/sitemap.xml");
    expect(sitemap).toContain("https://lahan.example/notices");
    expect(sitemap).not.toContain("/programmes");
    const llms = await file("/llms.txt");
    expect(llms).toContain("(https://lahan.example/notices)");
    expect(llms).not.toContain("/programmes");
  });
});

describe("a classic school is unchanged", () => {
  it("lists all its pages", async () => {
    expect([...filledPagesFor("classic")]).toEqual([...FILLED_PAGES]);
    await applyPack(db, testPack(royalJson));
    const sitemap = await file("/sitemap.xml");
    for (const path of FILLED_PAGES) expect(sitemap, path).toContain(`https://lahan.example${path === "/" ? "/" : path}`);
    const programmes = copyOf(await page("/programmes"));
    expect(programmes).toContain("<h1>");
  });
});
