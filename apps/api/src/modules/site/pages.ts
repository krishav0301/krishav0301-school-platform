import { formatBs, nepalDate, type BsDate } from "../../core/dates";
import { listPublicContent } from "../content";
import { escapeHtml } from "./html";
import { say, type StringKey } from "./strings";

/** What a page builder is given. Nothing here is trusted as markup: every value is escaped where it is written. */
export interface PageContext {
  db: D1Database;
  school: { name: string; shortName: string };
  sections: { key: string; name: string }[];
  origin: string;
  path: string;
}

/** What a page adds to its static shell. */
export interface PageParts {
  title: string;
  description: string;
  /** Structured data blocks, besides the organisation every page gets. */
  structuredData: Record<string, unknown>[];
  /** The plain HTML for the top of the body. Built only from escaped values. */
  bodyHtml: string;
}

type Builder = (ctx: PageContext) => Promise<PageParts>;

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

const home: Builder = async ({ school, sections }) => ({
  title: school.name,
  description: sections.length > 0 ? `${school.name}: ${sections.map((s) => s.name).join(", ")}.` : `${school.name}.`,
  structuredData: [],
  bodyHtml:
    `<h1>${e(say("home.welcome", { school: school.name }))}</h1>` +
    (sections.length > 0 ? `<ul>${sections.map((s) => `<li>${e(s.name)}</li>`).join("")}</ul>` : "") +
    `<nav><a href="/notices">${e(say("home.notices"))}</a> <a href="/sign-in">${e(say("shell.signIn"))}</a></nav>`,
});

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
};

export const FILLED_PAGES: readonly string[] = Object.keys(PAGES);

/** `/notices/` is the same page as `/notices`; the home page is `/`. Anything else is not a page we fill. */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export const isFilledPage = (pathname: string): boolean => Object.hasOwn(PAGES, normalizePath(pathname));

export const builderFor = (pathname: string): Builder => PAGES[normalizePath(pathname)]!;
