import type { SiteContent } from "../../core/config";

/** What a page builder is given. Nothing here is trusted as markup: every value is escaped where it is written. */
export interface PageContext {
  db: D1Database;
  school: { name: string; shortName: string };
  sections: { key: string; name: string }[];
  origin: string;
  path: string;
  /** The words of the fixed pages, read from the database the first time it is called. Null before the school has them. */
  site: () => Promise<SiteContent | null>;
}

/** What a page adds to its static shell. */
export interface PageParts {
  title: string;
  description: string;
  /** Structured data blocks, besides the organisation every page gets. */
  structuredData: Record<string, unknown>[];
  /** More to say about the organisation itself (its address, phones, description), merged into the block every page carries. */
  organisation?: Record<string, unknown>;
  /** The plain HTML for the top of the body. Built only from escaped values. */
  bodyHtml: string;
}

/** Returns null when there is nothing true to say yet: the static page is then served untouched. */
export type Builder = (ctx: PageContext) => Promise<PageParts | null>;
