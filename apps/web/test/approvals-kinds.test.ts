import { describe, expect, it } from "vitest";

import { kindLabel, type ApprovalSummary } from "@/approvals/model";

/** Every kind of approval request has words in the Admin's inbox, never its code (found by the year test, D-084). */
describe("approval kinds", () => {
  it("names all five kinds in plain words", () => {
    const kinds: ApprovalSummary["kind"][] = ["website_content", "fee_structure", "discount", "reversal", "refund"];
    for (const kind of kinds) {
      expect(kindLabel(kind)).not.toBe(kind);
      expect(kindLabel(kind)).not.toMatch(/_/);
    }
  });
});
