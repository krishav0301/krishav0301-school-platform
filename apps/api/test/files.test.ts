import { describe, expect, it } from "vitest";

import { createFileStorage } from "../src/core/files";

describe("file storage (D-020, D-063)", () => {
  it("has no adapter yet: calling it is a loud error, not a silent no-op", () => {
    expect(() => createFileStorage()).toThrow(/not enabled|R2/i);
  });
});
