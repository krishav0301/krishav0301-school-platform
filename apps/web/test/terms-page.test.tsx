import { describe, expect, it } from "vitest";

import { levelChips, otherTerms, termTiming, termWings, type Term } from "@/terms/model";

/**
 * The Academic Terms page (PM, 2026-10-06): Currently Active terms as cards, then Other Terms, which are "all the terms
 * which are not active" (drafts and closed ones).
 */
const level = (id: string, name: string, programmeName: string, sectionKey = "be") => ({ id, name, ordinal: 1, programmeId: programmeName, programmeName, sectionKey, usualMonths: 6 });
const term = (id: string, label: string, status: Term["status"], over: Partial<Term> = {}): Term => ({
  id,
  bsYear: 2083,
  label,
  code: id.toUpperCase(),
  startDate: "2026-11-16",
  endDate: "2027-07-16",
  startDateBs: null,
  endDateBs: null,
  months: 8,
  status,
  levels: [],
  classes: 0,
  students: 0,
  ...over,
});

describe("a term card's words", () => {
  it("names its wings once each, from the school's sections", () => {
    const x = term("t1", "B.E. Odd", "active", { levels: [level("l1", "2nd Sem", "CSE"), level("l2", "4th Sem", "CSE"), level("l3", "2nd Sem", "ISE"), level("l4", "11th", "Maths", "hs")] });
    expect(termWings(x, [{ key: "be", name: "Bachelor of Engineering" }, { key: "hs", name: "High School" }])).toEqual(["Bachelor of Engineering", "High School"]);
  });

  it("shows the first three levels as Course · Level, then how many more", () => {
    const x = term("t1", "B.E. Odd", "active", { levels: [level("l1", "2nd Sem", "CSE"), level("l2", "4th Sem", "CSE"), level("l3", "2nd Sem", "ISE"), level("l4", "4th Sem", "ISE"), level("l5", "6th Sem", "ISE")] });
    expect(levelChips(x)).toEqual({ chips: ["CSE · 2nd Sem", "CSE · 4th Sem", "ISE · 2nd Sem"], more: 2 });
    expect(levelChips(term("t2", "Empty", "draft"))).toEqual({ chips: [], more: 0 });
  });
});

describe("where a term stands in time", () => {
  const today = "2027-02-16";
  it("an active term: months or days remaining, or ends today", () => {
    expect(termTiming(term("a", "A", "active"), today)).toBe("5 months remaining");
    expect(termTiming(term("a", "A", "active", { endDate: "2027-02-28" }), today)).toBe("12 days remaining");
    expect(termTiming(term("a", "A", "active", { endDate: "2027-02-16" }), today)).toBe("Ends today");
    expect(termTiming(term("a", "A", "active", { endDate: "2027-02-01" }), today)).toBe("Past its end date");
  });

  it("a term that has not started says when it starts; a draft whose day has come says it is not opened", () => {
    expect(termTiming(term("d", "D", "draft", { startDate: "2027-04-17", endDate: "2027-10-17" }), today)).toBe("Starts in 2 months");
    expect(termTiming(term("d", "D", "draft"), today)).toBe("Not opened yet");
    expect(termTiming(term("a", "A", "active", { startDate: "2027-02-17", endDate: "2027-08-17" }), today)).toBe("Starts in 1 day");
  });

  it("a closed term says how long ago it ended", () => {
    expect(termTiming(term("c", "C", "closed", { startDate: "2025-07-17", endDate: "2026-10-16" }), today)).toBe("Ended 4 months ago");
    expect(termTiming(term("c", "C", "closed"), today)).toBe("Closed before its end date");
  });
});

describe("Other Terms", () => {
  const terms = [
    term("a1", "B.E. Odd Semester", "active", { levels: [level("l1", "2nd Sem", "CSE")] }),
    term("d1", "B.E. Even Semester", "draft", { levels: [level("l2", "3rd Sem", "CSE")] }),
    term("d2", "MBA Marketing", "draft"),
    term("c1", "School 2024-25", "closed"),
  ];
  const labels = (q: string, status: "" | "draft" | "closed" = "") => otherTerms(terms, q, status).map((x) => x.label);

  it("never lists an active term: those are above, under Currently Active", () => {
    expect(labels("")).toEqual(["B.E. Even Semester", "MBA Marketing", "School 2024-25"]);
    expect(labels("odd")).toEqual([]);
  });

  it("filters by status and by search over the name, code and levels", () => {
    expect(labels("", "closed")).toEqual(["School 2024-25"]);
    expect(labels("", "draft")).toEqual(["B.E. Even Semester", "MBA Marketing"]);
    expect(labels("3rd")).toEqual(["B.E. Even Semester"]);
    expect(labels("mba")).toEqual(["MBA Marketing"]);
  });
});

// --- The two sections' markup -------------------------------------------------------------------------------------------
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { ActiveTerms, OtherTerms, TermsBanner, termActions } from "@/terms/TermsBoard";

const config = { school: { name: "School" }, sections: [{ key: "be", name: "Bachelor of Engineering", active: true }], modules: {}, terms: {} } as unknown as PublicConfig;
const render = (node: React.ReactNode) => renderToStaticMarkup(<ConfigContext.Provider value={makeConfigValue("ready", config)}>{node}</ConfigContext.Provider>);
const mixed = [
  term("a1", "B.E. Odd Semester", "active", { levels: [level("l1", "2nd Sem", "CSE")], classes: 6, students: 1 }),
  term("d1", "B.E. Even Semester", "draft"),
  term("c1", "School 2024-25", "closed", { startDate: "2025-07-17", endDate: "2026-10-16" }),
];
const noop = () => {};

describe("the page's sections", () => {
  it("Currently Active shows only active terms, as cards with wing, period, levels, counts and Manage term", () => {
    const html = render(<ActiveTerms terms={mixed} today="2027-02-16" manage={noop} />);
    expect(html).toContain("Currently Active (1)");
    expect(html).toMatch(/<h3[^>]*>B\.E\. Odd Semester<\/h3>/);
    expect(html).not.toContain("B.E. Even Semester");
    expect(html).toContain("Bachelor of Engineering");
    expect(html).toContain("CSE · 2nd Sem");
    expect(html).toContain("5 months remaining");
    expect(html).toContain('aria-label="Manage B.E. Odd Semester"');
    expect(html).toContain('aria-label="Actions for B.E. Odd Semester"');
  });

  it("Other Terms lists every term that is not active, with View for a closed one, and never the active one", () => {
    const html = render(<OtherTerms terms={mixed} today="2027-02-16" manage={noop} />);
    expect(html).toContain(">Other Terms</h2>");
    expect(html).toContain("B.E. Even Semester");
    expect(html).toContain("School 2024-25");
    expect(html).not.toContain("B.E. Odd Semester");
    expect(html).toContain("Ended 4 months ago");
    expect(html).toContain('aria-label="View School 2024-25"');
    expect(html).not.toContain("All Academic Terms");
  });

  it("each status offers only what the platform can do: nothing is deleted or archived (closing is final)", () => {
    const labels = (status: Term["status"]) => termActions(term("x", "X", status), noop).map((a) => a.label);
    expect(labels("active")).toEqual(["Change levels…", "Fill in the next term…", "Close term…"]);
    expect(labels("draft")).toEqual(["Edit…", "Open term…"]);
    expect(labels("closed")).toEqual(["Fill in the next term…"]);
  });

  it("explains what an active term is", () => {
    expect(render(<TermsBanner />)).toContain("An active term determines which classes are open");
  });
});
