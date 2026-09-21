import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPack, parsePack } from "../src/core/config";
import { nepalDate } from "../src/core/dates";
import { createUser } from "../src/modules/accounts/service";
import { createContent, publishContent } from "../src/modules/content/service";
import { FILLED_PAGES, isFilledPage, renderPublicPage } from "../src/modules/site";
import { escapeHtml } from "../src/modules/site/html";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const royalSite = parsePack(royalJson).site;

/** What the web build gives the Worker: a static page with nothing school-specific in it. */
const SHELL = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width"/></head><body><div id="root">Loading</div><script src="/_next/app.js"></script></body></html>`;

function assets(status = 200, body = SHELL) {
  const seen: string[] = [];
  const binding = {
    fetch: async (request: Request) => {
      seen.push(new URL(request.url).pathname);
      return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"abc"', "Content-Length": String(body.length), "Cache-Control": "public, max-age=0, must-revalidate" } });
    },
  };
  return { binding: binding as unknown as Fetcher, seen };
}

async function page(path: string, over: { assets?: ReturnType<typeof assets>; method?: string; origin?: string; noOrigin?: boolean } = {}) {
  const a = over.assets ?? assets();
  // `origin` sets the school's own address; `noOrigin` leaves it unset, so the request's own address is used.
  const testEnv = { ...env, ASSETS: a.binding, ...(over.origin ? { SITE_ORIGIN: over.origin } : {}), ...(over.noOrigin ? { SITE_ORIGIN: undefined } : {}) };
  const response = await renderPublicPage(new Request(`https://school.example${path}`, { method: over.method ?? "GET" }), testEnv);
  return { response, html: await response.text(), a };
}

/** The structured data blocks in a page, parsed. */
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
const copyOf = (html: string) => /<div id="server-copy">([\s\S]*?)<\/div><script>/.exec(html)?.[1] ?? "";

let admin = "";
beforeAll(async () => {
  admin = (await createUser(db, key, { email: `site-${crypto.randomUUID().slice(0, 6)}@school.example`, password: "blue-river-lamp-2083", fullName: "Site Admin", roles: [{ role: "admin", scope: "institution" }] })).publicId;
});

const day = (offset: number) => {
  const base = new Date(`${nepalDate(new Date())}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
};
async function post(over: Record<string, unknown>, publish = true) {
  const created = await createContent(db, key, admin, { kind: "notice", title: "T", body: "B", contact: null, urgent: false, publishOn: day(0), hideAfter: null, ...over } as never);
  if (!created.ok) throw new Error(created.reason);
  if (publish) await publishContent(db, key, admin, created.publicId);
  return created.publicId;
}

// ---------------------------------------------------------------------------------------------
describe("which addresses are filled in", () => {
  it("names them in one list, and knows them exactly", () => {
    expect([...FILLED_PAGES]).toEqual(expect.arrayContaining(["/", "/notices", "/programmes", "/admission", "/scholarships", "/facilities", "/contact"]));
    for (const path of FILLED_PAGES) expect(isFilledPage(path), path).toBe(true);
  });

  it("leaves everything else to the static files and the API", () => {
    for (const other of ["/sign-in", "/portal", "/portal/content", "/reset-password", "/api/site/content", "/fonts/inter-5.3.0-latin.woff2", "/_next/static/x.js", "/notices/extra", "/Notices", ""]) {
      expect(isFilledPage(other), other).toBe(false);
    }
  });

  it("accepts a trailing slash on a page, the same page", () => {
    expect(isFilledPage("/notices/")).toBe(true);
  });
});

describe("before the school is set up", () => {
  it("serves the static page untouched: there is nothing to say yet", async () => {
    const { html, response } = await page("/notices");
    expect(response.status).toBe(200);
    expect(html).toBe(SHELL);
  });
});

describe("a set-up school", () => {
  beforeAll(async () => {
    await applyPack(db, parsePack(royalJson));
  });

  it("the home page gets a title, a description and a canonical address from the school's own details", async () => {
    const { html, response } = await page("/", { origin: "https://royal.example" });
    expect(response.status).toBe(200);
    expect(html).toContain(`<title>${royalJson.school.name}</title>`);
    expect(html).toContain(`<meta name="description" content="${escapeHtml(royalSite.home.summary)}"/>`);
    expect(html).toContain('<link rel="canonical" href="https://royal.example/"');
  });

  it("the canonical address uses the page's own origin when the school has no set one", async () => {
    const { html } = await page("/notices", { noOrigin: true });
    expect(html).toContain('rel="canonical" href="https://school.example/notices"');
    expect(html).toContain('"url":"https://school.example"');
  });

  it("a trailing slash on the school's own address makes no difference", async () => {
    const { html } = await page("/notices", { origin: "https://royal.example/" });
    expect(html).toContain('rel="canonical" href="https://royal.example/notices"');
  });

  it("replaces a title, description and canonical address the static page already has: exactly one of each", async () => {
    const shell = SHELL.replace("<head>", '<head><title>Default</title><meta name="description" content="A default"/><link rel="canonical" href="https://wrong.example/"/>');
    const { html } = await page("/notices", { assets: assets(200, shell) });
    for (const pattern of [/<title>/g, /<meta name="description"/g, /<link rel="canonical"/g]) expect((html.match(pattern) ?? []).length, String(pattern)).toBe(1);
    expect(html).not.toContain("Default");
    expect(html).not.toContain("wrong.example");
  });

  it("the page shell is kept whole: the app's markup and script are still there, in order, and the language is untouched", async () => {
    const { html } = await page("/");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<div id="root">Loading</div>');
    expect(html).toContain('<script src="/_next/app.js"></script>');
    expect(html.indexOf('id="server-copy"')).toBeLessThan(html.indexOf('id="root"'));
  });

  it("describes the school in structured data", async () => {
    const blocks = jsonLd((await page("/")).html);
    const org = blocks.find((b) => b["@type"] === "EducationalOrganization")!;
    expect(org).toMatchObject({ "@context": "https://schema.org", name: royalJson.school.name });
    expect(typeof org.url).toBe("string");
  });

  it("puts the real words in a plain block at the top of the body, then removes it for anyone running the app", async () => {
    const { html } = await page("/");
    const copy = copyOf(html);
    expect(copy).toContain(`<h1>${escapeHtml(royalSite.home.headline)}</h1>`);
    // Section names are written escaped (an apostrophe becomes &#39;).
    for (const section of royalJson.sections) expect(copy, section.name).toContain(section.name.replace(/'/g, "&#39;"));
    expect(copy).toContain('<a href="/notices">');
    expect(html).toContain('<script>document.getElementById("server-copy").remove()</script>');
  });

  it("the block is ordinary visible HTML, never hidden and never inside noscript (extractors drop noscript)", async () => {
    const { html } = await page("/notices");
    expect(html).not.toMatch(/<noscript/i);
    expect(html).not.toMatch(/id="server-copy"[^>]*(hidden|display:\s*none|aria-hidden)/i);
  });

  it("changes what the browser may keep: a short cache, and no stale validators from the untouched file", async () => {
    const { response } = await page("/notices");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Content-Type")).toMatch(/text\/html/);
  });

  it("a page on any site that is not production says not to index it (a staging site must never reach search results); production says nothing", async () => {
    const a = assets();
    const asProduction = await renderPublicPage(new Request("https://school.example/notices"), { ...env, ENVIRONMENT: "production", ASSETS: a.binding });
    expect(asProduction.headers.get("X-Robots-Tag")).toBeNull();
    for (const environment of ["staging", "development", "test", ""]) {
      const response = await renderPublicPage(new Request("https://school.example/notices"), { ...env, ENVIRONMENT: environment, ASSETS: assets().binding });
      expect(response.headers.get("X-Robots-Tag"), environment).toBe("noindex, nofollow");
    }
  });

  it("asks the static files for the same address, once, and passes a missing page straight through", async () => {
    const ok = assets();
    await page("/notices", { assets: ok });
    expect(ok.seen).toEqual(["/notices"]);

    const missing = assets(404, "not found");
    const { response, html } = await page("/notices", { assets: missing });
    expect(response.status).toBe(404);
    expect(html).toBe("not found");
  });

  it("a browser that already holds a copy still gets the filled page: conditional headers are not passed on to the static files", async () => {
    // The static files answer "304 not modified" to a request that carries the validators of the plain copy.
    const seenHeaders: Headers[] = [];
    const conditional = {
      fetch: async (request: Request) => {
        seenHeaders.push(new Headers(request.headers));
        const asks = request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since") || request.headers.has("Range");
        return asks ? new Response(null, { status: 304, headers: { ETag: '"abc"' } }) : new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"abc"' } });
      },
    };
    const testEnv = { ...env, ASSETS: conditional as unknown as Fetcher };
    const response = await renderPublicPage(
      new Request("https://school.example/notices", { headers: { "If-None-Match": '"abc"', "If-Modified-Since": "Wed, 01 Jan 2025 00:00:00 GMT", Range: "bytes=0-10", Accept: "text/html" } }),
      testEnv,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<title>Notices and updates | Royal Softech College</title>");
    for (const name of ["If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "If-Range", "Range"]) expect(seenHeaders[0]!.has(name), name).toBe(false);
    expect(seenHeaders[0]!.get("Accept")).toBe("text/html"); // other headers still go through
  });

  it("a page that is not HTML is left alone", async () => {
    const a = { binding: { fetch: async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }) } as unknown as Fetcher, seen: [] as string[] };
    const { html } = await page("/notices", { assets: a });
    expect(html).toBe("{}");
  });

  it("answers a HEAD request like a GET, without the body", async () => {
    const { response } = await page("/notices", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("the notice board page", () => {
  beforeAll(async () => {
    await applyPack(db, parsePack(royalJson));
  });

  it("carries what is live today, with its words and Nepali days, and nothing else", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    await post({ title: `Live notice ${tag}`, body: `First paragraph ${tag}\n\nSecond paragraph ${tag}`, urgent: true });
    await post({ kind: "holiday", title: `Holiday ${tag}`, body: "Closed.", hideAfter: day(9) });
    await post({ title: `Ended ${tag}`, publishOn: day(-30), hideAfter: day(-1) });
    await post({ title: `Future ${tag}`, publishOn: day(6) });
    await post({ title: `Draft ${tag}` }, false);

    const copy = copyOf((await page("/notices")).html);
    expect(copy).toMatch(/<h1>Notices and updates<\/h1>/);
    expect(copy).toContain(`Live notice ${tag}`);
    expect(copy).toContain(`Holiday ${tag}`);
    expect(copy).toContain(`Second paragraph ${tag}`);
    for (const hidden of ["Ended", "Future", "Draft"]) expect(copy, hidden).not.toContain(`${hidden} ${tag}`);
    expect(copy).toMatch(/Posted \d{1,2} [A-Z][a-z]+ 20\d\d/);
    expect(copy).toMatch(/until \d{1,2} [A-Z][a-z]+ 20\d\d/);
  });

  it("puts urgent items first, as the public API does", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    await post({ title: `Plain ${tag}`, publishOn: day(0) });
    await post({ title: `Urgent ${tag}`, urgent: true, publishOn: day(-9) });
    const copy = copyOf((await page("/notices")).html);
    expect(copy.indexOf(`Urgent ${tag}`)).toBeLessThan(copy.indexOf(`Plain ${tag}`));
  });

  it("shows a vacancy's contact as plain text, never as a link", async () => {
    await post({ kind: "vacancy", title: "Teacher wanted", body: "Maths.", contact: "jobs@school.example" });
    const copy = copyOf((await page("/notices")).html);
    expect(copy).toContain("Contact: jobs@school.example");
    expect(copy).not.toMatch(/href="(mailto|tel|javascript):/);
  });

  it("lists the same items in structured data, by name", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    await post({ title: `Structured ${tag}` });
    const list = jsonLd((await page("/notices")).html).find((b) => b["@type"] === "ItemList")!;
    const names = (list.itemListElement as { name: string; position: number }[]).map((i) => i.name);
    expect(names).toContain(`Structured ${tag}`);
    expect((list.itemListElement as { position: number }[])[0]!.position).toBe(1);
  });

  it("says so plainly when there is nothing to show", async () => {
    await db.prepare("UPDATE content_items SET status = 'draft'").run();
    const copy = copyOf((await page("/notices")).html);
    expect(copy).toContain("Nothing to show right now.");
    const list = jsonLd((await page("/notices")).html).find((b) => b["@type"] === "ItemList");
    expect((list?.itemListElement as unknown[] | undefined) ?? []).toHaveLength(0);
  });
});

describe("what comes from the database is never trusted as markup", () => {
  it("escapes a hostile title and text in the block, the title and the description", async () => {
    await applyPack(db, parsePack(royalJson));
    await post({ title: `<script>alert("t")</script><img src=x onerror=alert(1)>`, body: `</div><script>alert("b")</script>&amp; "quotes" 'single'`, contact: null });
    const { html } = await page("/notices");
    const copy = copyOf(html);

    expect(html).not.toContain('<script>alert("t")');
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('<script>alert("b")');
    expect(copy).toContain("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;");
    expect(copy).toContain("&amp;amp;");
    expect(copy).toContain("&quot;quotes&quot; &#39;single&#39;");
  });

  it("keeps a title from closing the structured data's script tag", async () => {
    await applyPack(db, parsePack(royalJson));
    await post({ title: `</script><script>alert("ld")</script>` });
    const { html } = await page("/notices");
    expect(html).not.toContain('<script>alert("ld")');
    // Every ld+json block still parses: nothing broke out of it.
    const blocks = jsonLd(html);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const list = blocks.find((b) => b["@type"] === "ItemList")!;
    expect((list.itemListElement as { name: string }[]).some((i) => i.name === `</script><script>alert("ld")</script>`)).toBe(true);
    expect(html).not.toMatch(/ld\+json">[^<]*<\/script>[^<]*<script>alert/);
  });

  it("writes no raw <, > or & and no line-separator character into structured data, whatever a title holds", async () => {
    await applyPack(db, parsePack(royalJson));
    const nasty = `a < b > c & d ${String.fromCharCode(0x2028)} e ${String.fromCharCode(0x2029)} f`;
    await post({ title: nasty });
    const { html } = await page("/notices");

    const payloads = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    for (const payload of payloads) {
      expect(payload).not.toMatch(/[<>&]/);
      expect(payload).not.toContain(String.fromCharCode(0x2028));
      expect(payload).not.toContain(String.fromCharCode(0x2029));
    }
    // ...and every one of them still means the original words.
    const list = jsonLd(html).find((b) => b["@type"] === "ItemList")!;
    expect((list.itemListElement as { name: string }[]).some((i) => i.name === nasty)).toBe(true);
  });

  it("escapes a school name and section names the same way", async () => {
    await applyPack(db, parsePack({ ...royalJson, school: { ...royalJson.school, name: `Evil <b>&"'</b> College`, shortName: "Evil" } }));
    const { html } = await page("/");
    expect(html).toContain("<title>Evil &lt;b&gt;&amp;&quot;&#39;&lt;/b&gt; College</title>");
    expect(html).not.toContain("<b>&");
    await applyPack(db, parsePack(royalJson));
  });
});

describe("another school, from the same code", () => {
  it("says its own name and sections, and none of the first school's", async () => {
    await applyPack(db, parsePack(sampleJson));
    const { html } = await page("/");
    expect(html).toContain(`<title>${sampleJson.school.name}</title>`);
    expect(html).not.toContain("Royal Softech");
    await applyPack(db, parsePack(royalJson));
  });
});

describe("cost", () => {
  it("reads the database a small, fixed number of times per page (no query per item)", async () => {
    await applyPack(db, parsePack(royalJson));
    await Promise.all([1, 2, 3, 4, 5, 6].map((n) => post({ title: `Count ${n}` })));
    // A round trip is one batch, or one statement run on its own.
    let statements = 0;
    let batches = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") return (sql: string) => { statements++; return target.prepare(sql); };
        if (prop === "batch") return async (list: D1PreparedStatement[]) => { batches++; return target.batch(list); };
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;
    const a = assets();
    await renderPublicPage(new Request("https://school.example/notices"), { ...env, DB: counting, ASSETS: a.binding });
    // The configuration is one batch of five statements; the notices are one statement: two round trips.
    expect(batches).toBe(1);
    expect(statements).toBeLessThanOrEqual(6);
  });
});

describe("the six fixed pages", () => {
  const SIX = ["/", "/programmes", "/admission", "/scholarships", "/facilities", "/contact"];
  const LINKS = ["/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"];
  const fixed: [string, string, string[]][] = [
    // What each page must say comes from the pack, so the test holds for any content (the real words arrive at the end).
    ["/programmes", "Programmes", [...royalSite.programmes.map((p) => p.name), ...royalSite.programmes.map((p) => p.affiliation), ...royalSite.programmes.filter((p) => p.options.length > 0).map((p) => p.options.join(", "))]],
    ["/admission", "Admission", royalSite.admission.steps.map((s) => s.title)],
    ["/scholarships", "Scholarships", royalSite.scholarships.items.map((i) => i.title)],
    ["/facilities", "Facilities", royalSite.facilities.items.flatMap((i) => (i.body ? [i.name, i.body] : [i.name]))],
    ["/contact", "Contact", [royalSite.contact.address, ...royalSite.contact.phones]],
  ];

  beforeAll(async () => {
    await applyPack(db, parsePack(royalJson));
  });

  it.each(fixed)("%s has its title, canonical address, heading, links to every page and its own words", async (path, heading, words) => {
    const { html } = await page(path, { origin: "https://royal.example" });
    expect(html).toContain(`<title>${heading} | Royal Softech College</title>`);
    expect(html).toContain(`rel="canonical" href="https://royal.example${path}"`);
    const copy = copyOf(html);
    expect(copy).toContain(`<h1>${heading}</h1>`);
    for (const link of LINKS) expect(copy, link).toContain(`<a href="${link}">`);
    for (const text of words) expect(copy, text).toContain(escapeHtml(text));
  });

  it("Home leads with its headline and the way to apply, then groups the programmes by section, then the steps and the contact", async () => {
    const copy = copyOf((await page("/")).html);
    expect(copy).toContain(`<h1>${escapeHtml(royalSite.home.headline)}</h1>`);
    expect(copy).toContain('<a href="/admission">How to apply</a>');
    expect(copy.indexOf("<h3>+2</h3>")).toBeLessThan(copy.indexOf("<h3>Bachelor&#39;s</h3>"));
    expect(copy).toContain(`<a href="/programmes#${royalSite.programmes[0]!.key}">`);
    for (const step of royalSite.admission.steps) expect(copy).toContain(`<li>${escapeHtml(step.title)}</li>`);
    expect(copy).toContain(`Phone: ${royalSite.contact.phones[0]}`);
    expect(copy.indexOf("How to apply</h2>")).toBeLessThan(copy.indexOf("<h2>Contact</h2>"));
  });

  it("describes the pages in structured data, from what the pack says and nothing more", async () => {
    const programmesLd = jsonLd((await page("/programmes", { origin: "https://royal.example" })).html).find((b) => b["@type"] === "ItemList")!;
    const items = programmesLd.itemListElement as { name: string; url: string; position: number }[];
    expect(items).toHaveLength(royalSite.programmes.length);
    expect(items[0]).toMatchObject({ position: 1, name: royalSite.programmes[0]!.name, url: `https://royal.example/programmes#${royalSite.programmes[0]!.key}` });

    const howTo = jsonLd((await page("/admission")).html).find((b) => b["@type"] === "HowTo")!;
    expect(howTo.name).toBe("How to apply to Royal Softech College");
    expect((howTo.step as unknown[]).length).toBe(royalSite.admission.steps.length);

    const contactLd = jsonLd((await page("/contact")).html).find((b) => b["@type"] === "ContactPage")!;
    // It points to the organisation block (which carries the phones) instead of repeating it.
    expect(contactLd.mainEntity).toEqual({ "@id": (jsonLd((await page("/contact")).html).find((b) => b["@type"] === "EducationalOrganization")!)["@id"] });

    const facilitiesLd = jsonLd((await page("/facilities")).html).find((b) => b["@type"] === "ItemList")!;
    expect((facilitiesLd.itemListElement as unknown[]).length).toBe(royalSite.facilities.items.length);
    for (const path of SIX) for (const block of jsonLd((await page(path)).html)) expect(block["@context"]).toBe("https://schema.org");
  });

  it("escapes hostile text from the pack on every page, in the block and in structured data", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test deliberately edits loosely-typed pack data
    const bad = structuredClone(royalJson) as any;
    const script = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    bad.site.home.headline = script;
    bad.site.programmes[0].name = script;
    bad.site.programmes[0].summary = script;
    bad.site.admission.steps[0].title = script;
    bad.site.scholarships.items[0].body = script;
    bad.site.facilities.items[0].name = script;
    bad.site.contact.address = script;
    await applyPack(db, parsePack(bad));
    for (const path of SIX) {
      const { html } = await page(path);
      expect(html, path).not.toContain('<script>alert("x")');
      expect(html, path).not.toContain("<img src=x");
      for (const block of jsonLd(html)) expect(block, path).toBeTruthy(); // every block still parses
    }
    expect(copyOf((await page("/contact")).html)).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    await applyPack(db, parsePack(royalJson));
  });

  it("another school gets its own words on every page, and none of the first school's", async () => {
    await applyPack(db, parsePack(sampleJson));
    for (const path of SIX) {
      const { html } = await page(path);
      for (const word of ["Royal", "Lahan", "Siraha", "Purbanchal", "Tribhuvan", "NEB"]) expect(html, `${path} ${word}`).not.toContain(word);
    }
    expect(copyOf((await page("/")).html)).toContain("Sample Basic School: Nursery to Grade 10");
    await applyPack(db, parsePack(royalJson));
  });

  it("serves the static page untouched when the school has no site words yet (before provisioning with them)", async () => {
    await db.prepare("DELETE FROM site_content").run();
    for (const path of SIX) expect((await page(path)).html, path).toBe(SHELL);
    // The notice board does not depend on them.
    expect(copyOf((await page("/notices")).html)).toContain("<h1>Notices and updates</h1>");
    await applyPack(db, parsePack(royalJson));
  });

  it("reads the database twice for a fixed page: the configuration batch, then one statement for the words", async () => {
    let statements = 0;
    let batches = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") return (sql: string) => { statements++; return target.prepare(sql); };
        if (prop === "batch") return async (list: D1PreparedStatement[]) => { batches++; return target.batch(list); };
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;
    await renderPublicPage(new Request("https://school.example/programmes"), { ...env, DB: counting, ASSETS: assets().binding });
    expect(batches).toBe(1);
    expect(statements).toBe(6); // five in the configuration batch, one for the words
  });
});

describe("structured data that ties the pages together", () => {
  const ORG = "https://royal.example/#organization";
  const PAGES = ["/", "/programmes", "/admission", "/scholarships", "/facilities", "/contact", "/notices"];

  beforeAll(async () => {
    await applyPack(db, parsePack(royalJson));
  });

  const blocks = async (path: string) => jsonLd((await page(path, { origin: "https://royal.example" })).html);
  const orgOf = (list: Record<string, unknown>[]) => list.find((b) => b["@type"] === "EducationalOrganization")!;

  it("every filled page names its organisation with the same stable @id, and only once", async () => {
    for (const path of PAGES) {
      const list = await blocks(path);
      expect(orgOf(list)["@id"], path).toBe(ORG);
      expect(list.filter((b) => b["@type"] === "EducationalOrganization"), path).toHaveLength(1);
    }
  });

  it("Home and Contact add what the pack says about the school: its description, address and phones (and no email when it has none)", async () => {
    for (const path of ["/", "/contact"]) {
      const org = orgOf(await blocks(path));
      expect(org, path).toMatchObject({
        description: royalSite.home.summary,
        address: { "@type": "PostalAddress", streetAddress: royalSite.contact.address },
        telephone: royalSite.contact.phones,
      });
      expect(org, path).not.toHaveProperty("email");
    }
  });

  it("the other pages keep the organisation block small: address and phones belong to Home and Contact", async () => {
    for (const path of ["/programmes", "/admission", "/scholarships", "/facilities", "/notices"]) expect(orgOf(await blocks(path)), path).not.toHaveProperty("telephone");
  });

  it("Home describes the website and points to its organisation as the publisher", async () => {
    const site = (await blocks("/")).find((b) => b["@type"] === "WebSite")!;
    expect(site).toMatchObject({ "@id": "https://royal.example/#website", name: royalJson.school.name, url: "https://royal.example", publisher: { "@id": ORG } });
  });

  it.each([
    ["/programmes", "Programmes"],
    ["/admission", "Admission"],
    ["/scholarships", "Scholarships"],
    ["/facilities", "Facilities"],
    ["/contact", "Contact"],
    ["/notices", "Notices and updates"],
  ])("%s has a two-step breadcrumb: the school, then the page", async (path, name) => {
    const crumbs = (await blocks(path)).find((b) => b["@type"] === "BreadcrumbList")!;
    expect(crumbs.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: royalJson.school.name, item: "https://royal.example/" },
      { "@type": "ListItem", position: 2, name, item: `https://royal.example${path}` },
    ]);
  });

  it("Home has no breadcrumb: it is the top", async () => {
    expect((await blocks("/")).some((b) => b["@type"] === "BreadcrumbList")).toBe(false);
  });

  it("the contact page points to the organisation instead of repeating it", async () => {
    const list = await blocks("/contact");
    expect(list.find((b) => b["@type"] === "ContactPage")!.mainEntity).toEqual({ "@id": ORG });
  });

  it("another school gets its own details, not the first school's", async () => {
    await applyPack(db, parsePack(sampleJson));
    const org = orgOf(await blocks("/"));
    expect(org).toMatchObject({ "@id": ORG, address: { streetAddress: sampleJson.site.contact.address }, telephone: sampleJson.site.contact.phones, email: sampleJson.site.contact.email });
    expect(JSON.stringify(org)).not.toContain("Lahan");
    await applyPack(db, parsePack(royalJson));
  });
});
