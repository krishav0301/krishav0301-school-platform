import { describe, expect, it } from "vitest";

import { parseText, safeHref, textToHtml } from "../src/modules/site/text-format";
import cases from "./fixtures/text-format.json";

describe("website text marks (D-098)", () => {
  it.each(cases.map((c) => [c.input, c.blocks] as const))("reads %j as the shared fixture says", (input, blocks) => {
    // The web app checks its own reader against the same file, so the two cannot drift apart.
    expect(parseText(input)).toEqual(blocks);
  });

  it("draws only escaped words and its own tags", () => {
    expect(textToHtml('<script>alert(1)</script> & "q"')).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;</p>");
    expect(textToHtml("**<b>x</b>**")).toBe("<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>");
    expect(textToHtml("## Title\n- a\n- b\n\n1. c\n\nLine\nnext")).toBe("<h3>Title</h3><ul><li>a</li><li>b</li></ul><ol><li>c</li></ol><p>Line<br>next</p>");
  });

  it("links only to the web, email or a phone, and escapes the address", () => {
    expect(textToHtml("[a](https://x.example/?q=1&r=2)")).toBe('<p><a href="https://x.example/?q=1&amp;r=2" rel="nofollow noopener">a</a></p>');
    for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hi", "vbscript:x", "//evil.example", "/portal", "https://x\"onmouseover=\"y"]) {
      expect(safeHref(href)).toBeNull();
    }
    expect(textToHtml("[a](javascript:alert(1))")).not.toContain("<a");
  });
});
