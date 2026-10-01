import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FormattedText } from "@/content/FormattedText";
import { parseText, plainText } from "@/content/text-format";

import { parseText as workerParseText, textToHtml } from "../../api/src/modules/site/text-format";
import cases from "../../api/test/fixtures/text-format.json";

/** The app and the Worker read the same marks the same way (D-098): both are held to one fixture. */
describe("website text marks", () => {
  it.each(cases.map((c) => [c.input, c.blocks] as const))("reads %j as the shared fixture says", (input, blocks) => {
    expect(parseText(input)).toEqual(blocks);
  });

  it("agrees with the Worker's reader on text the fixture does not list", () => {
    const samples = ["**a** *b* __c__ [d](https://e.example)", "- x\n1. y\n## z", "a\n\n\n\nb", "[[x]](https://y.example)", "***x***", "__a__b__", "* not a list item? \n* yes"];
    for (const sample of samples) expect(parseText(sample), sample).toEqual(workerParseText(sample));
  });

  it("draws the same markup as the Worker's crawler copy, so the preview is the page", () => {
    const sample = "## Fees\nPay by **Friday**, see [the office](https://school.example/contact).\n\n- Science\n- Management\n\n1. One";
    const html = renderToStaticMarkup(<FormattedText body={sample} />).replace(/ class="[^"]*"/g, "").replace(/<h4>/g, "<h3>").replace(/<\/h4>/g, "</h3>").replace(/<br\/>/g, "<br>");
    expect(html).toBe(textToHtml(sample));
  });

  it("never turns typed markup into elements, and never links to a script", () => {
    const html = renderToStaticMarkup(<FormattedText body={'<img src=x onerror=alert(1)> [x](javascript:alert(1)) **<b>y</b>**'} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("javascript:alert(1)\"");
    expect(html).not.toContain("<a");
    expect(html).toContain("&lt;img");
  });

  it("gives the words alone for an excerpt", () => {
    expect(plainText("## Fees\nPay by **Friday**.\n\n- Science\n- Arts")).toBe("Fees Pay by Friday. Science · Arts");
  });
});
