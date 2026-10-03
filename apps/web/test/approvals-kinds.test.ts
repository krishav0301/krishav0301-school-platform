import { describe, expect, it } from "vitest";

import { cardLines, countByKind, kindLabel, npr, visibleRequests, type ApprovalSummary } from "@/approvals/model";

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

describe("the inbox's words (D-102)", () => {
  it("money is NPR with Nepali grouping, paisa only when there are some", () => {
    expect(npr(125_000_000)).toBe("NPR 12,50,000");
    expect(npr(445_050)).toBe("NPR 4,450.50");
  });

  it("counts each kind, filters to one, and sorts newest or oldest first", () => {
    const at = (id: string, kind: ApprovalSummary["kind"], createdAt: string) => ({ id, kind, createdAt }) as ApprovalSummary;
    const all = [at("a", "discount", "2026-10-01T01:00:00Z"), at("b", "refund", "2026-10-02T01:00:00Z"), at("c", "discount", "2026-09-30T01:00:00Z")];
    expect(countByKind(all)).toEqual({ website_content: 0, fee_structure: 0, discount: 2, reversal: 0, refund: 1 });
    expect(visibleRequests(all, null, "newest").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(visibleRequests(all, "discount", "oldest").map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("a card falls back to the server's own line when the snapshot is from before", () => {
    expect(cardLines({ kind: "discount", summary: "Discount of NPR 100.00 for A (2083-1)", snapshot: {} } as ApprovalSummary)).toEqual({ subject: "Discount of NPR 100.00 for A (2083-1)", lines: [] });
  });
});
