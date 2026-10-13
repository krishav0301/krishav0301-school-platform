import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApplyDone } from "@/admissions/ApplyDone";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

describe("the message after an application is sent", () => {
  it("is announced and can take focus, so nobody is left wondering whether it went through (review I3)", () => {
    const html = renderToStaticMarkup(<ApplyDone embedded needsEmail={false} email="" />);
    expect(html).toMatch(/role="status"/);
    expect(html).toMatch(/tabindex="-1"/);
  });

  it("keeps the page's one h1 when it sits inside a longer page, and is the h1 on its own page", () => {
    expect(renderToStaticMarkup(<ApplyDone embedded needsEmail={false} email="" />)).toMatch(/<h2/);
    expect(renderToStaticMarkup(<ApplyDone embedded needsEmail={false} email="" />)).not.toMatch(/<h1/);
    expect(renderToStaticMarkup(<ApplyDone needsEmail email="a@b.example" />)).toMatch(/<h1/);
  });

  it("is headed in title case inside the scroll page, like its other headings, and keeps the usual wording on its own page", () => {
    expect(renderToStaticMarkup(<ApplyDone embedded needsEmail={false} email="" />)).toContain(">Application Received<");
    expect(renderToStaticMarkup(<ApplyDone needsEmail email="a@b.example" />)).toContain(">Application received<");
  });

  it("says where the confirmation went, or that the office will call", () => {
    expect(renderToStaticMarkup(<ApplyDone needsEmail email="a@b.example" />)).toContain("a@b.example");
    expect(renderToStaticMarkup(<ApplyDone embedded needsEmail={false} email="" />)).toContain("call the number you gave");
  });
});
