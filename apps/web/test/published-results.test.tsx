import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import type { PublishedResults } from "@/results/model";
import { DepartmentCounts, PublishedList, countByDepartment } from "@/results/PublishedResults";
import royal from "../../../packs/royal-softech/pack.json";
import { TEST_SECTIONS } from "./sections";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const config: PublicConfig = {
  school: { name: royal.school.name, shortName: royal.school.shortName, currency: "NPR", timezone: "Asia/Kathmandu", region: "nepal", template: null },
  sections: TEST_SECTIONS.royal,
  modules: { results: true },
  terms: { "term.programme": "Department" },
  theme: royal.theme as PublicConfig["theme"],
};
const inContext = (element: React.ReactNode) => renderToStaticMarkup(<ConfigContext.Provider value={makeConfigValue("ready", config)}>{element}</ConfigContext.Provider>);

type Row = PublishedResults["results"][number];
const row = (over: Partial<Row> = {}): Row => ({
  classId: "c1",
  programmeName: "Science",
  levelName: "Grade 11",
  label: "A",
  termLabel: "2082/83",
  terminal: { id: "t1", name: "First Terminal" },
  publishedAt: "2026-10-01T05:00:00.000Z",
  publishedOnBs: "2083-06-15",
  cards: 30,
  ...over,
});
const rows: Row[] = [row({ terminal: null }), row(), row({ classId: "c2", label: "B" }), row({ classId: "c3", programmeName: "Management" })];

describe("published results (the PM, 2026-10-17)", () => {
  it("counts, for each department, the classes with results out and the results published", () => {
    expect(countByDepartment(rows)).toEqual([
      { name: "Management", classes: 1, results: 1 },
      { name: "Science", classes: 2, results: 3 },
    ]);
    expect(countByDepartment([])).toEqual([]);
  });

  it("the dashboard shows that as a plain table: department, classes, results published; no graphs", () => {
    const html = inContext(<DepartmentCounts rows={rows} />);
    expect(html).toContain("<table");
    for (const word of ["Department", "Classes", "Results published", "Science", "Management"]) expect(html).toContain(word);
    expect(html).not.toContain("role=\"img\"");
    expect(inContext(<DepartmentCounts rows={[]} />)).toContain("No results published this term yet.");
  });

  it("the list shows every published result with a link to its class sheet, and an exam and a department filter", () => {
    const html = inContext(<PublishedList rows={rows} />);
    expect(html).toMatch(/aria-label="Filter the published results"/);
    expect(html).toContain("All exams");
    expect(html).toContain("First Terminal");
    expect(html).toContain("Final result");
    expect(html).toContain('href="/portal/results/sheets?class=c1&amp;terminal=t1"');
    expect(html).toContain('href="/portal/results/sheets?class=c1&amp;terminal=final"');
    expect(html).toContain("30"); // students
  });
});
