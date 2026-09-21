import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPack, parsePack } from "../src/core/config";
import worker from "../src/index";
import { CRAWLER_FILES, FILLED_PAGES, isCrawlerFile, pagesWithoutSummary, renderCrawlerFile } from "../src/modules/site";
import royalJson from "../../../packs/royal-softech/pack.json";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const ask = async (path: string, over: Record<string, unknown> = {}, method = "GET", host = "https://school.example") => {
  const response = await renderCrawlerFile(new Request(`${host}${path}`, { method }), { ...env, ...over } as never);
  return { response, text: await response.text() };
};
const production = { ENVIRONMENT: "production", SITE_ORIGIN: "https://royal.example" };

beforeAll(async () => {
  await applyPack(env.DB, parsePack(royalJson));
});

describe("which files the Worker writes", () => {
  it("names them in one list, and knows them exactly", () => {
    expect([...CRAWLER_FILES]).toEqual(["/robots.txt", "/sitemap.xml", "/llms.txt"]);
    for (const path of CRAWLER_FILES) expect(isCrawlerFile(path), path).toBe(true);
    for (const other of ["/", "/notices", "/robots.txt/", "/Robots.txt", "/sitemap.xml.gz", "/api/robots.txt", "/llms.md"]) expect(isCrawlerFile(other), other).toBe(false);
  });
});

describe("every page the Worker fills in can be introduced", () => {
  it("has a name and a summary for llms.txt, so a new page cannot be added without one", () => {
    expect(pagesWithoutSummary()).toEqual([]);
  });
});

describe("robots.txt", () => {
  it("on a production site: everyone may read the public pages, and is told where not to go and where the sitemap is", async () => {
    const { response, text } = await ask("/robots.txt", production);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(text).toContain("User-agent: *\nAllow: /\n");
    for (const private_ of ["/api/", "/portal", "/sign-in", "/reset-password", "/design"]) expect(text, private_).toContain(`Disallow: ${private_}\n`);
    expect(text).toContain("Sitemap: https://royal.example/sitemap.xml");
    expect(text).not.toMatch(/Disallow: \/\s*(\n|$)/);
  });

  it("on any site that is not production (staging, development, tests): nobody is invited in, and there is no sitemap to follow", async () => {
    for (const environment of ["staging", "development", "test", "", "Production", "prod"]) {
      const { text } = await ask("/robots.txt", { ENVIRONMENT: environment, SITE_ORIGIN: "https://staging.example" });
      expect(text, environment).toContain("User-agent: *\nDisallow: /\n");
      expect(text, environment).not.toMatch(/Allow: \//);
      expect(text, environment).not.toContain("Sitemap:");
    }
  });

  it("works before the school is set up, and so does the sitemap: they do not depend on its details", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      const { response } = await ask(path, { ...production, DB: env.SCRATCH_DB });
      expect(response.status, path).toBe(200);
    }
  });
});

describe("sitemap.xml", () => {
  it("lists every page the Worker fills in, once, with its full address on the school's own site", async () => {
    const { response, text } = await ask("/sitemap.xml", production);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(text.trim().endsWith("</urlset>")).toBe(true);

    const locs = [...text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(FILLED_PAGES.map((p) => `https://royal.example${p}`));
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("never claims a last-changed day it does not know", async () => {
    expect((await ask("/sitemap.xml", production)).text).not.toContain("<lastmod>");
  });

  it("lists the six fixed pages and the notice board", async () => {
    const { text } = await ask("/sitemap.xml", production);
    for (const path of ["/", "/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"]) expect(text, path).toContain(`<loc>https://royal.example${path}</loc>`);
  });

  it("escapes the address, so an odd site address cannot break the XML", async () => {
    const { text } = await ask("/sitemap.xml", { ...production, SITE_ORIGIN: "https://royal.example/a&b<c>" });
    expect(text).not.toMatch(/<loc>[^<]*[&](?!amp;|lt;|gt;|quot;|#39;)/);
    expect(text).toContain("a&amp;b&lt;c&gt;");
  });

  it("uses the request's own address when the school has not set one", async () => {
    const { text } = await ask("/sitemap.xml", { ENVIRONMENT: "production", SITE_ORIGIN: undefined }, "GET", "https://elsewhere.example");
    expect(text).toContain("<loc>https://elsewhere.example/notices</loc>");
  });
});

describe("llms.txt", () => {
  it("introduces the school and points to its pages, in the plain Markdown layout AI tools look for", async () => {
    const { response, text } = await ask("/llms.txt", production);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(text.startsWith(`# ${royalJson.school.name}\n`)).toBe(true);
    expect(text).toMatch(/\n> [^\n]+\n/);
    expect(text).toContain("\n## Pages\n");
    for (const path of FILLED_PAGES) expect(text, path).toContain(`](https://royal.example${path})`);
    expect(text).toContain("- [Notices and updates](https://royal.example/notices): Notices, holidays, routines and vacancies from Royal Softech College.");
  });

  it("introduces every fixed page with its own line", async () => {
    const { text } = await ask("/llms.txt", production);
    expect(text).toContain("- [Programmes](https://royal.example/programmes): The programmes offered by Royal Softech College, with their levels, affiliations and durations.");
    expect(text).toContain("- [Admission](https://royal.example/admission): How to apply to Royal Softech College: the admission steps, from enquiry to enrolment.");
    for (const path of ["/scholarships", "/facilities", "/contact"]) expect(text, path).toContain(`](https://royal.example${path}): `);
  });

  it("opens with the school's own summary and says how to reach it, from what the pack says", async () => {
    const { text } = await ask("/llms.txt", production);
    const site = parsePack(royalJson).site;
    expect(text).toContain(`\n> ${site.home.summary}\n`);
    expect(text).toContain("\n## Contact\n");
    expect(text).toContain(`- Address: ${site.contact.address}`);
    expect(text).toContain(`- Phone: ${site.contact.phones.join(", ")}`);
    expect(text).not.toContain("- Email:"); // Royal's pack has none, so none is invented
    expect(text.indexOf("## Pages")).toBeLessThan(text.indexOf("## Contact"));
  });

  it("keeps what the pack says on one line each, so it cannot add headings or links of its own", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test deliberately edits loosely-typed pack data
    const bad = structuredClone(royalJson) as any;
    bad.site.home.summary = "A summary\n\n## Injected\n[click](https://evil.example)";
    bad.site.contact.address = "12 Road\n\n## Also injected";
    await applyPack(env.DB, parsePack(bad));
    const { text } = await ask("/llms.txt", production);
    expect(text).not.toMatch(/^## (Injected|Also injected)/m);
    expect(text.match(/^# /gm)).toHaveLength(1);
    expect(text.match(/^## /gm)).toHaveLength(2); // Pages and Contact, nothing else
    await applyPack(env.DB, parsePack(royalJson));
  });

  it("before the school has site words, falls back to the sections line and has no Contact section", async () => {
    await env.DB.prepare("DELETE FROM site_content").run();
    const { text } = await ask("/llms.txt", production);
    expect(text).toContain("\n> Royal Softech College: +2, Bachelor's.\n");
    expect(text).not.toContain("## Contact");
    await applyPack(env.DB, parsePack(royalJson));
  });

  it("says nothing before the school is set up (there is nothing true to say): 404, on a database with no school in it", async () => {
    const { response } = await ask("/llms.txt", { ...production, DB: env.SCRATCH_DB });
    expect(response.status).toBe(404);
  });

  it("keeps a name or a summary on one line, so it cannot add headings or links of its own", async () => {
    await applyPack(env.DB, parsePack({ ...royalJson, school: { ...royalJson.school, name: "Evil College\n\n## Injected\n[click](https://evil.example)", shortName: "Evil" } }));
    const { text } = await ask("/llms.txt", production);
    expect(text).not.toMatch(/^## Injected/m);
    expect(text.split("\n")[0]).toMatch(/^# Evil College/);
    expect(text.match(/^# /gm)).toHaveLength(1);
    await applyPack(env.DB, parsePack(royalJson));
  });
});

describe("what is not a file, and what is not a read", () => {
  it("a write to one of these addresses is not answered here", async () => {
    const response = worker.fetch(new Request("https://school.example/robots.txt", { method: "POST" }), env as never, ctx);
    expect((await response).status).toBe(404);
  });

  it("HEAD is answered like GET, without the body", async () => {
    const { response, text } = await ask("/sitemap.xml", production, "HEAD");
    expect(response.status).toBe(200);
    expect(text).toBe("");
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
  });

  it("the Worker's front door hands the three files to this code, with no static files bound", async () => {
    for (const path of CRAWLER_FILES) {
      const response = await worker.fetch(new Request(`https://school.example${path}`), { ...env, ...production, ASSETS: undefined } as never, ctx);
      expect(response.status, path).toBe(200);
    }
  });

  it("all three may be kept for a while by a browser or a crawler, since they change rarely", async () => {
    for (const path of CRAWLER_FILES) expect((await ask(path, production)).response.headers.get("Cache-Control"), path).toBe("public, max-age=3600");
  });
});
