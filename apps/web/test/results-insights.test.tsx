import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { FINAL_KEY, NO_FILTERS, applyFilters, defaultExam, filterOptions, groupInsights, scoreTone, shortPercent, startFilters, subjectBars, summarise, type PublishedResults, type PublishedRow } from "@/results/insights-model";
import { ClassRow, ResultsInsightsView } from "@/results/ResultsInsights";
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
  wing: "+2",
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
// Newest first, as the server sends it: a Science Grade 11 A and B, a Science Grade 12 A, a Management Grade 11 A, a Bachelor's BBS Year 1 A, and the Science 11 A's final.
const data: PublishedResults = {
  results: [
    row({ classId: "c1", terminal: null, avgPercentHundredths: 6800, passed: 27, bands: [3, 4, 13, 10] }),
    row({ classId: "c1b", label: "B", cards: 20, avgPercentHundredths: 6000, bands: [2, 4, 8, 6], subjects: [{ name: "Physics", avgPercentHundredths: 5500 }] }),
    row({ classId: "c2", levelName: "Grade 12", cards: 10, avgPercentHundredths: 5000 }),
    row({ classId: "c3", programmeName: "Management", cards: 10, avgPercentHundredths: 9000, subjects: [{ name: "Accounting", avgPercentHundredths: 9000 }] }),
    row({ classId: "c4", wing: "Bachelor's", programmeName: "BBS", levelName: "Year 1", cards: 40, avgPercentHundredths: 4500, subjects: [{ name: "Economics", avgPercentHundredths: 4500 }] }),
    row({ classId: "c1" }),
  ],
};
const exam = "exam:First Terminal";

describe("the results figures, filters and grouping (the PM, 2026-10-17)", () => {
  it("opens on the newest published exam, never a mix of exams", () => {
    expect(defaultExam(data.results)).toBe(FINAL_KEY); // the newest is the Science 11 A final
    expect(startFilters(data.results)).toEqual({ ...NO_FILTERS, exam: FINAL_KEY });
    expect(applyFilters(data.results, { ...NO_FILTERS, exam })).toHaveLength(5);
    expect(applyFilters(data.results, { ...NO_FILTERS, exam: FINAL_KEY })).toHaveLength(1);
  });

  it("each picker offers what is left after the ones before it: exam, wing, department, level", () => {
    const f = { ...NO_FILTERS, exam };
    expect(filterOptions(data.results, f).exams.map((e) => e.value)).toEqual([FINAL_KEY, exam]);
    expect(filterOptions(data.results, f).wings.map((w) => w.value)).toEqual(["+2", "Bachelor's"]);
    expect(filterOptions(data.results, { ...f, wing: "Bachelor's" }).departments.map((d) => d.value)).toEqual(["BBS"]);
    expect(filterOptions(data.results, { ...f, wing: "+2", department: "Science" }).levels.map((l) => l.value)).toEqual(["Grade 11", "Grade 12"]);
    expect(filterOptions(data.results, { ...f, wing: "+2", department: "Management" }).levels.map((l) => l.value)).toEqual(["Grade 11"]);
  });

  it("filters by wing, department and level together", () => {
    expect(applyFilters(data.results, { exam, wing: "+2", department: "Science", level: "Grade 11" }).map((r) => r.classId)).toEqual(["c1b", "c1"]);
    expect(applyFilters(data.results, { ...NO_FILTERS, exam, level: "Year 1" })).toHaveLength(1);
  });

  it("groups wing, then department, then level, then class, in natural order, with totals at each step", () => {
    const wings = groupInsights(applyFilters(data.results, { ...NO_FILTERS, exam }));
    expect(wings.map((w) => w.name)).toEqual(["+2", "Bachelor's"]);
    const plus2 = wings[0]!;
    expect(plus2.departments.map((d) => d.name)).toEqual(["Management", "Science"]);
    const science = plus2.departments[1]!;
    expect(science.levels.map((l) => [l.name, l.classes.map((c) => c.label)])).toEqual([
      ["Grade 11", ["A", "B"]],
      ["Grade 12", ["A"]],
    ]);
    expect(science.levels[0]!.summary).toMatchObject({ published: 2, students: 50 });
    expect(science.summary.students).toBe(60);
  });

  it("a level compares only its own subjects, weighted by students; another department's subjects are never mixed in", () => {
    const science11 = groupInsights(applyFilters(data.results, { ...NO_FILTERS, exam, department: "Science", level: "Grade 11" }))[0]!.departments[0]!.levels[0]!;
    expect(science11.subjects).toEqual([
      { key: "English", label: "English", value: 7500 },
      { key: "Physics", label: "Physics", value: Math.round((6500 * 30 + 5500 * 20) / 50) }, // 6100
    ]);
    expect(subjectBars(applyFilters(data.results, { ...NO_FILTERS, exam, department: "Management" })).map((b) => b.label)).toEqual(["Accounting"]);
  });

  it("sums the figures: students, an average weighted by students, a pass rate over finals only, the bands", () => {
    const finalOnly = summarise(applyFilters(data.results, { ...NO_FILTERS, exam: FINAL_KEY }));
    expect(finalOnly).toMatchObject({ students: 30, passPercent: 90, bands: [3, 4, 13, 10] });
    const all = summarise(applyFilters(data.results, { ...NO_FILTERS, exam }));
    expect(all.passPercent).toBeNull(); // an exam has no pass or fail
    expect(all.avgPercentHundredths).toBe(Math.round((7000 * 30 + 6000 * 20 + 5000 * 10 + 9000 * 10 + 4500 * 40) / 110));
    expect(summarise([]).avgPercentHundredths).toBeNull();
  });

  it("a score is drawn in the status colour for its band, and written short", () => {
    expect([8000, 6000, 4000, 3999].map(scoreTone)).toEqual(["ok", "primary", "warn", "bad"]);
    expect([8650, 7000, 6750].map(shortPercent)).toEqual(["86.5%", "70%", "67.5%"]);
  });
});

describe("the Results view", () => {
  const sheet = (classId: string, terminalId: string) => <span>{`sheet ${classId} ${terminalId}`}</span>;
  const view = (d: PublishedResults) =>
    renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <ResultsInsightsView data={d} sheet={sheet} />
      </ConfigContext.Provider>,
    );

  it("a filter bar, four figures, how students scored, then departments as cards, the first open", () => {
    const html = view(data);
    expect(html).toMatch(/role="group"[^>]*aria-label="Filter the published results"/);
    for (const label of ["Exam", "Level", "Results published", "Pass rate", "How students scored"]) expect(html).toContain(label);
    // It opens on the newest exam (the final): one class, so its card and level are open and its students are shown.
    expect(html).toContain(">Science</h3>");
    expect(html).toContain("Subjects in Grade 11");
    expect(html).toContain("sheet c1 final");
    expect(html).not.toContain("Management");
  });

  it("with several departments the first card is open and the others closed, each shown as a card with its figures", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <ResultsInsightsView data={{ results: data.results.filter((r) => r.terminal !== null) }} sheet={sheet} />
      </ConfigContext.Provider>,
    );
    expect(html).toContain(">Management</h3>");
    expect(html).toContain(">Science</h3>");
    expect(html).toContain(">Bachelor&#x27;s</h3>"); // the wing, because there are two
    expect(html).toContain("Wing"); // and so a Wing picker
    expect(html).toContain('aria-label="Hide Management"'); // the first (Management sorts before Science) is open
    expect(html).toContain('aria-label="Show Science"');
    expect(html).toContain("Grade 11");
  });

  it("a class row shows its students and, on a final, how many passed; opening it shows the class's sheet", () => {
    const closed = renderToStaticMarkup(<ClassRow row={data.results[0]!} sheet={sheet} />);
    expect(closed).toContain("30 students");
    expect(closed).toContain("27 of 30 passed");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("sheet c1");
    const open = renderToStaticMarkup(<ClassRow row={data.results[0]!} sheet={sheet} startOpen />);
    expect(open).toContain("sheet c1 final");
    expect(renderToStaticMarkup(<ClassRow row={data.results[5]!} sheet={sheet} startOpen />)).toContain("sheet c1 t1");
  });

  it("the dashboard's brief has graphs and figures by level and class, and nothing that opens", () => {
    const html = renderToStaticMarkup(
      <ConfigContext.Provider value={makeConfigValue("ready", config)}>
        <ResultsInsightsView data={{ results: data.results.filter((r) => r.terminal !== null) }} />
      </ConfigContext.Provider>,
    );
    expect(html).toContain(">Management</h3>");
    expect(html).toContain(">Science</h3>");
    expect(html).toContain("Grade 12"); // every level is in view, not closed behind a card
    expect(html).toContain("Section A");
    expect(html).toContain("30 students");
    expect(html).not.toContain("aria-expanded"); // no card or class opens
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Subjects in"); // the subjects are on the Class sheets page
    expect(renderToStaticMarkup(<ClassRow row={data.results[0]!} />)).not.toContain("<button");
  });

  it("with nothing published it says so, with no empty graphs", () => {
    const html = view({ results: [] });
    expect(html).toContain("No results published this term yet.");
    expect(html).not.toContain("How students scored");
  });

  it("uses no colour of its own: the bars take the theme's status tones", () => {
    const html = view(data);
    expect(html).toMatch(/data-tone="(ok|primary|warn|bad)"/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(/);
  });
});
