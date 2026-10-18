import type { SiteContent } from "../../core/config";
import { nepalMinute } from "../../core/dates";
import { listPublicContent } from "../content";
import { escapeHtml } from "./html";
import type { Builder, PageContext, PageParts } from "./page-types";
import { say } from "./strings";

/** The crawler copy of the front page (D-046). Every value from the pack is escaped where it is written. */
const e = escapeHtml;
type Key = Parameters<typeof say>[0];

const LD = "https://schema.org";

/** Every page's organisation block has this @id (see `render.ts`), so other blocks can refer to it. */
const orgId = (origin: string): string => `${origin}/#organization`;

/** What Home and Contact add to the organisation block: only what the pack says. An email appears only if there is one. */
const orgDetails = (site: SiteContent): Record<string, unknown> => ({
  description: site.home.summary,
  address: { "@type": "PostalAddress", streetAddress: site.contact.address },
  telephone: site.contact.phones,
  ...(site.contact.email ? { email: site.contact.email } : {}),
});

/** The way down from the school's front page to this one: two steps. */
export const breadcrumb = (ctx: PageContext, title: Key): Record<string, unknown> => ({
  "@context": LD,
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: ctx.school.name, item: `${ctx.origin}/` },
    { "@type": "ListItem", position: 2, name: say(title), item: `${ctx.origin}${ctx.path}` },
  ],
});

/** The crawler copy of a scroll school's one page (D-167): its name, address, phone, intro, classes, live notices and about. */
async function scrollHome(ctx: PageContext, site: SiteContent): Promise<PageParts> {
  const { items } = await listPublicContent(ctx.db, nepalMinute(new Date()));
  const s = site.scroll!;
  return {
    title: ctx.school.name,
    description: s.intro.slice(0, 160),
    structuredData: [{ "@context": LD, "@type": "WebSite", "@id": `${ctx.origin}/#website`, name: ctx.school.name, url: ctx.origin, publisher: { "@id": orgId(ctx.origin) } }],
    organisation: { ...orgDetails(site), description: s.intro, ...(s.about.facebook ? { sameAs: [s.about.facebook] } : {}) },
    bodyHtml:
      `<h1>${e(ctx.school.name)}</h1><p>${e(site.contact.address)}</p><p>${e(say("site.phone"))}: ${e(site.contact.phones[0]!)}</p>${s.hero.tagline ? `<p>${e(s.hero.tagline)}</p>` : ""}${s.quote ? `<p>${e(s.quote.replace(/\s*\n\s*/g, ". "))}</p>` : ""}<p>${e(s.intro)}</p>` +
      `<h2>${e(say("site.scroll.school"))}</h2>${s.cardsIntro ? `<p>${e(s.cardsIntro)}</p>` : ""}<ul>${s.cards.map((c) => `<li>${e(c.title)}: ${e(c.text)}</li>`).join("")}</ul>` +
      `<h2>${e(say("site.scroll.notices"))}</h2>${items.length > 0 ? `<ul>${items.map((i) => `<li>${e(i.title)}</li>`).join("")}</ul>` : ""}<p><a href="/notices">${e(say("notices.title"))}</a></p>` +
      (s.about.story ? `<h2>${e(say("site.scroll.about"))}</h2><p>${e(s.about.story)}</p>` : "") +
      (s.about.facebook ? `<p><a href="${e(s.about.facebook)}" rel="noopener">${e(say("site.scroll.facebook"))}</a></p>` : ""),
  };
}

/** The accent marks of a heading are for the page's look; the copy for crawlers reads the plain words. */
const plainHeading = (heading: string): string => heading.replaceAll("*", "");

/** The crawler copy of an immersive school's one page (D-178): headline, programmes, facilities, reasons, live notices, admission steps and contact. */
async function immersiveHome(ctx: PageContext, site: SiteContent): Promise<PageParts> {
  const { items } = await listPublicContent(ctx.db, nepalMinute(new Date()));
  const w = site.immersive!;
  const streams = site.programmes.flatMap((p) => (p.options.length > 0 ? p.options : [p.name]));
  return {
    title: ctx.school.name,
    description: w.hero.tagline.slice(0, 160),
    structuredData: [{ "@context": LD, "@type": "WebSite", "@id": `${ctx.origin}/#website`, name: ctx.school.name, url: ctx.origin, publisher: { "@id": orgId(ctx.origin) } }],
    organisation: { ...orgDetails(site), description: w.hero.tagline },
    bodyHtml:
      `<h1>${e(plainHeading(w.hero.headline))}</h1><p>${e(w.hero.tagline)}</p>` +
      `<p><a href="/sign-in">${e(say("shell.signIn"))}</a></p>` +
      `<h2>${e(plainHeading(w.areas.heading))}</h2><p>${e(w.areas.intro)}</p><ul>${streams.map((name) => `<li>${e(name)}</li>`).join("")}</ul>` +
      `<h2>${e(plainHeading(w.programmes.heading))}</h2><p>${e(w.programmes.intro)}</p>` +
      site.programmes
        .map((p) => `<article><h3>${e(p.name)}</h3><p>${e(p.summary)}</p><p>${e(p.affiliation)}. ${e(p.duration)}.</p>${p.options.length > 0 ? `<p>${e(p.options.join(", "))}</p>` : ""}</article>`)
        .join("") +
      `<h2>${e(say("site.immersive.scholarships"))}</h2><p>${e(site.scholarships.intro)}</p><ul>${site.scholarships.items.map((i) => `<li>${e(i.title)}: ${e(i.body)}</li>`).join("")}</ul>` +
      `<h2>${e(plainHeading(w.facilities.heading))}</h2><p>${e(site.facilities.intro)}</p><ul>${site.facilities.items.map((i) => `<li>${e(i.name)}${i.body ? `: ${e(i.body)}` : ""}</li>`).join("")}</ul>` +
      `<h2>${e(plainHeading(w.why.heading))}</h2>${w.why.intro ? `<p>${e(w.why.intro)}</p>` : ""}<ul>${w.why.items.map((i) => `<li>${e(i.title)}: ${e(i.text)}</li>`).join("")}</ul>` +
      `<h2>${e(say("site.scroll.notices"))}</h2>${items.length > 0 ? `<ul>${items.map((i) => `<li>${e(i.title)}</li>`).join("")}</ul>` : ""}<p><a href="/notices">${e(say("notices.title"))}</a></p>` +
      `<h2>${e(say("site.immersive.apply"))}</h2><p>${e(site.admission.intro)}</p><ol>${site.admission.steps.map((step) => `<li>${e(step.title)}</li>`).join("")}</ol>` +
      `<h2>${e(say("llms.contact"))}</h2><p>${e(site.contact.address)}</p><p>${e(say("site.phone"))}: ${e(site.contact.phones.join(", "))}</p>` +
      (site.contact.email ? `<p>${e(say("site.email"))}: ${e(site.contact.email)}</p>` : "") +
      (site.contact.hours ? `<p>${e(say("site.hours"))}: ${e(site.contact.hours)}</p>` : ""),
  };
}

/**
 * The front page's crawler copy. A school with a one-page layout gets that page's words (D-167, D-178); every other school has only a
 * Sign in button for a front page (PM, 2026-10-18, D-177), so its copy is its name and a link to sign in.
 */
export const home: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  if (site.layout === "scroll" && site.scroll) return scrollHome(ctx, site);
  if (site.layout === "immersive" && site.immersive) return immersiveHome(ctx, site);
  return {
    title: ctx.school.name,
    description: say("site.signIn.description", { school: ctx.school.name }),
    structuredData: [{ "@context": LD, "@type": "WebSite", "@id": `${ctx.origin}/#website`, name: ctx.school.name, url: ctx.origin, publisher: { "@id": orgId(ctx.origin) } }],
    organisation: orgDetails(site),
    bodyHtml: `<h1>${e(ctx.school.name)}</h1><p><a href="/sign-in">${e(say("shell.signIn"))}</a></p>`,
  };
};
