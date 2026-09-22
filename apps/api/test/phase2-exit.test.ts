/**
 * The Phase 2 exit check (docs/build-plan.md): the public website and its editable content working together, for
 * BOTH schools, through the real HTTP API, the real Worker page renderer and the real database schema.
 *
 *  - the school's six fixed pages carry ITS words, and none of the other school's
 *  - the Admin publishes a notice and it appears on the public site; taking it down removes it; an ended one never shows
 *  - a person who is not the Admin cannot edit, and nobody signed out can
 *  - the pages, the sitemap and `llms.txt` list the same pages, and a production site invites search but not AI training
 *  - the audit log is still an unbroken chain after all of it
 *
 * Page weight is checked on the production build (`scripts/check-page-weight.mjs`, in CI), and the live staging site
 * is checked by hand and recorded in DECISIONS.md.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { applyPack, parsePack, type Pack } from "../src/core/config";
import { nepalDate } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { FILLED_PAGES, renderCrawlerFile, renderPublicPage } from "../src/modules/site";
import royalJson from "../../../packs/royal-softech/pack.json";
import sampleJson from "../../../packs/sample-basic-school/pack.json";

const app = createApp();
const SHELL = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/></head><body><div id="root">Loading</div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) } as unknown as Fetcher;
const copyOf = (html: string) => /<div id="server-copy">([\s\S]*?)<\/div><script>/.exec(html)?.[1] ?? "";
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const day = (offset: number) => {
  const base = new Date(`${nepalDate(new Date())}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
};

describe.each([
  { label: "Royal Softech", json: royalJson, other: sampleJson, database: () => env.DB },
  { label: "Sample Basic School", json: sampleJson, other: royalJson, database: () => env.SCRATCH_DB },
])("Phase 2 exit check: $label", ({ json, other, database }) => {
  const pack: Pack = parsePack(json);
  const rival: Pack = parsePack(other);
  const db = () => database();
  const bindings = (extra: Record<string, unknown> = {}) => ({ ...env, DB: db(), ASSETS: assets, ...extra });

  const call = (path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) =>
    app.request(
      `https://school.example${path}`,
      {
        method: options.method ?? "GET",
        headers: { "Sec-Fetch-Site": "same-origin", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      bindings(),
    );

  /** A page as the Worker serves it: the block a crawler reads. */
  const pageCopy = async (path: string) => copyOf(await (await renderPublicPage(new Request(`https://school.example${path}`), bindings())).text());

  const cookies: Record<string, string> = {};
  async function signedIn(role: RoleClaim["role"], scope: RoleClaim["scope"]) {
    const { publicId } = await createUser(db(), env.AUDIT_HMAC_KEY, {
      email: `${role}-p2exit-${crypto.randomUUID().slice(0, 6)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `${role} person`,
      roles: [{ role: role as never, scope: scope as never }],
    });
    const now = Math.floor(Date.now() / 1000);
    return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles: [{ role, scope } as RoleClaim], iat: now, exp: now + 600 })}`;
  }

  it("the school starts from its pack, and the public read gives its words", async () => {
    await applyPack(db(), pack);
    const body = (await (await call("/api/site/pages")).json()) as { site: unknown };
    expect(body.site).toEqual(pack.site);
    cookies.admin = await signedIn("admin", "institution");
    cookies.student = await signedIn("student", "own");
    cookies.teacher = await signedIn("teacher", "assigned");
    cookies.coordinator = await signedIn("coordinator", "institution");
  });

  it("each of the six fixed pages carries this school's words, and none of the other school's", async () => {
    for (const path of ["/", "/programmes", "/admission", "/scholarships", "/facilities", "/contact"]) {
      const copy = await pageCopy(path);
      expect(copy, path).not.toBe("");
      expect(copy, `${path} has no ${rival.school.name}`).not.toContain(escape(rival.site.home.headline));
      for (const programme of rival.site.programmes) expect(copy, `${path}: ${programme.name}`).not.toContain(escape(programme.name));
    }
    expect(await pageCopy("/")).toContain(escape(pack.site.home.headline));
    for (const programme of pack.site.programmes) expect(await pageCopy("/programmes"), programme.name).toContain(escape(programme.name));
    for (const step of pack.site.admission.steps) expect(await pageCopy("/admission"), step.title).toContain(escape(step.title));
    for (const phone of pack.site.contact.phones) expect(await pageCopy("/contact"), phone).toContain(escape(phone));
  });

  it("the sitemap, llms.txt and the pages agree on which pages there are, and the school's name is its own", async () => {
    const at = { ENVIRONMENT: "production", SITE_ORIGIN: "https://school.example" };
    const sitemap = await (await renderCrawlerFile(new Request("https://school.example/sitemap.xml"), bindings(at) as never)).text();
    const llms = await (await renderCrawlerFile(new Request("https://school.example/llms.txt"), bindings(at) as never)).text();
    for (const path of FILLED_PAGES) {
      expect(sitemap, path).toContain(`<loc>https://school.example${path}</loc>`);
      expect(llms, path).toContain(`](https://school.example${path}): `);
    }
    expect(llms.startsWith(`# ${pack.school.name}\n`)).toBe(true);
    expect(llms).not.toContain(rival.school.name);
  });

  it("a production site invites search but not AI training; any other site keeps everyone out", async () => {
    const robots = async (environment: string) => (await (await renderCrawlerFile(new Request("https://school.example/robots.txt"), bindings({ ENVIRONMENT: environment, SITE_ORIGIN: "https://school.example" }) as never)).text());
    const production = await robots("production");
    expect(production).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
    expect(production).toContain("User-agent: GPTBot\nDisallow: /\n");
    expect(production).toContain("Sitemap: https://school.example/sitemap.xml");
    expect(await robots("staging")).toBe("User-agent: *\nDisallow: /\n");
  });

  it("the Admin publishes a notice and it is public at once; taking it down removes it", async () => {
    const title = `Exit notice ${crypto.randomUUID().slice(0, 6)}`;
    const created = await call("/api/content", { method: "POST", cookie: cookies.admin, body: { kind: "notice", title, body: "Classes are closed on Friday.", publishOn: day(0), urgent: true } });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    // A draft is not public.
    const publicTitles = async () => ((await (await call("/api/site/content")).json()) as { items: { title: string; urgent: boolean }[] }).items;
    expect((await publicTitles()).map((i) => i.title)).not.toContain(title);
    expect(await pageCopy("/notices")).not.toContain(title);

    expect((await call(`/api/content/${id}/publish`, { method: "POST", cookie: cookies.admin })).status).toBeLessThan(300);
    expect((await publicTitles()).find((i) => i.title === title)).toMatchObject({ urgent: true });
    const notices = await pageCopy("/notices");
    expect(notices).toContain(title);
    expect(notices).toContain("Classes are closed on Friday.");

    expect((await call(`/api/content/${id}/unpublish`, { method: "POST", cookie: cookies.admin })).status).toBeLessThan(300);
    expect((await publicTitles()).map((i) => i.title)).not.toContain(title);
    expect(await pageCopy("/notices")).not.toContain(title);
  });

  it("a notice whose last day has passed, or that starts later, is not shown", async () => {
    const ended = `Ended ${crypto.randomUUID().slice(0, 6)}`;
    const later = `Later ${crypto.randomUUID().slice(0, 6)}`;
    for (const [title, publishOn, hideAfter] of [[ended, day(-10), day(-1)], [later, day(5), null]] as const) {
      const created = await call("/api/content", { method: "POST", cookie: cookies.admin, body: { kind: "notice", title, body: "Text.", publishOn, hideAfter } });
      expect(created.status, title).toBe(201);
      const id = ((await created.json()) as { id: string }).id;
      expect((await call(`/api/content/${id}/publish`, { method: "POST", cookie: cookies.admin })).status, title).toBeLessThan(300);
    }
    const copy = await pageCopy("/notices");
    expect(copy).not.toContain(ended);
    expect(copy).not.toContain(later);
  });

  it("only the Admin publishes to the website directly; a Student and a Teacher are refused outright; nobody signed out can", async () => {
    for (const role of ["student", "teacher"]) {
      expect((await call("/api/content", { method: "POST", cookie: cookies[role], body: { kind: "notice", title: "Not allowed", body: "x", publishOn: day(0) } })).status, role).toBe(403);
      expect((await call("/api/content", { cookie: cookies[role] })).status, role).toBe(403);
    }
    // A Co-ordinator may draft (D-061), but publishing directly stays the Admin's alone.
    const drafted = await call("/api/content", { method: "POST", cookie: cookies.coordinator, body: { kind: "notice", title: "Coordinator draft", body: "x", publishOn: day(0) } });
    expect(drafted.status).toBe(201);
    const draftId = ((await drafted.json()) as { id: string }).id;
    expect((await call(`/api/content/${draftId}/publish`, { method: "POST", cookie: cookies.coordinator })).status).toBe(403);

    expect((await call("/api/content", { method: "POST", body: { kind: "notice", title: "Not allowed", body: "x", publishOn: day(0) } })).status).toBe(401);
    expect((await call("/api/content")).status).toBe(401);
  });

  it("after all of that, the audit log is one unbroken chain", async () => {
    const result = await verifyAuditChain(db(), env.AUDIT_HMAC_KEY);
    expect(result).toMatchObject({ ok: true });
    expect((result as { count: number }).count).toBeGreaterThanOrEqual(6); // accounts, two publishes, two takedowns
  });
});
