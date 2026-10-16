import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import type { PublishedResults } from "@/results/model";
import { DepartmentCounts, DepartmentResults, PublishedList, countByDepartment, groupPublished } from "@/results/PublishedResults";
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

  it("groups like the Classes page: department, then level, then section, with each section's results, in natural order", () => {
    const groups = groupPublished([...rows, row({ classId: "c4", levelName: "Grade 2", label: "A" }), row({ classId: "c5", levelName: "Grade 10", label: "A" })]);
    expect(groups.map((d) => d.name)).toEqual(["Management", "Science"]);
    const science = groups[1]!;
    expect(science.levels.map((l) => l.name)).toEqual(["Grade 2", "Grade 10", "Grade 11"]);
    expect(science.levels[2]!.sections.map((s) => [s.label, s.results.length])).toEqual([["A", 2], ["B", 1]]);
    expect(science.results).toBe(5); // three before, and one each for the two added classes
  });

  it("every card starts closed, with its counts; a filter is offered", () => {
    const html = inContext(<PublishedList rows={rows} />);
    expect(html).toMatch(/aria-label="Filter the published results"/);
    expect(html).toContain("All exams");
    expect(html).toContain(">Science</h2>");
    expect(html).toContain(">Management</h2>");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("aria-expanded=\"true\"");
    expect(html).not.toContain("Grade 11"); // the levels are inside the closed card
    expect(html).not.toContain("<table");
  });

  it("an open department shows its levels and sections, with a link to each result's class sheet", () => {
    const [management, science] = groupPublished(rows);
    const html = inContext(
      <ul>
        <DepartmentResults dept={science!} tone="primary" startOpen />
        <DepartmentResults dept={management!} tone="ok" startOpen={false} />
      </ul>,
    );
    expect(html).toContain("Grade 11");
    expect(html).toContain("Section A");
    expect(html).toContain("2 sections");
    expect(html).toContain('href="/portal/results/sheets?class=c1&amp;terminal=t1"');
    expect(html).toContain('href="/portal/results/sheets?class=c1&amp;terminal=final"');
    expect(html).toContain("First Terminal");
    expect(html).toContain("Final result");
    expect(html).toContain("30 students");
    expect(html).not.toContain("Management</h3>");
  });
});
