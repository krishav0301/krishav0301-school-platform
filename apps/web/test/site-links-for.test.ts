import { describe, expect, it } from "vitest";

import { applyRedirectFor } from "@/site/scroll/choose-home";

describe("the old apply page", () => {
  it("sends a visitor of a school with the one-page layout to the form on the front page, and leaves every other school to the page itself", () => {
    expect(applyRedirectFor({ status: "ready", site: { layout: "scroll", scroll: {} } as never })).toBe("/#admission");
    expect(applyRedirectFor({ status: "ready", site: { layout: "classic" } as never })).toBeNull();
    expect(applyRedirectFor({ status: "loading" })).toBeNull();
    expect(applyRedirectFor({ status: "failed" })).toBeNull();
  });
});
