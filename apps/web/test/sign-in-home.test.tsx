import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignInHome } from "@/site/SignInHome";

/**
 * The front page of a school that has no one-page layout (PM, 2026-10-18, D-177): the old public pages are gone, and what
 * is left is one Sign in button in the middle of an empty page. Nothing else: no menu, header, footer, band or words.
 */
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("the sign-in front", () => {
  const html = renderToStaticMarkup(<SignInHome schoolName="Royal Softech College" signedIn={false} />);

  it("is one Sign in button, linking to the sign-in page", () => {
    expect(count(html, /<a /g)).toBe(1);
    expect(count(html, /<button/g)).toBe(0);
    expect(html).toMatch(/<a[^>]*href="\/sign-in"[^>]*>Sign in<\/a>/);
    expect(count(html, /class="button primary/g)).toBe(1);
  });

  it("has nothing else: no header, footer, menu, band, skeleton or other page", () => {
    for (const word of ["<header", "<footer", "<nav", "<img", "skeleton", "/programmes", "/admission", "/notices", "/contact"]) expect(html).not.toContain(word);
  });

  it("names the school only to a screen reader, as its one heading", () => {
    expect(count(html, /<h1/g)).toBe(1);
    expect(html).toMatch(/<h1[^>]*class="sr-only"[^>]*>Royal Softech College<\/h1>/);
  });

  it("lets the label wrap, so enlarged text cannot widen the page at 320px (D-030)", () => {
    expect(html).toMatch(/<a[^>]*class="button primary[^"]*wrapLabel[^"]*"|<a[^>]*class="[^"]*wrapLabel[^"]*button primary/);
  });

  it("sends someone already signed in to the portal instead, with its own word", () => {
    const signedIn = renderToStaticMarkup(<SignInHome schoolName="Royal Softech College" signedIn />);
    expect(signedIn).toMatch(/<a[^>]*href="\/portal"[^>]*>Portal<\/a>/);
    expect(signedIn).not.toContain("/sign-in");
  });

  it("works before the school's name is known, with no heading to fill", () => {
    const early = renderToStaticMarkup(<SignInHome signedIn={false} />);
    expect(early).toContain("Sign in");
    expect(count(early, /<h1/g)).toBe(0);
  });

  it("carries no colour of its own", () => {
    expect(html.replace(/href="[^"]*"/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/style="[^"]*(?:color|background)\s*:/);
  });
});
