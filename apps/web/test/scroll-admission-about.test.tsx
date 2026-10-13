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
    expect(html).toContain("Apply for Admission");
    expect(html).not.toContain("not open online");
  });

  it("shows the office's phone number, not a form, when no class is open or the classes could not be loaded", () => {
    const html = admission("closed");
    expect(html).not.toContain("THE-FORM");
    expect(html).toContain("Admissions Are Not Open Online Right Now");
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
  const about = { story: "A story about the school.", facebook: "https://www.facebook.com/profile.php?id=100090093189751" };
  const html = renderToStaticMarkup(<AboutBlock address="Lahan-8, Road No - 2" phones={[PHONE, "+977 33-000000"]} about={about} />);

  it("shows the address, every phone as a link, and the story", () => {
    expect(html).toContain("Lahan-8, Road No - 2");
    expect(html).toContain('href="tel:+97733564346"');
    expect(html).toContain('href="tel:+97733000000"');
    expect(html).toContain("A story about the school.");
  });

  it("opens the Facebook page in a new tab, safely, and links to nothing else outside the site (no map link, PM 2026-10-13)", () => {
    expect(html).toContain('href="https://www.facebook.com/profile.php?id=100090093189751"');
    expect((html.match(/rel="noopener noreferrer"/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/google|maps/i);
    expect([...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1])).toEqual(["https://www.facebook.com/profile.php?id=100090093189751"]);
  });

  it("embeds nothing from anywhere else", () => {
    expect(html).not.toMatch(/<iframe|<script/);
  });

  it("shows only what exists", () => {
    const bare = renderToStaticMarkup(<AboutBlock address="Here" phones={[]} about={{}} />);
    expect(bare).toContain("Here");
    expect(bare).not.toContain("facebook");
    expect(bare).not.toMatch(/maps|google/i);
    expect(bare).not.toContain("tel:");
  });
});
