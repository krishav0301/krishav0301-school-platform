import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/i18n/messages";
import { ReadHeader } from "@/read/ReadView";
import { HeroBand, Illustration } from "@/ui";
import { ART_CODES, ART_READY, OVERVIEW_ART, SLOGANS, artForPath } from "@/ui/art";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/people/teaching", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** D-126: every page's hero has a picture's place, labelled with the code of its prompt in docs/illustrations.md. */
describe("which picture a page shows", () => {
  it("the longest matching address wins, so Teaching is not taken for People", () => {
    expect(artForPath("/portal/people/teaching")).toBe("P5");
    expect(artForPath("/portal/people")).toBe("P13");
    expect(artForPath("/portal/setup/teaching")).toBe("P5");
    expect(artForPath("/portal/setup/subjects")).toBe("P14");
    expect(artForPath("/portal/fees/student/")).toBe("P10");
  });

  it("the public home and pages have their own; the overview chooses by role, so its address gives none", () => {
    expect(artForPath("/")).toBe("W1");
    expect(artForPath("/sign-in")).toBe("W9");
    expect(artForPath("/privacy")).toBe("W11");
    expect(artForPath("/portal")).toBeNull();
    expect(artForPath("/portal/more")).toBeNull();
    expect(artForPath(null)).toBeNull();
  });

  it("does not match a page whose address merely starts with the same letters", () => {
    expect(artForPath("/admissionsx")).toBeNull();
    expect(artForPath("/portal/feesx")).toBeNull();
  });

  it("each role's overview has its own picture", () => {
    expect(new Set(Object.values(OVERVIEW_ART)).size).toBe(Object.keys(OVERVIEW_ART).length);
  });

  it("every slogan is in the catalog", () => {
    for (const key of Object.values(SLOGANS)) expect(t(key!)).not.toBe(key);
  });

  it("every code has its prompt in docs/illustrations.md, and the document names no code that does not exist", () => {
    const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "illustrations.md"), "utf8");
    const listed = new Set([...doc.matchAll(/^\| \*\*([A-Z]\d+)\*\* \|/gm)].map((m) => m[1]));
    expect([...listed].sort()).toEqual([...ART_CODES].sort());
  });
});

describe("a picture's place", () => {
  it("until its picture is added it is a box showing its code, hidden from screen readers", () => {
    expect(ART_READY.has("W2")).toBe(false);
    const html = renderToStaticMarkup(<Illustration code="W2" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">W2<");
    expect(html).not.toContain("<img");
  });

  it("the hero band keeps the page's own heading and adds the address's picture and its line", () => {
    const html = renderToStaticMarkup(
      <HeroBand>
        <h1>Teaching</h1>
      </HeroBand>,
    );
    expect(html).toContain("<h1>Teaching</h1>");
    expect(html).toContain("/illustrations/P5.webp");
    expect(html).toContain(t("art.slogan.P5"));
  });

  it("a page can choose its picture, or none", () => {
    expect(renderToStaticMarkup(<HeroBand art="P2">x</HeroBand>)).toContain("/illustrations/P2.webp");
    const none = renderToStaticMarkup(<HeroBand art={null}>x</HeroBand>);
    expect(none).not.toContain("aria-hidden");
  });
});

/** D-128, the PM: the band at the top of a page holds words only; its buttons sit just below it. */
describe("the band holds no controls", () => {
  const src = join(import.meta.dirname, "..", "src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith(".tsx") ? [join(dir, n)] : []));
  const CONTROL = /<Button\b|<button\b|buttonClass\(|<AddDialog\b|<ChangeDate\b|<select\b|<input\b|<Select\b|<Field\b|<RowMenu\b/;

  it("no page puts a button, picker or field inside a <HeroBand>", () => {
    const offenders: string[] = [];
    for (const file of files(src)) {
      for (const [, inside] of readFileSync(file, "utf8").matchAll(/<HeroBand\b[^>]*>([\s\S]*?)<\/HeroBand>/g)) {
        if (CONTROL.test(inside!)) offenders.push(file.slice(src.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a page header's actions come after its band, in their own row, not inside it", () => {
    const html = renderToStaticMarkup(<ReadHeader title="Teaching" actions={<button type="button">Change date</button>} />);
    expect(html.indexOf("/illustrations/P5.webp")).toBeLessThan(html.indexOf("<button")); // the band, with its picture, comes first
    expect(html).toMatch(/headerActions[^"]*"><button/); // and the action is in the row after it
  });});

/** Every picture marked ready is a real file within the page-weight budget (docs/illustrations.md). */
describe("the added pictures", () => {
  const dir = join(import.meta.dirname, "..", "public", "illustrations");
  it("each code in ART_READY has its .webp file, at most 80 KB", () => {
    for (const code of ART_READY) {
      const size = statSync(join(dir, `${code}.webp`)).size;
      expect(size, code).toBeGreaterThan(0);
      expect(size, code).toBeLessThanOrEqual(80_000);
    }
  });
  it("no file sits in the folder without being marked ready", () => {
    const names = readdirSync(dir).map((n) => n.replace(/\.webp$/, ""));
    expect(names.sort()).toEqual([...ART_READY].sort());
  });
});

describe("the small pictures in their places", () => {
  it("an approvals inbox with nothing waiting shows E3; a filtered one keeps its icon", async () => {
    const { ApprovalsList } = await import("@/approvals/InboxScreen");
    expect(renderToStaticMarkup(<ApprovalsList requests={[]} filtered={false} onReview={() => {}} />)).toContain("/illustrations/E3.webp");
    expect(renderToStaticMarkup(<ApprovalsList requests={[]} filtered onReview={() => {}} />)).not.toContain("/illustrations/E3.webp");
  });

  it("the page-not-found screen shows X1, its words and a way home", async () => {
    const { default: NotFound } = await import("@/app/not-found");
    expect(NotFound).toBeTypeOf("function");
    const src = readFileSync(join(import.meta.dirname, "..", "src", "app", "not-found.tsx"), "utf8");
    expect(src).toContain('code="X1"');
    expect(src).toContain('href="/"');
  });
});
