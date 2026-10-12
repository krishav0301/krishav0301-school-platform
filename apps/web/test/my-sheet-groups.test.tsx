import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { sheetsOf } from "@/results/MarkSheetScreen";
import { MySheetGroups, firstToOpen, groupByClass } from "@/results/MySheetGroups";
import type { MyMarkSheets } from "@/results/model";
import { SessionContext } from "@/session/SessionProvider";
import { fakeSession } from "./session";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// The teacher's Marks page, grouped by class under the exam tabs (the PM, 2026-10-12): Class 8 with the subjects taken in it, and so on.

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { fees: true, homework: true, results: true },
  terms: {},
  theme: royal.theme as PublicConfig["theme"],
};
const inContext = (element: React.ReactNode) =>
  renderToStaticMarkup(
    <ConfigContext.Provider value={makeConfigValue("ready", config)}>
      <SessionContext.Provider value={fakeSession({ status: "signedIn", me: { id: "user-1", name: "Asha", roles: [{ role: "teacher", scope: "assigned" }] } })}>{element}</SessionContext.Provider>
    </ConfigContext.Provider>,
  );

const sheet = (status: "not_started" | "draft" | "under_review" | "verified" | "published") => [{ terminalId: "t1", status, note: null }];
const mine = {
  terminals: [{ id: "t1", name: "First Term", weight: 100 }],
  subjects: [
    { classId: "c10", programmeName: "General", levelName: "Class 10", label: "Section A", offeringId: "o1", subjectName: "Math", sheets: sheet("not_started") },
    { classId: "c8", programmeName: "General", levelName: "Class 8", label: "Section A", offeringId: "o2", subjectName: "English", sheets: sheet("verified") },
    { classId: "c8", programmeName: "General", levelName: "Class 8", label: "Section A", offeringId: "o3", subjectName: "Science", sheets: sheet("draft") },
    { classId: "c9", programmeName: "General", levelName: "Class 9", label: "Section A", offeringId: "o4", subjectName: "Nepali", sheets: sheet("under_review") },
  ],
} as unknown as MyMarkSheets;

describe("a teacher's mark sheets, grouped by class", () => {
  it("one group for each class in name order (Class 8, 9, 10), with the subjects of that class and what is left", () => {
    const groups = groupByClass(sheetsOf(mine, "t1"));
    expect(groups.map((g) => [g.title, g.place, g.rows.map((r) => r.subjectName), g.todo, g.review, g.done])).toEqual([
      ["Class 8", "General · Section A", ["Science", "English"], 1, 0, 1], // the unfinished one first
      ["Class 9", "General · Section A", ["Nepali"], 0, 1, 0],
      ["Class 10", "General · Section A", ["Math"], 1, 0, 0],
    ]);
  });

  it("opens the first class that still has something to do, else the first", () => {
    expect(firstToOpen(groupByClass(sheetsOf(mine, "t1")))).toBe("c8");
    const allDone = { ...mine, subjects: mine.subjects.map((s) => ({ ...s, sheets: sheet("published") })) } as unknown as MyMarkSheets;
    expect(firstToOpen(groupByClass(sheetsOf(allDone, "t1")))).toBe("c8");
    expect(firstToOpen([])).toBe("");
  });

  it("shows each class as a card with its counts and an arrow, only the first open, and no class column inside", () => {
    const html = inContext(<MySheetGroups rows={sheetsOf(mine, "t1")} terminalName="First Term" />);
    expect(html.match(/<h2[^>]*>Class (8|9|10)</g)).toHaveLength(3);
    expect(html).toContain('aria-expanded="true"');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Hide the mark sheets of Class 8, General · Section A"');
    expect(html).toContain('aria-label="Show the mark sheets of Class 9, General · Section A"');
    // The open card holds Class 8's subjects and links to their sheets; the closed ones hold nothing yet.
    expect(html).toContain("Science");
    expect(html).toContain('href="/portal/results/sheet?class=c8&amp;subject=o3&amp;terminal=t1"');
    expect(html).not.toContain("Nepali");
    expect(html).toContain("Your mark sheets for Class 8, General · Section A, First Term");
    expect(html).not.toContain(">Class<"); // the class is the card's, not a column
  });
});
