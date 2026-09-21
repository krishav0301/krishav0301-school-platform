import { formatBs, nepalDate, type BsDate } from "../../core/dates";
import { listPublicContent } from "../content";
import { escapeHtml } from "./html";
import type { Builder, PageContext, PageParts } from "./page-types";
import { admission, contact, facilities, home, programmes, scholarships } from "./site-pages";
import { say, type StringKey } from "./strings";

export type { PageContext, PageParts };

const e = escapeHtml;

/** "2083-06-05" as "5 Ashwin 2083", or null when it is not a Nepali day the calendar knows. */
function bsWords(text: string | null): string | null {
  const match = text ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (!match) return null;
  const bs: BsDate = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  try {
    return formatBs(bs);
  } catch {
    return null;
  }
}

const notices: Builder = async ({ db, school, origin }) => {
  const { items } = await listPublicContent(db, nepalDate(new Date()));

  const articles = items
    .map((item) => {
      const from = bsWords(item.publishedOnBs);
      const until = bsWords(item.hideAfterBs);
      const dates = from ? (until ? say("notices.postedUntil", { from, until }) : say("notices.posted", { date: from })) : "";
      const paragraphs = item.body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${e(p)}</p>`)
        .join("");
      return (
        `<article><p>${e(say(`content.kind.${item.kind}` as StringKey))}${item.urgent ? ` · ${e(say("content.urgent"))}` : ""}</p>` +
        `<h2>${e(item.title)}</h2>${paragraphs}` +
        (item.kind === "vacancy" && item.contact ? `<p>${e(say("content.contact"))} ${e(item.contact)}</p>` : "") +
        (dates ? `<p>${e(dates)}</p>` : "") +
        `</article>`
      );
    })
    .join("");

  return {
    title: `${say("notices.title")} | ${school.name}`,
    description: say("notices.description", { school: school.name }),
    structuredData: [
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: say("notices.title"),
        url: `${origin}/notices`,
        itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.title })),
      },
    ],
    bodyHtml: `<h1>${e(say("notices.title"))}</h1><p>${e(say("notices.intro"))}</p>${items.length > 0 ? articles : `<p>${e(say("notices.empty"))}</p>`}`,
  };
};

/** The pages the Worker fills in. Every address here must also be in `run_worker_first` in wrangler.jsonc (a CI check compares them). */
const PAGES: Record<string, Builder> = {
  "/": home,
  "/notices": notices,
  "/programmes": programmes,
  "/admission": admission,
  "/scholarships": scholarships,
  "/facilities": facilities,
  "/contact": contact,
};

export const FILLED_PAGES: readonly string[] = Object.keys(PAGES);

/** How each page is introduced in `llms.txt`: its name and a line about it. Every filled page must be here (a test checks). */
const SUMMARIES: Record<string, (school: string) => { name: string; summary: string }> = {
  "/": (school) => ({ name: say("llms.home"), summary: say("llms.homeSummary", { school }) }),
  "/notices": (school) => ({ name: say("notices.title"), summary: say("notices.description", { school }) }),
  "/programmes": (school) => ({ name: say("site.programmes.title"), summary: say("site.programmes.description", { school }) }),
  "/admission": (school) => ({ name: say("site.admission.title"), summary: say("site.admission.description", { school }) }),
  "/scholarships": (school) => ({ name: say("site.scholarships.title"), summary: say("site.scholarships.description", { school }) }),
  "/facilities": (school) => ({ name: say("site.facilities.title"), summary: say("site.facilities.description", { school }) }),
  "/contact": (school) => ({ name: say("site.contact.title"), summary: say("site.contact.description", { school }) }),
};

export const pageSummary = (path: string, school: string): { name: string; summary: string } => SUMMARIES[normalizePath(path)]!(school);
export const pagesWithoutSummary = (): string[] => FILLED_PAGES.filter((path) => !(path in SUMMARIES));

/** `/notices/` is the same page as `/notices`; the home page is `/`. Anything else is not a page we fill. */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export const isFilledPage = (pathname: string): boolean => Object.hasOwn(PAGES, normalizePath(pathname));

export const builderFor = (pathname: string): Builder => PAGES[normalizePath(pathname)]!;
