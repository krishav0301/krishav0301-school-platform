import { describe, expect, it } from "vitest";

import { anchorFromHash } from "@/site/scroll/anchor";

describe("a link to a part of the page, opened from outside", () => {
  it("names the section a #hash points to", () => {
    expect(anchorFromHash("#admission")).toBe("admission");
    expect(anchorFromHash("#notices")).toBe("notices");
    expect(anchorFromHash("#about")).toBe("about");
  });

  it("ignores anything that is not a plain section name", () => {
    for (const hash of ["", "#", "#<script>", "#a b", "#../x", "admission", "#" + "a".repeat(60)]) expect(anchorFromHash(hash), hash).toBeNull();
  });
});
