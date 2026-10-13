import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PublicItem } from "@/content/model";
import { NoticeBoardView, openIdFromSearch, pickOpen } from "@/site/scroll/NoticeBoard";
import { NoticeReader } from "@/site/scroll/NoticeReader";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const id = (c: string) => c.repeat(32);
const item = (over: Partial<PublicItem>): PublicItem => ({
  id: id("a"),
  kind: "notice",
  title: "Exam routine for the final term",
  body: "The final term exams start on Sunday.\n\nBring your admit card.",
  contact: null,
  urgent: false,
  publishedOn: "2026-10-10",
  hideAfter: null,
  publishedOnBs: "2083-06-24",
  hideAfterBs: null,
  holidayFrom: null,
  holidayTo: null,
  holidayFromBs: null,
  holidayToBs: null,
  ...over,
});
const items = [
  item({ id: id("b"), kind: "notice", title: "Urgent: school closed tomorrow", urgent: true, body: "SECRET-BODY-ONE" }),
  item({ id: id("a") }),
  item({ id: id("c"), kind: "holiday", title: "Dashain holiday", holidayFromBs: "2083-06-30", holidayToBs: "2083-07-05", body: "SECRET-BODY-TWO" }),
];
const noop = () => {};

describe("the notice board on the scroll page", () => {
  const html = renderToStaticMarkup(<NoticeBoardView status="ready" items={items} openId={null} onOpen={noop} onClose={noop} onRetry={noop} />);

  it("lists the titles in the order the API sends them, each with its kind and its Nepali date", () => {
    expect(html.indexOf("Urgent: school closed tomorrow")).toBeLessThan(html.indexOf("Exam routine"));
    expect(html.indexOf("Exam routine")).toBeLessThan(html.indexOf("Dashain holiday"));
    expect(html).toContain("Notice");
    expect(html).toContain("Holiday");
    expect(html).toMatch(/\d{1,2} [A-Z][a-z]+ 2083/);
  });

  it("shows titles only: the text of a notice is read in the reader", () => {
    expect(html).not.toContain("SECRET-BODY-ONE");
    expect(html).not.toContain("Bring your admit card");
  });

  it("makes each title a button that opens that notice", () => {
    expect(html.match(/<button[^>]*type="button"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Exam routine for the final term/);
  });

  it("marks an urgent notice as urgent", () => {
    expect(html).toContain("Urgent");
  });

  it("links on to every notice", () => {
    expect(html).toMatch(/href="\/notices"/);
  });

  it("says so when there is nothing to show, offers a retry when the load failed, and shows its shape while loading", () => {
    const state = (status: "loading" | "failed" | "ready", list: PublicItem[] = []) => renderToStaticMarkup(<NoticeBoardView status={status} items={list} openId={null} onOpen={noop} onClose={noop} onRetry={noop} />);
    expect(state("ready")).toContain("Nothing to show right now");
    expect(state("failed")).toContain("Try again");
    expect(state("loading")).toContain('aria-busy="true"');
  });

  it("draws the reader only for the notice that is open", () => {
    const open = renderToStaticMarkup(<NoticeBoardView status="ready" items={items} openId={id("a")} onOpen={noop} onClose={noop} onRetry={noop} />);
    expect(open).toContain("Bring your admit card");
    expect(open).not.toContain("SECRET-BODY-TWO");
  });
});

describe("the reader", () => {
  const reader = renderToStaticMarkup(<NoticeReader item={items[2]!} onClose={noop} />);

  it("shows the whole notice: its kind, title, text, the holiday's days and its date", () => {
    expect(reader).toContain("Dashain holiday");
    expect(reader).toContain("SECRET-BODY-TWO");
    expect(reader).toMatch(/2083/);
  });

  it("is a dialog named by the notice's title, with a Close button", () => {
    expect(reader).toMatch(/<dialog[^>]*aria-label="Dashain holiday"/);
    expect(reader).toMatch(/aria-label="Close"/);
  });
});

describe("opening a notice by its address", () => {
  it("reads ?notice=<id> and ignores anything that is not a 32-character id", () => {
    expect(openIdFromSearch(`?notice=${id("a")}`)).toBe(id("a"));
    expect(openIdFromSearch("?notice=../etc/passwd")).toBeNull();
    expect(openIdFromSearch("?notice=" + "A".repeat(32))).toBeNull();
    expect(openIdFromSearch("?other=1")).toBeNull();
    expect(openIdFromSearch("")).toBeNull();
  });

  it("opens nothing for a notice that is not on the board any more, or never was", () => {
    expect(pickOpen(items, id("f"))).toBeNull();
    expect(pickOpen(items, null)).toBeNull();
    expect(pickOpen(items, id("c"))!.title).toBe("Dashain holiday");
  });
});

describe("a long title", () => {
  it("wraps instead of widening the page", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "src", "site", "scroll", "scroll.module.css"), "utf8");
    expect(css).toMatch(/\.noticeTitle\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.noticeRow\s*\{[^}]*min-height:\s*var\(--control-height\)/);
  });
});
