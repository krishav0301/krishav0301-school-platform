import { formatBs, nepalMinute, type BsDate } from "../../core/dates";
import { listPublicContent } from "../content";
import { escapeHtml } from "./html";
import { textToHtml } from "./text-format";
import type { Builder, PageContext, PageParts } from "./page-types";
import { breadcrumb, home } from "./site-pages";
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

const notices: Builder = async (ctx) => {
  const { db, school, origin } = ctx;
  const { items } = await listPublicContent(db, nepalMinute(new Date()));

  const articles = items
    .map((item) => {
      const from = bsWords(item.publishedOnBs);
      // A holiday names its own days (D-094) and comes off the site after them, so its "until" would only repeat them.
      const holidayFrom = bsWords(item.holidayFromBs);
      const holidayTo = bsWords(item.holidayToBs);
      const holiday = holidayFrom ? (holidayTo && holidayTo !== holidayFrom ? say("content.holidayFromTo", { from: holidayFrom, to: holidayTo }) : say("content.holidayOn", { date: holidayFrom })) : "";
      const until = holiday ? null : bsWords(item.hideAfterBs);
      const dates = from ? (until ? say("notices.postedUntil", { from, until }) : say("notices.posted", { date: from })) : "";
      // Only the few marks of D-098 are drawn; every word is escaped (`text-format.ts`).
      const paragraphs = textToHtml(item.body);
      return (
        `<article><p>${e(say(`content.kind.${item.kind}` as StringKey))}${item.urgent ? ` · ${e(say("content.urgent"))}` : ""}</p>` +
        `<h2>${e(item.title)}</h2>` +
        (holiday ? `<p><strong>${e(holiday)}</strong></p>` : "") +
        paragraphs +
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
      breadcrumb(ctx, "notices.title"),
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

/**
 * The five old public pages (Programmes, Admission, Scholarships, Facilities, Contact), gone for every school (PM, 2026-10-18,
 * D-177). Their addresses stay in `run_worker_first` so an old link is sent to the front page instead of a missing page, as
 * a school with the one-page layout has always been (D-167). This list is read by `scripts/check-boundaries.mjs`.
 */
export const REMOVED_PAGES: ReadonlySet<string> = new Set(["/programmes", "/admission", "/scholarships", "/facilities", "/contact"]);

export const isRemovedPage = (pathname: string): boolean => REMOVED_PAGES.has(normalizePath(pathname));

/** How each page is introduced in `llms.txt`: its name and a line about it. Every filled page must be here (a test checks). */
const SUMMARIES: Record<string, (school: string) => { name: string; summary: string }> = {
  "/": (school) => ({ name: say("llms.home"), summary: say("llms.homeSummary", { school }) }),
  "/notices": (school) => ({ name: say("notices.title"), summary: say("notices.description", { school }) }),
};

/** A school with no one-page layout has only a sign-in page for a front page (D-177), and says so. */
const SIGN_IN_SUMMARY = (school: string) => ({ name: say("llms.home"), summary: say("llms.signInSummary", { school }) });

export const pageSummary = (path: string, school: string, layout: "classic" | "scroll" | "immersive" = "scroll"): { name: string; summary: string } =>
  normalizePath(path) === "/" && layout === "classic" ? SIGN_IN_SUMMARY(school) : SUMMARIES[normalizePath(path)]!(school);
export const pagesWithoutSummary = (): string[] => FILLED_PAGES.filter((path) => !(path in SUMMARIES));

/** `/notices/` is the same page as `/notices`; the home page is `/`. Anything else is not a page we fill. */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export const isFilledPage = (pathname: string): boolean => Object.hasOwn(PAGES, normalizePath(pathname));

export const builderFor = (pathname: string): Builder => PAGES[normalizePath(pathname)]!;
