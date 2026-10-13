import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AboutBlock } from "@/site/scroll/AboutBlock";
import { AdmissionBlockView } from "@/site/scroll/AdmissionBlock";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const PHONE = "+977 33-564346";
const form = <form>THE-FORM</form>;
const admission = (state: "loading" | "open" | "closed") => renderToStaticMarkup(<AdmissionBlockView state={state} phone={PHONE} form={form} />);

describe("the admission block", () => {
  it("shows the form when a class is open for admission", () => {
    const html = admission("open");
    expect(html).toContain("THE-FORM");
    expect(html).toContain("Apply for admission");
    expect(html).not.toContain("not open online");
  });

  it("shows the office's phone number, not a form, when no class is open or the classes could not be loaded", () => {
    const html = admission("closed");
    expect(html).not.toContain("THE-FORM");
    expect(html).toContain("Admissions are not open online right now");
    expect(html).toContain('href="tel:+97733564346"');
  });

  it("shows the shape of the form while it loads", () => {
    const html = admission("loading");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("THE-FORM");
  });

  it("has one h2, and the fallback is not a second prominent button", () => {
    expect((admission("closed").match(/<h2/g) ?? []).length).toBe(1);
    expect(admission("closed")).not.toContain("button primary");
  });
});

describe("the about block", () => {
  const about = { story: "A story about the school.", facebook: "https://www.facebook.com/profile.php?id=100090093189751", mapQuery: "Lahan-8, Road No - 2, Lahan, Siraha" };
  const html = renderToStaticMarkup(<AboutBlock address="Lahan-8, Road No - 2" phones={[PHONE, "+977 33-000000"]} about={about} />);

  it("shows the address, every phone as a link, and the story", () => {
    expect(html).toContain("Lahan-8, Road No - 2");
    expect(html).toContain('href="tel:+97733564346"');
    expect(html).toContain('href="tel:+97733000000"');
    expect(html).toContain("A story about the school.");
  });

  it("opens the Facebook page and the map in a new tab, safely", () => {
    expect(html).toContain('href="https://www.facebook.com/profile.php?id=100090093189751"');
    expect((html.match(/rel="noopener noreferrer"/g) ?? []).length).toBe(2);
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=Lahan-8%2C%20Road%20No%20-%202%2C%20Lahan%2C%20Siraha"');
  });

  it("embeds nothing from anywhere else", () => {
    expect(html).not.toMatch(/<iframe|<script/);
  });

  it("shows only what exists", () => {
    const bare = renderToStaticMarkup(<AboutBlock address="Here" phones={[]} about={{}} />);
    expect(bare).toContain("Here");
    expect(bare).not.toContain("facebook");
    expect(bare).not.toContain("maps");
    expect(bare).not.toContain("tel:");
  });
});
