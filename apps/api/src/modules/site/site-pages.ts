import type { SiteContent } from "../../core/config";
import { escapeHtml } from "./html";
import type { Builder, PageContext } from "./page-types";
import { say } from "./strings";

/** The crawler copy of the six fixed pages (D-046). Every value from the pack is escaped where it is written. */
const e = escapeHtml;
type Key = Parameters<typeof say>[0];
type Programme = SiteContent["programmes"][number];

const LINKS: [string, Key][] = [
  ["/programmes", "site.programmes.title"],
  ["/admission", "site.admission.title"],
  ["/scholarships", "site.scholarships.title"],
  ["/facilities", "site.facilities.title"],
  ["/contact", "site.contact.title"],
  ["/notices", "notices.title"],
];
const nav = (): string => `<nav>${LINKS.map(([href, key]) => `<a href="${href}">${e(say(key))}</a>`).join(" ")}</nav>`;

const titled = (ctx: PageContext, title: Key, description: Key) => ({
  title: `${say(title)} | ${ctx.school.name}`,
  description: say(description, { school: ctx.school.name }),
});

const LD = "https://schema.org";

/** The programmes under each section's name, in the section's order. One whose section is unknown goes last, with no heading. */
export function groupProgrammes(sections: { key: string; name: string }[], programmes: Programme[]): { name: string | null; items: Programme[] }[] {
  const groups = sections.map((s) => ({ name: s.name as string | null, items: programmes.filter((p) => p.section === s.key) })).filter((g) => g.items.length > 0);
  const known = new Set(sections.map((s) => s.key));
  const rest = programmes.filter((p) => !known.has(p.section));
  return rest.length > 0 ? [...groups, { name: null, items: rest }] : groups;
}

const facts = (p: Programme): string =>
  `<p>${e(say("site.affiliation"))}: ${e(p.affiliation)}. ${e(say("site.duration"))}: ${e(p.duration)}.</p>` +
  (p.options.length > 0 ? `<p>${e(say("site.options"))}: ${e(p.options.join(", "))}.</p>` : "");

export const home: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const groups = groupProgrammes(ctx.sections, site.programmes);
  return {
    title: ctx.school.name,
    description: site.home.summary,
    structuredData: [],
    bodyHtml:
      `<h1>${e(site.home.headline)}</h1><p>${e(site.home.summary)}</p>` +
      `<p><a href="/admission">${e(say("site.home.apply"))}</a> <a href="/notices">${e(say("home.notices"))}</a></p>` +
      `<h2>${e(say("site.programmes.title"))}</h2>` +
      groups
        .map((g) => (g.name ? `<h3>${e(g.name)}</h3>` : "") + `<ul>${g.items.map((p) => `<li><a href="/programmes#${e(p.key)}">${e(p.name)}</a>: ${e(p.affiliation)}, ${e(p.duration)}</li>`).join("")}</ul>`)
        .join("") +
      `<p><a href="/programmes">${e(say("site.home.seeProgrammes"))}</a></p>` +
      `<h2>${e(say("site.home.apply"))}</h2><ol>${site.admission.steps.map((s) => `<li>${e(s.title)}</li>`).join("")}</ol>` +
      `<p><a href="/admission">${e(say("site.home.seeAdmission"))}</a></p>` +
      `<h2>${e(say("site.contact.title"))}</h2><p>${e(site.contact.address)}</p><p>${e(say("site.phone"))}: ${e(site.contact.phones[0]!)}</p>` +
      `<p><a href="/contact">${e(say("site.home.seeContact"))}</a></p>` +
      nav(),
  };
};

export const programmes: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const groups = groupProgrammes(ctx.sections, site.programmes);
  return {
    ...titled(ctx, "site.programmes.title", "site.programmes.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "ItemList",
        name: say("site.programmes.title"),
        url: `${ctx.origin}/programmes`,
        itemListElement: site.programmes.map((p, index) => ({ "@type": "ListItem", position: index + 1, name: p.name, url: `${ctx.origin}/programmes#${p.key}` })),
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.programmes.title"))}</h1>` +
      groups
        .map((g) => (g.name ? `<h2>${e(g.name)}</h2>` : "") + g.items.map((p) => `<article id="${e(p.key)}"><h3>${e(p.name)}</h3><p>${e(p.summary)}</p>${facts(p)}</article>`).join(""))
        .join("") +
      nav(),
  };
};

export const admission: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const { intro, steps } = site.admission;
  return {
    ...titled(ctx, "site.admission.title", "site.admission.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "HowTo",
        name: say("site.admission.howTo", { school: ctx.school.name }),
        step: steps.map((s, index) => ({ "@type": "HowToStep", position: index + 1, name: s.title, text: s.body })),
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.admission.title"))}</h1><p>${e(intro)}</p>` +
      `<ol>${steps.map((s) => `<li><h2>${e(s.title)}</h2><p>${e(s.body)}</p></li>`).join("")}</ol>` +
      nav(),
  };
};

export const scholarships: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const { intro, items } = site.scholarships;
  return {
    ...titled(ctx, "site.scholarships.title", "site.scholarships.description"),
    structuredData: [],
    bodyHtml:
      `<h1>${e(say("site.scholarships.title"))}</h1><p>${e(intro)}</p>` +
      `<ul>${items.map((i) => `<li><h2>${e(i.title)}</h2><p>${e(i.body)}</p></li>`).join("")}</ul>` +
      nav(),
  };
};

export const facilities: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const { intro, items } = site.facilities;
  return {
    ...titled(ctx, "site.facilities.title", "site.facilities.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "ItemList",
        name: say("site.facilities.title"),
        url: `${ctx.origin}/facilities`,
        itemListElement: items.map((i, index) => ({ "@type": "ListItem", position: index + 1, name: i.name })),
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.facilities.title"))}</h1><p>${e(intro)}</p>` +
      `<ul>${items.map((i) => `<li>${e(i.name)}${i.body ? `: ${e(i.body)}` : ""}</li>`).join("")}</ul>` +
      nav(),
  };
};

export const contact: Builder = async (ctx) => {
  const site = await ctx.site();
  if (!site) return null;
  const c = site.contact;
  return {
    ...titled(ctx, "site.contact.title", "site.contact.description"),
    structuredData: [
      {
        "@context": LD,
        "@type": "ContactPage",
        name: say("site.contact.title"),
        url: `${ctx.origin}/contact`,
        mainEntity: {
          "@type": "EducationalOrganization",
          name: ctx.school.name,
          url: ctx.origin,
          address: { "@type": "PostalAddress", streetAddress: c.address },
          telephone: c.phones,
          ...(c.email ? { email: c.email } : {}),
        },
      },
    ],
    bodyHtml:
      `<h1>${e(say("site.contact.title"))}</h1>` +
      `<p>${e(say("site.address"))}: ${e(c.address)}</p>` +
      `<p>${e(say("site.phone"))}: ${e(c.phones.join(", "))}</p>` +
      (c.email ? `<p>${e(say("site.email"))}: ${e(c.email)}</p>` : "") +
      (c.hours ? `<p>${e(say("site.hours"))}: ${e(c.hours)}</p>` : "") +
      nav(),
  };
};
