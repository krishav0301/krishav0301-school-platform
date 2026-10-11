import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfigContext, makeConfigValue, type PublicConfig } from "@/config/ConfigProvider";
import { SetupMapView } from "@/setup/SetupMapScreen";
import type { SetupMap } from "@/setup/model";

// The setup map (the PM, 2026-10-10): a chart of how a term's exam, wings, departments, levels, sections, teachers and
// subjects link to students.
const config = { terms: { "term.section": "Wing", "term.programme": "Department", "term.level": "Level", "term.classSection": "Section" }, modules: {} } as unknown as PublicConfig;
const render = (node: React.ReactNode) => renderToStaticMarkup(<ConfigContext.Provider value={makeConfigValue("ready", config)}>{node}</ConfigContext.Provider>);

const map: SetupMap = {
  terms: [
    {
      id: "t1",
      label: "BS 2083 Baisakh",
      status: "active",
      exam: { graded: true, theoryMinPercent: 35, practicalMinPercent: 40, terminals: [{ name: "First", weight: 40, hasPractical: false }, { name: "Final", weight: 60, hasPractical: true }] },
      wings: [
        {
          key: "plus2",
          name: "+2",
          departments: [
            {
              id: "d1",
              name: "Science",
              levels: [
                {
                  id: "l1",
                  name: "Grade 11",
                  subjects: [
                    { id: "s1", name: "Physics", fullMarksHundredths: 10_000, practicalHundredths: 2_500, group: null },
                    { id: "s2", name: "English", fullMarksHundredths: 10_000, practicalHundredths: null, group: null },
                  ],
                  sections: [
                    { id: "c1", label: "Morning", students: 32, classTeacher: "Sita Rai", teachers: [{ subjectId: "s1", teacher: "Ram Karki" }] },
                    { id: "c2", label: "", students: 0, classTeacher: null, teachers: [] },
                  ],
                },
                { id: "l2", name: "Grade 12", subjects: [], sections: [] },
              ],
            },
          ],
        },
      ],
    },
    { id: "t2", label: "BS 2083 Shrawan", status: "draft", exam: null, wings: [] },
  ],
};

describe("the setup map", () => {
  it("flows from the term to its exam, and from the wing to the department to the level, in the school's words", () => {
    const html = render(<SetupMapView map={map} />);
    for (const word of [">Wing<", ">Department<", ">Level<", ">Section<", ">Exam<", "BS 2083 Baisakh"]) expect(html).toContain(word);
    expect(html).toContain("Science");
    expect(html).toContain("Grade 11");
    expect(html).toContain("First · 40%");
    expect(html).toContain("Final · 60% · practical");
    expect(html).toContain("Grade system: yes");
    expect(html).toContain("Pass: theory 35%, practical 40%");
  });

  it("shows each section's Class Teacher, who teaches what, and its students", () => {
    const html = render(<SetupMapView map={map} />);
    expect(html).toContain("Class Teacher: Sita Rai");
    expect(html).toContain("Ram Karki");
    expect(html).toContain("No teacher yet"); // English has no teacher in Morning
    expect(html).toContain("Morning");
    expect(html).toContain(">32<");
    expect(html).toContain("No Class Teacher yet");
    expect(html).toContain("No section name");
  });

  it("says what is missing instead of leaving a gap", () => {
    const html = render(<SetupMapView map={map} />);
    expect(html).toContain("No sections yet"); // Grade 12
    expect(html).toContain("No subjects yet");
    expect(html).toContain("No exam pattern yet"); // the second term
    expect(html).toContain("No Level is in this term yet.");
  });

  it("says so when no term is open, and joins boxes with arrows that assistive technology skips", () => {
    expect(render(<SetupMapView map={{ terms: [] }} />)).toContain("There is no open term yet.");
    const html = render(<SetupMapView map={map} />);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

describe("the boxes open the screens behind them (the PM, 2026-10-11)", () => {
  it("the exam, the structure, the subjects and each class and its students are links", () => {
    const html = render(<SetupMapView map={map} />);
    expect(html).toContain('href="/portal/setup/terminals"'); // the exam
    expect(html).toContain('href="/portal/setup/programmes"'); // wing and department
    expect(html).toContain('href="/portal/setup/curriculum"'); // level and subjects
    expect(html).toContain('href="/portal/classes/class?id=c1"'); // the section
    expect(html).toContain('href="/portal/classes/class?id=c1&amp;tab=students"'); // its students
    expect(html).toContain('aria-label="Open Section: Morning"');
  });

  it("the term's box goes to Setup for the Co-ordinator and to the Principal's Academic Term page for the Principal", () => {
    expect(render(<SetupMapView map={map} />)).toContain('href="/portal/setup"');
    expect(render(<SetupMapView map={map} termHref="/portal/terms" />)).toContain('href="/portal/terms"');
  });

  it("a level's sections sit below it, each with a down-and-across arrow, not at the end of its row", () => {
    const html = render(<SetupMapView map={map} />);
    expect(html).toContain("class=\"level\"");
    expect(html).toContain("lucide-corner-down-right");
  });
});
