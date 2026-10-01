import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AddDialog, TitleRow } from "@/ui";

/** "Add" at the top of a list, opening its form in a pop-up (the PM, 2026-10-01; D-090). */
describe("the Add pop-up", () => {
  const html = renderToStaticMarkup(
    <TitleRow>
      <h1>Staff</h1>
      <AddDialog label="Add a person" title="Add a person">
        {() => <form aria-label="the form">fields</form>}
      </AddDialog>
    </TitleRow>,
  );

  it("puts the Add button beside the page title, before the list", () => {
    expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf("Add a person"));
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Add a person<\/button>/);
  });

  it("is a real dialog, named by its title, closed until asked for, with a labelled close button", () => {
    const id = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<h2 id="${id}"`);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toMatch(/<button[^>]*aria-label="Close"/);
    expect(html).toContain('aria-label="the form"');
  });
});
