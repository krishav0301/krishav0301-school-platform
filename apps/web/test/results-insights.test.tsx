import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { FINAL_KEY, NO_FILTERS, applyFilters, classBars, filterOptions, scoreTone, shortPercent, subjectBars, summarise, type PublishedResults, type PublishedRow } from "@/results/insights-model";
import { ResultsInsightsView } from "@/results/ResultsInsights";
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

const row = (over: Partial<PublishedRow> = {}): PublishedRow => ({
  classId: "c1",
  programmeName: "Science",
  levelName: "Grade 11",
  label: "A",
  termLabel: "2082/83",
  terminal: { id: "t1", name: "First Terminal" },
  publishedAt: "2026-10-01T05:00:00.000Z",
  publishedOnBs: "2083-06-15",
  cards: 30,
  avgPercentHundredths: 7000,
  passed: null,
  bands: [2, 4, 14, 10],
  subjects: [
    { name: "Physics", avgPercentHundredths: 6500 },
    { name: "English", avgPercentHundredths: 7500 },
  ],
  ...over,
});
const data: PublishedResults = {
  results: [
    row(),
    row({ classId: "c2", programmeName: "Management", label: "B", cards: 10, avgPercentHundredths: 5000, bands: [1, 4, 5, 0], subjects: [{ name: "English", avgPercentHundredths: 5500 }] }),
    row({ classId: "c1", terminal: null, avgPercentHundredths: 6800, passed: 27, bands: [3, 4, 13, 10] }),
  ],
};

describe("the results figures and filters (the PM, 2026-10-17)", () => {
  it("offers only what has been published, once each", () => {
    const o = filterOptions(data.results);
    expect(o.exams.map((e) => e.value)).toEqual(["exam:First Terminal", FINAL_KEY]);
    expect(o.departments.map((d) => d.value)).toEqual(["Science", "Management"]);
    expect(o.classes.map((c) => c.value)).toEqual(["c1", "c2"]);
  });

  it("filters by exam, department and class together", () => {
    expect(applyFilters(data.results, { ...NO_FILTERS, exam: FINAL_KEY })).toHaveLength(1);
    expect(applyFilters(data.results, { ...NO_FILTERS, department: "Management" })).toHaveLength(1);
    expect(applyFilters(data.results, { exam: "exam:First Terminal", department: "Science", classId: "c1" })).toHaveLength(1);
    expect(applyFilters(data.results, NO_FILTERS)).toHaveLength(3);
  });

  it("sums the figures: students, an average weighted by marks cards, a pass rate over finals only, the bands", () => {
    const all = summarise(data.results);
    expect(all).toMatchObject({ published: 3, students: 70, bands: [6, 12, 32, 20] });
    expect(all.avgPercentHundredths).toBe(Math.round((7000 * 30 + 5000 * 10 + 6800 * 30) / 70));
    expect(all.passPercent).toBe(90); // 27 of 30, from the one final
    expect(summarise(applyFilters(data.results, { ...NO_FILTERS, exam: "exam:First Terminal" })).passPercent).toBeNull(); // an exam has no pass or fail
    expect(summarise([]).avgPercentHundredths).toBeNull();
  });

  it("draws the best class and subject first, and names the exam only when several are in view", () => {
    expect(classBars(applyFilters(data.results, { ...NO_FILTERS, exam: "exam:First Terminal" })).map((b) => b.label)).toEqual(["Science · Grade 11 · A", "Management · Grade 11 · B"]);
    expect(classBars(data.results)[0]!.label).toContain("First Terminal");
    expect(subjectBars(applyFilters(data.results, { ...NO_FILTERS, exam: "exam:First Terminal" }))).toEqual([
      { key: "English", label: "English", value: 7000 }, // (7500 x 30 + 5500 x 10) / 40
      { key: "Physics", label: "Physics", value: 6500 },
    ]);
  });

  it("a score is drawn in the status colour for its band, and written short", () => {
    expect([8000, 6000, 4000, 3999].map(scoreTone)).toEqual(["ok", "primary", "warn", "bad"]);
    expect([8650, 7000, 6750].map(shortPercent)).toEqual(["86.5%", "70%", "67.5%"]);
  });
});

describe("the Results view", () => {
  const view = (d: PublishedResults, showList = true) =>
    renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <ResultsInsightsView data={d} showList={showList} />
      </ConfigContext.Provider>,
    );

  it("a filter bar, four figures, three graphs and the list, each bar's value also as text", () => {
    const html = view(data);
    expect(html).toMatch(/role="group"[^>]*aria-label="Filter the published results"/);
    for (const label of ["Exam", "Class", "All exams", "All classes"]) expect(html).toContain(label);
    expect(html).toContain("Results published");
    expect(html).toContain("Pass rate");
    expect(html).toContain("Average by class");
    expect(html).toContain("How students scored");
    expect(html).toContain("Average by subject");
    expect(html).toContain("Published results"); // the list's caption
    expect(html).toContain("Physics");
    expect(html).toContain("65%");
    expect(html).toContain('href="/portal/results/sheets?class=c1&amp;terminal=t1"');
    expect(html).toContain('href="/portal/results/sheets?class=c1&amp;terminal=final"');
  });

  it("on the dashboard the list is left out", () => {
    expect(view(data, false)).not.toContain("<table");
  });

  it("with nothing published it says so, with no empty graphs", () => {
    const html = view({ results: [] });
    expect(html).toContain("No results published this term yet.");
    expect(html).not.toContain("Average by class");
  });

  it("uses no colour of its own: the bars take the theme's status tones", () => {
    const html = view(data);
    expect(html).toMatch(/data-tone="(ok|primary|warn|bad)"/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(/);
  });
});
